import {
  readEvaluationWorkerEnvironment,
  readSemanticEnvironment,
} from "@ai-career/shared";
import { ZodError } from "zod";
import { semanticExecutorConfigFromEnvironment } from "./semantic-execution-config";

// Whether real (paid) AI evaluation is configured. Reports variable names
// only; values are never returned or logged.

// Placeholder values that earlier .env.example versions shipped with.
export const openAiKeyPlaceholders: readonly string[] = ["YOUR_OPENAI_API_KEY"];

export type ConfigurationState = "configured" | "missing" | "placeholder" | "invalid";

export interface ConfigurationStatus {
  state: ConfigurationState;
  // Environment variable names with a problem; never values.
  variables: string[];
}

type Environment = NodeJS.ProcessEnv;

function issueVariables(error: unknown): string[] {
  if (error instanceof ZodError) {
    return [...new Set(error.issues.map((issue) => String(issue.path[0] ?? "configuration")))];
  }
  return ["AI_OPERATION_EXECUTION_OVERRIDES_JSON"];
}

export function aiConfigurationStatus(environment: Environment = process.env): ConfigurationStatus {
  const key = environment.OPENAI_API_KEY?.trim() ?? "";
  if (!key) return { state: "missing", variables: ["OPENAI_API_KEY"] };
  if (openAiKeyPlaceholders.includes(key)) return { state: "placeholder", variables: ["OPENAI_API_KEY"] };
  try {
    semanticExecutorConfigFromEnvironment(readSemanticEnvironment(environment));
    readEvaluationWorkerEnvironment(environment);
    return { state: "configured", variables: [] };
  } catch (error) {
    return { state: "invalid", variables: issueVariables(error) };
  }
}

export function describeConfigurationProblem(status: ConfigurationStatus): string {
  switch (status.state) {
    case "configured":
      return "AI evaluation is configured.";
    case "missing":
      return "OPENAI_API_KEY is not set, so real AI evaluation is unavailable.";
    case "placeholder":
      return "OPENAI_API_KEY still has the example placeholder value; set a real key.";
    case "invalid":
      return `AI evaluation configuration is invalid: ${status.variables.join(", ")}.`;
  }
}
