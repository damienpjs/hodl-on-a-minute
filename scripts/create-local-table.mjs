/**
 * Creates the players table in DynamoDB Local.
 *
 * The container stores its data in memory, so the table is gone every time the
 * container restarts. This script is idempotent — just run it again.
 *
 *   docker run -d -p 8000:8000 --name hodl-ddb amazon/dynamodb-local
 *   npm run db:local
 *
 * Against real AWS the equivalent is one CLI call, documented in the README.
 */

import {
  CreateTableCommand,
  DynamoDBClient,
  ResourceInUseException,
} from "@aws-sdk/client-dynamodb";

const ENDPOINT = process.env.DYNAMODB_ENDPOINT ?? "http://localhost:8000";
const TABLE = process.env.DYNAMODB_TABLE ?? "hodl-on-a-minute-players";
const REGION = process.env.AWS_REGION ?? "eu-central-1";

// DynamoDB Local accepts any credentials but partitions data by access key and
// region, so these must match what the app uses in .env.local.
const client = new DynamoDBClient({
  region: REGION,
  endpoint: ENDPOINT,
  credentials: { accessKeyId: "local", secretAccessKey: "local" },
});

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
  } else if (error?.name === "ECONNREFUSED" || error?.code === "ECONNREFUSED") {
    console.error(
      `Nothing listening on ${ENDPOINT}.\n` +
        "Start it with: docker run -d -p 8000:8000 --name hodl-ddb amazon/dynamodb-local",
    );
    process.exit(1);
  } else {
    throw error;
  }
}
