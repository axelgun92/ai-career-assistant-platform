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
