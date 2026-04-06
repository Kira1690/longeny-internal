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
    .onError(({ error, request, set }) => {
      const correlationId = request.headers.get('X-Correlation-ID') || 'unknown';

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
