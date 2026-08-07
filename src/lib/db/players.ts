import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

import type { ActiveGuess, LastResult, PlayerItem } from "@/lib/types";

import { getDocumentClient, getTableName } from "./client";
import { GuessAlreadyActiveError, GuessAlreadyResolvedError } from "./errors";

/**
 * All writes in this file are conditional. That is the whole point: "one guess at
 * a time" and "resolve exactly once" are integrity constraints, so they belong in
 * the database, not in an `if` that two concurrent requests both walk through.
 *
 * See the `dynamodb-conditional-writes` skill for the patterns and their traps.
 *
 * Attribute names are aliased through ExpressionAttributeNames throughout. Only
 * some of them strictly need it, but a reserved-word collision fails at runtime
 * and only for the unlucky attribute, so the alias is applied uniformly.
 */

const NAMES = {
  "#playerId": "playerId",
  "#score": "score",
  "#activeGuess": "activeGuess",
  "#history": "history",
  "#updatedAt": "updatedAt",
  "#id": "id",
} as const;

async function getPlayer(playerId: string): Promise<PlayerItem | undefined> {
  const result = await getDocumentClient().send(
    new GetCommand({
      TableName: getTableName(),
      Key: { playerId },
      // Resolution decides money-equivalent outcomes; a stale read could resolve
      // a guess that another request already resolved.
      ConsistentRead: true,
    }),
  );

  return result.Item as PlayerItem | undefined;
}

/**
 * Returns the player, creating them with a score of 0 on first sight.
 *
 * Read first, because the returning player is the common case and costs one
 * call. The create is conditional so that two first-ever requests racing each
 * other produce one player, not two — the loser simply re-reads.
 */
export async function getOrCreatePlayer(playerId: string): Promise<PlayerItem> {
  const existing = await getPlayer(playerId);
  if (existing) return existing;

  const now = Date.now();
  const fresh: PlayerItem = {
    playerId,
    score: 0,
    createdAt: now,
    updatedAt: now,
  };

  try {
    await getDocumentClient().send(
      new PutCommand({
        TableName: getTableName(),
        Item: fresh,
        ConditionExpression: "attribute_not_exists(#playerId)",
        ExpressionAttributeNames: { "#playerId": NAMES["#playerId"] },
      }),
    );
    return fresh;
  } catch (error) {
    if (!(error instanceof ConditionalCheckFailedException)) throw error;

    // Someone created this player between our read and our write. Theirs won.
    const winner = await getPlayer(playerId);
    if (!winner) {
      throw new Error(`Player ${playerId} vanished between create and re-read`);
    }
    return winner;
  }
}

/**
 * Attaches a guess to the player, but only if none is in flight.
 *
 * `attribute_not_exists(activeGuess)` alone is also true for an item that does
 * not exist at all, which would create a player with a guess and no score — so
 * `attribute_exists(playerId)` is required alongside it.
 *
 * @throws {GuessAlreadyActiveError} when a guess is already in flight.
 */
export async function createGuess(
  playerId: string,
  guess: ActiveGuess,
): Promise<PlayerItem> {
  try {
    const result = await getDocumentClient().send(
      new UpdateCommand({
        TableName: getTableName(),
        Key: { playerId },
        UpdateExpression: "SET #activeGuess = :guess, #updatedAt = :now",
        ConditionExpression:
          "attribute_exists(#playerId) AND attribute_not_exists(#activeGuess)",
        ExpressionAttributeNames: {
          "#playerId": NAMES["#playerId"],
          "#activeGuess": NAMES["#activeGuess"],
          "#updatedAt": NAMES["#updatedAt"],
        },
        ExpressionAttributeValues: { ":guess": guess, ":now": Date.now() },
        ReturnValues: "ALL_NEW",
      }),
    );

    return result.Attributes as PlayerItem;
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) {
      throw new GuessAlreadyActiveError();
    }
    throw error;
  }
}

/**
 * Applies the outcome of a guess: adjusts the score, prepends the result to the
 * history and clears the guess — in one atomic update, conditioned on the guess
 * id.
 *
 * That condition is what makes resolution idempotent. Two concurrent callers
 * both compute the same outcome; the first one's update removes `activeGuess`,
 * so the second one's condition fails and the score moves — and the history
 * grows — exactly once.
 *
 * `list_append(:result, history)` puts the new entry *first*, so the list is
 * newest-first and the UI never has to reverse it. `if_not_exists` covers the
 * player's very first resolution, when the attribute does not exist yet and a
 * bare `list_append` would fail.
 *
 * The list is never trimmed here. DynamoDB cannot slice a list server-side, and
 * appending plus removing the same attribute in one expression is rejected as
 * overlapping paths — so bounding it would cost a second write on every single
 * resolution. The ceiling is instead accepted and documented: at roughly 100
 * bytes an entry, the 400 KB item limit lands near 4,000 guesses.
 *
 * @throws {GuessAlreadyResolvedError} when another caller got there first.
 */
export async function resolveGuess(
  playerId: string,
  guessId: string,
  delta: 1 | -1,
  lastResult: LastResult,
): Promise<PlayerItem> {
  try {
    const result = await getDocumentClient().send(
      new UpdateCommand({
        TableName: getTableName(),
        Key: { playerId },
        UpdateExpression:
          "SET #score = #score + :delta, #history = list_append(:result, if_not_exists(#history, :empty)), #updatedAt = :now REMOVE #activeGuess",
        ConditionExpression: "#activeGuess.#id = :guessId",
        ExpressionAttributeNames: {
          "#score": NAMES["#score"],
          "#history": NAMES["#history"],
          "#updatedAt": NAMES["#updatedAt"],
          "#activeGuess": NAMES["#activeGuess"],
          "#id": NAMES["#id"],
        },
        ExpressionAttributeValues: {
          ":delta": delta,
          ":result": [lastResult],
          ":empty": [] as LastResult[],
          ":now": lastResult.resolvedAt,
          ":guessId": guessId,
        },
        ReturnValues: "ALL_NEW",
      }),
    );

    return result.Attributes as PlayerItem;
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) {
      throw new GuessAlreadyResolvedError();
    }
    throw error;
  }
}

export { getPlayer };
