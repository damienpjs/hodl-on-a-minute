import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

import { getServerEnv } from "@/lib/env";

/**
 * Lazy singleton. Serverless functions reuse a warm instance across invocations,
 * so building the client once per process is worth the small amount of state.
 */
let documentClient: DynamoDBDocumentClient | undefined;

export function getDocumentClient(): DynamoDBDocumentClient {
  if (documentClient) return documentClient;

  const env = getServerEnv();

  const base = new DynamoDBClient({
    region: env.AWS_REGION,
    credentials: {
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    },
  });

  documentClient = DynamoDBDocumentClient.from(base, {
    marshallOptions: {
      // `activeGuess` and `lastResult` are optional. Without this, writing an
      // item that omits one throws instead of simply leaving it out.
      removeUndefinedValues: true,
    },
  });

  return documentClient;
}

export function getTableName(): string {
  return getServerEnv().DYNAMODB_TABLE;
}
