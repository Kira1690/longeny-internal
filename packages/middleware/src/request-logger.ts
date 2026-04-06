import Elysia from 'elysia';
import { createLogger, generateCorrelationId } from '@longeny/utils';

/**
 * Elysia plugin: log request method, path, status, duration.
 * Generates/propagates correlation ID. PII-safe (no body logging).
 */
export const requestLogger = (serviceName: string) => {
  const logger = createLogger(serviceName);

  return new Elysia({ name: `request-logger-${serviceName}` })
    .state('correlationId', '')
    .state('requestStartTime', 0)
    .onRequest(({ request, store, set }) => {
      const correlationId =
        request.headers.get('X-Correlation-ID') || generateCorrelationId();

      store.correlationId = correlationId;
      store.requestStartTime = Date.now();

      set.headers['X-Correlation-ID'] = correlationId;
    })
    .onAfterResponse(({ request, set, store }) => {
      const duration = Date.now() - (store.requestStartTime || Date.now());
      const url = new URL(request.url);

      logger.info({
        method: request.method,
        path: url.pathname,
        status: set.status,
        duration,
        correlationId: store.correlationId,
        userAgent: request.headers.get('User-Agent'),
      });
    });
};
