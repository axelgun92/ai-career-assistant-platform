import { z } from "zod";

const postgresConnectionString = z.string().min(1).refine(
  (value) => {
    try {
      const protocol = new URL(value).protocol;
      return protocol === "postgresql:" || protocol === "postgres:";
    } catch {
      return false;
    }
  },
  { message: "DATABASE_URL must be a PostgreSQL connection string" },
);

export const serverEnvironmentSchema = z.object({
  DATABASE_URL: postgresConnectionString,
});

export type ServerEnvironment = z.infer<typeof serverEnvironmentSchema>;

export function readServerEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): ServerEnvironment {
  return serverEnvironmentSchema.parse(environment);
}

export const semanticEnvironmentSchema = z.object({
  OPENAI_API_KEY: z.string().trim().min(1),
  AI_MODEL: z.string().trim().min(1),
  AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().max(100_000),
  AI_RETRY_LIMIT: z.coerce.number().int().min(0).max(5),
  AI_CALL_BUDGET: z.coerce.number().int().positive().max(100),
  AI_REQUEST_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(600_000),
});

export const evaluationWorkerEnvironmentSchema = z.object({
  EVALUATION_JOB_MAX_ATTEMPTS: z.coerce.number().int().positive().max(10),
  EVALUATION_JOB_LEASE_SECONDS: z.coerce.number().int().min(30).max(3_600),
  EVALUATION_WORKER_POLL_MS: z.coerce.number().int().min(100).max(60_000),
});

export type SemanticEnvironment = z.infer<typeof semanticEnvironmentSchema>;
export type EvaluationWorkerEnvironment = z.infer<
  typeof evaluationWorkerEnvironmentSchema
>;

export function readSemanticEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): SemanticEnvironment {
  return semanticEnvironmentSchema.parse(environment);
}

export function readEvaluationWorkerEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): EvaluationWorkerEnvironment {
  return evaluationWorkerEnvironmentSchema.parse(environment);
}
