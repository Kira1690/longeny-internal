import { createLogger, generateCorrelationId } from '@longeny/utils';
import Elysia from 'elysia';
import { requestCtx } from './request-context.js';

/**
 * Elysia plugin: log request method, path, status, duration.
 * Generates/propagates correlation ID. PII-safe (no body logging).
 */
export const requestLogger = (serviceName: string) => {
  const logger = createLogger(serviceName);

  return new Elysia({ name: `request-logger-${serviceName}` })
    .onRequest(({ request, set }) => {
      const state = requestCtx(request);
      const correlationId = request.headers.get('X-Correlation-ID') || generateCorrelationId();

      state.correlationId = correlationId;
      state.requestStartTime = Date.now();

      set.headers['X-Correlation-ID'] = correlationId;
    })
    .onAfterResponse({ as: 'scoped' }, ({ request, set }) => {
      const state = requestCtx(request);
      const duration = Date.now() - (state.requestStartTime || Date.now());
      const url = new URL(request.url);

      logger.info({
        method: request.method,
        path: url.pathname,
        status: set.status,
        duration,
        correlationId: state.correlationId,
        userAgent: request.headers.get('User-Agent'),
      });
    });
};
