---
name: dynamodb-conditional-writes
description: The two conditional-write patterns HODL On A Minute depends on, plus ConditionalCheckFailedException handling and its HTTP mapping. Load when touching src/lib/db/.
---

# DynamoDB conditional writes

Two writes carry the whole integrity story of this app. Both use
`DynamoDBDocumentClient` from `@aws-sdk/lib-dynamodb` (plain JS values, no
`{ S: "..." }` attribute-value wrapping).

A condition that is subtly wrong **fails silently in the safe direction during
development** — the write succeeds, the app works, and the guarantee you think you have
does not exist. Never assume; write the test.

## Pattern 1 — create a guess, but only if none is active

```ts
new UpdateCommand({
  TableName: table,
  Key: { playerId },
  UpdateExpression: "SET activeGuess = :g, updatedAt = :now",
  ConditionExpression: "attribute_not_exists(activeGuess)",
  ExpressionAttributeValues: { ":g": guess, ":now": now },
});
```

`attribute_not_exists(activeGuess)` is also true for an item that does not exist at all,
so a first-time player is handled by the same call — but the player item still has to be
created with `score: 0` first, or the update creates an item with no score. Create the
player on session read, not here.

## Pattern 2 — resolve exactly once

```ts
new UpdateCommand({
  TableName: table,
  Key: { playerId },
  UpdateExpression:
    "SET score = score + :delta, lastResult = :r, updatedAt = :now REMOVE activeGuess",
  ConditionExpression: "activeGuess.id = :guessId",
  ExpressionAttributeValues: { ":delta": delta, ":r": result, ":now": now, ":guessId": id },
});
```

The condition on `activeGuess.id` is what makes this idempotent: the second concurrent
resolve finds `activeGuess` already removed, the condition fails, and the score is
incremented once. `SET` and `REMOVE` in one expression is a single atomic update — do
not split it into two calls.

## Failure handling

```ts
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";

try {
  await doc.send(cmd);
} catch (err) {
  if (err instanceof ConditionalCheckFailedException) {
    /* expected: someone got there first */
  }
  throw err;
}
```

| Situation                       | Meaning                         | HTTP |
| ------------------------------- | ------------------------------- | ---- |
| Create failed the condition     | A guess is already active       | 409  |
| Resolve failed the condition    | Already resolved concurrently   | 200 — re-read and return current state |
| `ResourceNotFoundException`     | Table missing / wrong region    | 500  |
| Credentials / `AccessDenied`    | IAM policy too narrow           | 500  |

The asymmetry is deliberate. A losing create is a real conflict the player must see. A
losing resolve is not an error at all — the work was done by the other caller, so read
the item back and return it.

## Gotchas

- `score = score + :delta` fails on an item where `score` is absent. Guarantee `score`
  at creation time.
- Reserved words (`status`, `name`, `timestamp`, …) need `ExpressionAttributeNames`.
  `score`, `activeGuess` and `lastResult` are fine.
- Conditional-check failures **do not** return the item by default. Pass
  `ReturnValuesOnConditionCheckFailure: "ALL_OLD"` to avoid a follow-up read.
- Table: `hodl-on-a-minute-players`, partition key `playerId` (string), on-demand
  billing.
