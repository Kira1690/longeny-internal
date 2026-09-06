export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly isOperational: boolean;
  public readonly metadata?: Record<string, unknown>;

  constructor(
    message: string,
    statusCode: number,
    code: string,
    isOperational = true,
    metadata?: Record<string, unknown>,
  ) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = isOperational;
    this.metadata = metadata;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * The error body every service returns, built in one place.
 *
 * `errorHandler` produces this shape when something throws. Middleware that runs
 * in `beforeHandle` cannot throw — it has to *return* a body — and the gateway's
 * top-level handler is outside the middleware stack entirely. Both were writing
 * the envelope by hand, so the shape drifted between them: one carried `meta`,
 * another did not, a third spelled the code differently.
 */
export function errorEnvelope(code: string, message: string, details?: Record<string, unknown>) {
  return {
    success: false as const,
    error: { code, message, ...(details ? { details } : {}) },
    meta: { timestamp: new Date().toISOString() },
  };
}
