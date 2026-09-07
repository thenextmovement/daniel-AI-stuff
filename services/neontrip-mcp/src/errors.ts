export class GatewayError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 500,
    public readonly retryable = false,
    public readonly requiresHumanReview = true,
  ) {
    super(message);
  }
}

export function asGatewayError(error: unknown): GatewayError {
  if (error instanceof GatewayError) return error;
  return new GatewayError("internal_error", "Die Aktion konnte nicht sicher ausgeführt werden.");
}
