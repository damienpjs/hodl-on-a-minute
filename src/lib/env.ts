import { z } from "zod";

/**
 * Server-side environment, validated once on first use.
 *
 * Read lazily rather than at module scope: `next build` imports these modules
 * without the runtime environment, and a top-level throw would turn a missing
 * variable into a failed build instead of a clear runtime error.
 */
const serverEnvSchema = z.object({
  AWS_REGION: z.string().min(1),
  AWS_ACCESS_KEY_ID: z.string().min(1),
  AWS_SECRET_ACCESS_KEY: z.string().min(1),
  DYNAMODB_TABLE: z.string().min(1),
  // Points the SDK at DynamoDB Local for development and integration tests.
  // Absent in production, and deliberately so: the real AWS endpoint is what you
  // get by default, never something you must remember to switch back to.
  //
  // An empty value counts as absent — `DYNAMODB_ENDPOINT=` in a .env file is a
  // variable that exists, and a bare `.optional()` would reject it rather than
  // ignore it.
  DYNAMODB_ENDPOINT: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.url().optional(),
  ),
  // Long enough that a signature cannot be brute-forced; `openssl rand -base64 32`.
  COOKIE_SECRET: z.string().min(32),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | undefined;

export function getServerEnv(): ServerEnv {
  if (cached) return cached;

  const parsed = serverEnvSchema.safeParse(process.env);

  if (!parsed.success) {
    const missing = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join(", ");
    throw new Error(
      `Invalid server environment (${missing}). Copy .env.example to .env.local and fill it in.`,
    );
  }

  cached = parsed.data;
  return cached;
}
