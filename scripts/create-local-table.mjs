/**
 * Creates the players table in DynamoDB Local.
 *
 * The container stores its data in memory, so the table is gone every time the
 * container restarts. This script is idempotent — just run it again.
 *
 *   npm run db:local:up   # docker run -d -p 8000:8000 amazon/dynamodb-local
 *   npm run db:local
 *
 * Or both plus the dev server, in one command: npm run dev:local.
 *
 * `docker start` returns as soon as the container exists, not when DynamoDB is
 * listening, so this script waits for the port before it creates anything.
 *
 * Against real AWS the equivalent is one CLI call, documented in the README.
 */

import {
  CreateTableCommand,
  DynamoDBClient,
  ListTablesCommand,
  ResourceInUseException,
} from "@aws-sdk/client-dynamodb";

const ENDPOINT = process.env.DYNAMODB_ENDPOINT ?? "http://localhost:8000";
const TABLE = process.env.DYNAMODB_TABLE ?? "hodl-on-a-minute-players";
const REGION = process.env.AWS_REGION ?? "eu-central-1";

const READY_TIMEOUT_MS = 30_000;
const RETRY_INTERVAL_MS = 500;

// DynamoDB Local accepts any credentials but partitions data by access key and
// region, so these must match what the app uses in .env.local.
const client = new DynamoDBClient({
  region: REGION,
  endpoint: ENDPOINT,
  credentials: { accessKeyId: "local", secretAccessKey: "local" },
  maxAttempts: 1,
});

/**
 * Every real DynamoDB reply — errors included — carries an HTTP status. An error
 * without one never reached the service, which while the container boots means
 * either a closed port (ECONNREFUSED) or, more often, Docker accepting the
 * connection a moment before DynamoDB listens behind it (ECONNRESET).
 */
function neverReachedTheService(error) {
  return error?.$metadata?.httpStatusCode === undefined;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitUntilListening() {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let announced = false;

  for (;;) {
    try {
      await client.send(new ListTablesCommand({}));
      if (announced) process.stdout.write("\n");
      return;
    } catch (error) {
      if (!neverReachedTheService(error)) throw error;

      if (Date.now() >= deadline) {
        if (announced) process.stdout.write("\n");
        console.error(
          `No answer from DynamoDB on ${ENDPOINT} after ${READY_TIMEOUT_MS / 1000}s ` +
            `(${error.name}: ${error.message}).\n` +
            "Start it with: npm run db:local:up",
        );
        process.exit(1);
      }

      if (!announced) {
        process.stdout.write(`Waiting for DynamoDB Local at ${ENDPOINT}`);
        announced = true;
      }
      process.stdout.write(".");
      await sleep(RETRY_INTERVAL_MS);
    }
  }
}

await waitUntilListening();

try {
  await client.send(
    new CreateTableCommand({
      TableName: TABLE,
      AttributeDefinitions: [{ AttributeName: "playerId", AttributeType: "S" }],
      KeySchema: [{ AttributeName: "playerId", KeyType: "HASH" }],
      BillingMode: "PAY_PER_REQUEST",
    }),
  );
  console.log(`Created table "${TABLE}" at ${ENDPOINT}`);
} catch (error) {
  if (error instanceof ResourceInUseException) {
    console.log(`Table "${TABLE}" already exists at ${ENDPOINT} — nothing to do`);
  } else {
    throw error;
  }
}
