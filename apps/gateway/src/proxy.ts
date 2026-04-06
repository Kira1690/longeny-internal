import { signRequest } from '@longeny/middleware';
import { getConfig } from './config/index.js';

/**
 * Hop-by-hop headers that must not be forwarded by a proxy.
 */
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

interface ProxyContext {
  request: Request;
  store: Record<string, any>;
}

/**
 * Fetch-based reverse proxy for Bun + Elysia.
 * Forwards the full request (method, headers, body, query params) to the
 * target service, injecting HMAC authentication and forwarding headers.
 */
export async function proxyRequest(ctx: ProxyContext, targetBaseUrl: string): Promise<Response> {
  const { request, store } = ctx;
  const url = new URL(request.url);
  const targetUrl = `${targetBaseUrl}${url.pathname}${url.search}`;
  const config = getConfig();

  // Clone incoming headers
  const headers = new Headers();
  for (const [key, value] of request.headers.entries()) {
    if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
      headers.set(key, value);
    }
  }

  // Forwarding headers
  const clientIp =
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
    request.headers.get('X-Real-IP') ||
    'unknown';
  headers.set('X-Forwarded-For', clientIp);
  headers.set('X-Real-IP', clientIp);
  headers.set('X-Forwarded-Host', url.host);
  headers.set('X-Forwarded-Proto', url.protocol.replace(':', ''));

  // Propagate correlation ID (already set by requestLogger middleware)
  const correlationId = store.correlationId as string | undefined;
  if (correlationId) {
    headers.set('X-Correlation-ID', correlationId);
  }

  // Propagate authenticated user info to downstream services
  const userId = store.userId as string | undefined;
  if (userId) {
    headers.set('X-User-ID', userId);
    headers.set('X-User-Email', (store.userEmail as string) || '');
    headers.set('X-User-Role', (store.userRole as string) || '');
  }

  // Read body for HMAC signing (only for methods that carry a body)
  const method = request.method.toUpperCase();
  let body: string | undefined;
  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    body = await request.text();
  }

  // Sign request with HMAC for downstream service-to-service auth
  const hmacHeaders = signRequest(
    'gateway',
    config.HMAC_SECRET,
    method,
    url.pathname,
    body || '',
  );
  for (const [key, value] of Object.entries(hmacHeaders)) {
    headers.set(key, value);
  }

  const response = await fetch(targetUrl, {
    method,
    headers,
    body: body !== undefined ? body : undefined,
    // @ts-ignore — Bun supports duplex for streaming request bodies
    duplex: 'half',
  });

  // Build response, stripping hop-by-hop headers from upstream
  const responseHeaders = new Headers();
  for (const [key, value] of response.headers.entries()) {
    if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
      responseHeaders.set(key, value);
    }
  }

  // Propagate correlation ID on the response
  if (correlationId) {
    responseHeaders.set('X-Correlation-ID', correlationId);
  }

  return new Response(response.body, {
    status: response.status,
    headers: responseHeaders,
  });
}
