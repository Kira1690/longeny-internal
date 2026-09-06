import { generateCorrelationId } from './correlation-id.js';
import { hmacSign } from './crypto.js';

export interface ServiceClientOptions {
  serviceName: string;
  baseUrl: string;
  hmacSecret: string;
}

export interface RequestOptions {
  method?: string;
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
  correlationId?: string;
}

/**
 * A non-2xx answer from another service, with the status preserved.
 *
 * Callers need the status to react correctly: a 404 from the profile-resolution
 * route means "not this account's profile" and must be answered 404, while a 502
 * means the service is down and must not be reported as a missing profile. A
 * plain `Error` collapsed both into "something went wrong", so a downstream
 * outage looked exactly like an authorisation failure.
 */
export class ServiceCallError extends Error {
  constructor(
    public readonly status: number,
    public readonly method: string,
    public readonly url: string,
    public readonly body: string,
  ) {
    super(`Service call failed: ${method} ${url} returned ${status}: ${body}`);
    this.name = 'ServiceCallError';
  }
}

/**
 * Create an HMAC-signed HTTP client for inter-service communication.
 * Auto-adds X-Service-Name, X-Timestamp, X-Signature headers.
 */
export function createServiceClient(serviceName: string, baseUrl: string, hmacSecret: string) {
  async function request<T = unknown>(options: RequestOptions): Promise<T> {
    const method = (options.method || 'GET').toUpperCase();
    const url = `${baseUrl}${options.path}`;
    const bodyStr = options.body ? JSON.stringify(options.body) : '';
    const timestamp = Date.now().toString();
    const correlationId = options.correlationId || generateCorrelationId();

    const signature = hmacSign(method, options.path, timestamp, bodyStr, hmacSecret);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Service-Name': serviceName,
      'X-Timestamp': timestamp,
      'X-Signature': signature,
      'X-Correlation-ID': correlationId,
      ...options.headers,
    };

    const response = await fetch(url, {
      method,
      headers,
      body: bodyStr || undefined,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'Unknown error');
      throw new ServiceCallError(response.status, method, url, errorBody);
    }

    return response.json() as Promise<T>;
  }

  return {
    get: <T = unknown>(path: string, opts?: Omit<RequestOptions, 'path' | 'method'>) =>
      request<T>({ ...opts, path, method: 'GET' }),

    post: <T = unknown>(
      path: string,
      body?: unknown,
      opts?: Omit<RequestOptions, 'path' | 'method' | 'body'>,
    ) => request<T>({ ...opts, path, method: 'POST', body }),

    put: <T = unknown>(
      path: string,
      body?: unknown,
      opts?: Omit<RequestOptions, 'path' | 'method' | 'body'>,
    ) => request<T>({ ...opts, path, method: 'PUT', body }),

    patch: <T = unknown>(
      path: string,
      body?: unknown,
      opts?: Omit<RequestOptions, 'path' | 'method' | 'body'>,
    ) => request<T>({ ...opts, path, method: 'PATCH', body }),

    delete: <T = unknown>(path: string, opts?: Omit<RequestOptions, 'path' | 'method'>) =>
      request<T>({ ...opts, path, method: 'DELETE' }),
  };
}
