export class StageExecutionError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(input: { code: string; message: string; retryable: boolean }) {
    super(input.message);
    this.name = "StageExecutionError";
    this.code = input.code;
    this.retryable = input.retryable;
  }
}

export class StructuredOutputValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StructuredOutputValidationError";
  }
}
