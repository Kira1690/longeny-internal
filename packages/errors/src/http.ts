import { AppError } from './base.js';

export class BadRequestError extends AppError {
  constructor(message = 'Bad request', code = 'BAD_REQUEST', metadata?: Record<string, unknown>) {
    super(message, 400, code, true, metadata);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized', code = 'UNAUTHORIZED') {
    super(message, 401, code);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden', code = 'FORBIDDEN') {
    super(message, 403, code);
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Resource', id?: string) {
    super(
      id ? `${resource} with id '${id}' not found` : `${resource} not found`,
      404,
      'NOT_FOUND',
      true,
      { resource, id },
    );
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflict', code = 'CONFLICT') {
    super(message, 409, code);
  }
}

/**
 * The request was understood and well-formed, but the domain refuses it — a
 * state machine that does not allow the move, a rule that does not permit the
 * combination. Distinct from 400, which means the request itself was malformed,
 * and from 409, which means the resource changed underneath the caller.
 */
export class UnprocessableEntityError extends AppError {
  constructor(message: string, code = 'UNPROCESSABLE_ENTITY', metadata?: Record<string, unknown>) {
    super(message, 422, code, true, metadata);
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message = 'Too many requests', retryAfterSeconds?: number) {
    super(message, 429, 'RATE_LIMITED', true, { retryAfterSeconds });
  }
}

export class InternalError extends AppError {
  constructor(message = 'Internal server error') {
    super(message, 500, 'INTERNAL_ERROR', false);
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(service: string) {
    super(`Service '${service}' is unavailable`, 503, 'SERVICE_UNAVAILABLE', true, { service });
  }
}
