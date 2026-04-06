const CORRELATION_ID_HEADER = 'x-correlation-id';

/**
 * Generate a new correlation ID using crypto.randomUUID().
 */
export function generateCorrelationId(): string {
  return crypto.randomUUID();
}

/**
 * Extract correlation ID from headers, or generate a new one.
 */
export function getCorrelationId(headers: Headers | Record<string, string | undefined>): string {
  if (headers instanceof Headers) {
    return headers.get(CORRELATION_ID_HEADER) || generateCorrelationId();
  }
  return headers[CORRELATION_ID_HEADER] || generateCorrelationId();
}

export { CORRELATION_ID_HEADER };
