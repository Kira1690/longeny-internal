import Elysia from 'elysia';
import { AppError } from '@longeny/errors';
import type { ApiErrorResponse } from '@longeny/types';
import { createLogger } from '@longeny/utils';

const logger = createLogger('error-handler');

/**
 * Elysia plugin: catch AppError instances and format as ApiErrorResponse.
 * Sanitizes PII from error details and logs with correlation ID.
 * For non-AppError, returns generic 500.
 * Register as the FIRST plugin in the app chain (.use(errorHandler())).
 */
export const errorHandler = () =>
  new Elysia({ name: 'error-handler' })
    .onError({ as: 'global' }, ({ error, request, set, code }) => {
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
            { code: error.code, message: error.message, correlationId, statusCode: error.statusCode },
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
          error: { code: 'VALIDATION_ERROR', message: 'Request validation failed' },
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
    });
