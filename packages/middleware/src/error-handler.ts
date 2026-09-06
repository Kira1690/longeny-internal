import { AppError } from '@longeny/errors';
import type { ApiErrorResponse } from '@longeny/types';
import { createLogger } from '@longeny/utils';
import Elysia from 'elysia';

const logger = createLogger('error-handler');

/**
 * Elysia plugin: catch AppError instances and format as ApiErrorResponse.
 * Sanitizes PII from error details and logs with correlation ID.
 * For non-AppError, returns generic 500.
 * Register as the FIRST plugin in the app chain (.use(errorHandler())).
 */
export const errorHandler = () =>
  new Elysia({ name: 'error-handler' }).onError(
    { as: 'global' },
    ({ error, request, set, code }) => {
      const correlationId = request.headers.get('X-Correlation-ID') || 'unknown';

      // AppError must be checked FIRST — Elysia v1.4 sets code='NOT_FOUND' for any
      // thrown error with statusCode 404, which masks our AppError(404, 'NOT_FOUND')
      // behind the generic "Route not found" message if Elysia codes are checked first.
      if (error instanceof AppError) {
        if (!error.isOperational) {
          logger.error(
            { err: error, correlationId, statusCode: error.statusCode },
            'Non-operational error occurred',
          );
        } else {
          logger.warn(
            {
              code: error.code,
              message: error.message,
              correlationId,
              statusCode: error.statusCode,
            },
            'Operational error',
          );
        }

        set.status = error.statusCode;

        const response: ApiErrorResponse = {
          success: false,
          error: {
            code: error.code,
            message: error.message,
            details: error.isOperational ? error.metadata : undefined,
          },
          meta: {
            timestamp: new Date().toISOString(),
            requestId: correlationId,
          },
        };

        return response;
      }

      // Elysia built-in errors (checked after AppError to avoid masking 404 AppErrors)
      if (code === 'NOT_FOUND') {
        set.status = 404;
        return {
          success: false,
          error: { code: 'NOT_FOUND', message: 'Route not found' },
          meta: { timestamp: new Date().toISOString(), requestId: correlationId },
        };
      }

      if (code === 'VALIDATION') {
        set.status = 400;
        return {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Request validation failed',
            details: validationDetails(error),
          },
          meta: { timestamp: new Date().toISOString(), requestId: correlationId },
        };
      }

      // Unhandled / non-operational error
      logger.error({ err: error, correlationId }, 'Unhandled error');

      set.status = 500;

      const response: ApiErrorResponse = {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred',
        },
        meta: {
          timestamp: new Date().toISOString(),
          requestId: correlationId,
        },
      };

      return response;
    },
  );

/**
 * Which fields failed, and why — never what was sent.
 *
 * A bare "Request validation failed" gives a client nothing to act on, and every
 * validated route in the repo returned exactly that. The field path and the
 * validator's own message are enough to fix the request; the submitted values
 * are not included, because request bodies carry passwords and health data and
 * this response is logged and shown to users.
 */
function validationDetails(
  error: unknown,
): { fields: Array<{ field: string; message: string }> } | undefined {
  // Zod (via the standard-schema bridge) reports `issues`; Elysia's own
  // TypeBox validation reports a single `path`/`message` pair.
  const candidate = error as {
    issues?: Array<{ path?: Array<string | number>; message?: string }>;
    all?: Array<{ path?: string; message?: string; schema?: unknown }>;
    path?: string;
    message?: string;
  };

  if (Array.isArray(candidate.issues) && candidate.issues.length > 0) {
    return {
      fields: candidate.issues.map((issue) => ({
        field: (issue.path ?? []).join('.') || '(root)',
        message: issue.message ?? 'Invalid value',
      })),
    };
  }

  if (Array.isArray(candidate.all) && candidate.all.length > 0) {
    return {
      fields: candidate.all
        .filter((entry) => entry.message)
        .map((entry) => ({
          field: (entry.path ?? '').replace(/^\//, '').replace(/\//g, '.') || '(root)',
          message: entry.message as string,
        })),
    };
  }

  if (typeof candidate.path === 'string') {
    return {
      fields: [
        {
          field: candidate.path.replace(/^\//, '').replace(/\//g, '.') || '(root)',
          message: candidate.message ?? 'Invalid value',
        },
      ],
    };
  }

  return undefined;
}
