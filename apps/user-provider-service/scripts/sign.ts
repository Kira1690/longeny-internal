/**
 * Print HMAC headers for a service-to-service (internal) request.
 *
 *   set -a; source ../../.env; set +a
 *   bun run scripts/sign.ts POST /internal/notify/profile '{"profileId":"…","body":"hi"}'
 *
 * Signature = HMAC-SHA256(HMAC_SECRET, "METHOD\nPATH\nTIMESTAMP\nSHA256(body)")
 * over the exact raw JSON string that will be sent. Mirrors verifyHmac /
 * signRequest in @longeny/middleware.
 */
import crypto from 'node:crypto';

const [method, path, body = ''] = process.argv.slice(2);
if (!method || !path) {
  console.error('usage: bun run scripts/sign.ts <METHOD> <PATH> [BODY]');
  process.exit(1);
}

const secret = process.env.HMAC_SECRET;
if (!secret) {
  console.error('HMAC_SECRET is not set — did you `source .env`?');
  process.exit(1);
}

const timestamp = Date.now().toString();
const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const signature = crypto
  .createHmac('sha256', secret)
  .update(`${method.toUpperCase()}\n${path}\n${timestamp}\n${sha256(body)}`)
  .digest('hex');

// Emit curl-ready header flags.
console.log(
  `-H "X-Service-Name: ai-content-service" -H "X-Timestamp: ${timestamp}" -H "X-Signature: ${signature}"`,
);
