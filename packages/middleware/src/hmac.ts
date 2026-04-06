import Elysia from 'elysia';
import { UnauthorizedError } from '@longeny/errors';
import { hmacSign, hmacVerify } from '@longeny/utils';

const HMAC_MAX_AGE_MS = 30_000; // 30 seconds

/**
 * Elysia plugin: verify HMAC signature on incoming inter-service requests.
 * Checks X-Service-Name, X-Timestamp, X-Signature headers.
 * Rejects requests with timestamps older than 30 seconds.
 */
export const verifyHmac = (secret: string) =>
  new Elysia({ name: `verify-hmac-${secret.slice(0, 8)}` })
    .state('serviceName', '')
    .onBeforeHandle(async ({ request, store, error }) => {
      const serviceName = request.headers.get('X-Service-Name');
      const timestamp = request.headers.get('X-Timestamp');
      const signature = request.headers.get('X-Signature');

      if (!serviceName || !timestamp || !signature) {
        return error(401, {
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Missing HMAC authentication headers' },
        });
      }

      // Replay attack prevention
      const age = Date.now() - Number.parseInt(timestamp, 10);
      if (Math.abs(age) > HMAC_MAX_AGE_MS) {
        return error(401, {
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Request timestamp outside acceptable window' },
        });
      }

      const method = request.method.toUpperCase();
      const path = new URL(request.url).pathname;
      const body = await request.text();

      const isValid = hmacVerify(signature, method, path, timestamp, body, secret);

      if (!isValid) {
        return error(401, {
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Invalid HMAC signature' },
        });
      }

      store.serviceName = serviceName;
    });

/**
 * Utility to create HMAC headers for outbound inter-service requests.
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
