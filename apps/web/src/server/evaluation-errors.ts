export class EvaluationApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    // Safe, product-owned detail for the client (for example the duplicate
    // opportunity a refusal refers to).
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "EvaluationApiError";
  }
}
