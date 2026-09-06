import { UnauthorizedError } from '@longeny/errors';
import { hmacSign, hmacVerify } from '@longeny/utils';
import Elysia from 'elysia';
import { requestCtx } from './request-context.js';

const HMAC_MAX_AGE_MS = 30_000; // 30 seconds

/**
 * Elysia plugin: verify HMAC signature on incoming inter-service requests.
 * Checks X-Service-Name, X-Timestamp, X-Signature headers.
 * Rejects requests with timestamps older than 30 seconds.
 */
export const verifyHmac = (secret: string) =>
  new Elysia({ name: `verify-hmac-${secret.slice(0, 8)}` })
    // Capture the raw request body exactly once, in the parse phase (before
    // Elysia's default body parser runs). The signature is computed over the
    // raw bytes the caller signed, so we must read them here — reading the
    // stream again in beforeHandle would throw ERR_BODY_ALREADY_USED. We stash
    // the raw string on the store and return the parsed value so downstream
    // body validation still works. 'scoped' keeps this bound to the instance
    // that .use()s the plugin (its /internal routes), not the whole app.
    .onParse({ as: 'scoped' }, async ({ request }) => {
      const raw = await request.text();
      requestCtx(request).rawBody = raw;
      if (!raw) return '';
      const contentType = request.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        try {
          return JSON.parse(raw);
        } catch {
          return raw;
        }
      }
      return raw;
    })
    // 'scoped' so the guard propagates to the routes of the instance that
    // .use()s this plugin. Without it the hook stays local to this (route-less)
    // plugin and the parent's /internal/* routes run unauthenticated.
    .onBeforeHandle({ as: 'scoped' }, async ({ request, set }) => {
      const ctx = requestCtx(request);
      const serviceName = request.headers.get('X-Service-Name');
      const timestamp = request.headers.get('X-Timestamp');
      const signature = request.headers.get('X-Signature');

      if (!serviceName || !timestamp || !signature) {
        set.status = 401;
        return {
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Missing HMAC authentication headers' },
        };
      }

      // Replay attack prevention
      const age = Date.now() - Number.parseInt(timestamp, 10);
      if (Math.abs(age) > HMAC_MAX_AGE_MS) {
        set.status = 401;
        return {
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Request timestamp outside acceptable window' },
        };
      }

      const method = request.method.toUpperCase();
      // Path AND query. The signing clients (`createServiceClient`, the gateway
      // proxy) build one string containing both, so verifying over the pathname
      // alone rejected every internal call that carried query parameters — and,
      // worse, would have left those parameters outside the signature on the
      // calls it did accept. `?providerId=` deciding who may read a patient's
      // records is exactly the value that has to be covered.
      const url = new URL(request.url);
      const path = `${url.pathname}${url.search}`;
      // store is a shared singleton and onParse only runs for bodied requests;
      // bodiless methods are always signed over an empty body, so pin them to ''
      // rather than risk reading a previous request's stale rawBody.
      const hasBody = method !== 'GET' && method !== 'HEAD' && method !== 'DELETE';
      const body = hasBody ? (ctx.rawBody ?? '') : '';

      const isValid = hmacVerify(signature, method, path, timestamp, body, secret);

      if (!isValid) {
        set.status = 401;
        return {
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Invalid HMAC signature' },
        };
      }

      ctx.serviceName = serviceName;
    });

/**
 * Utility to create HMAC headers for outbound inter-service requests.
 */
/**
 * Sign an outbound internal request.
 *
 * `path` must be the same string the receiver reconstructs: pathname plus query
 * string, with no origin. Signing less than was sent leaves the rest tamperable.
 */
export function signRequest(
  serviceName: string,
  secret: string,
  method: string,
  path: string,
  body: string,
): Record<string, string> {
  const timestamp = Date.now().toString();
  const signature = hmacSign(method.toUpperCase(), path, timestamp, body, secret);

  return {
    'X-Service-Name': serviceName,
    'X-Timestamp': timestamp,
    'X-Signature': signature,
  };
}
