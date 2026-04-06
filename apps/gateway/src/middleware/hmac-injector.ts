/**
 * NOTE: HMAC injection is handled directly in the proxy.ts module rather than
 * as a standalone Hono middleware, because it needs to read the request body
 * and attach headers to the outbound fetch — not to the Hono context.
 *
 * This file is kept as a re-export / documentation reference.
 * See proxy.ts for the actual HMAC signing logic using signRequest().
 */
export { signRequest } from '@longeny/middleware';
