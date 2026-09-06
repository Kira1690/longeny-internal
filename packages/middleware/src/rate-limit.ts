import { TooManyRequestsError } from '@longeny/errors';
import Elysia from 'elysia';
import Redis from 'ioredis';
import { requestCtx } from './request-context.js';

export interface RateLimitConfig {
  windowMs: number;
  max: number;
  keyPrefix?: string;
  /**
   * What the limit counts.
   * `'ip'` (default) suits public routes. `'account'` suits authenticated
   * routes that are expensive or abusable — one office behind a single NAT
   * address should not exhaust everyone's budget, and one account should not
   * escape its own by changing address. Falls back to IP when the request is
   * not authenticated.
   */
  by?: 'ip' | 'account';
}

/**
 * Elysia plugin: Redis-based fixed-window rate limiter.
 * Counts with INCR + EXPIRE per key.
 */
export const rateLimit = (config: RateLimitConfig) => {
  const { windowMs, max, keyPrefix = 'global', by = 'ip' } = config;
  const windowSeconds = Math.ceil(windowMs / 1000);

  const redis = new Redis({
    host: Bun.env.REDIS_HOST || 'localhost',
    port: Number(Bun.env.REDIS_PORT) || 6379,
    password: Bun.env.REDIS_PASSWORD || undefined,
    lazyConnect: true,
  });

  // Concurrent first requests must share one connect attempt: calling connect()
  // twice on the same client throws.
  let connecting: Promise<void> | null = null;
  const ensureConnected = async () => {
    if (redis.status === 'ready') return;
    if (!connecting) {
      connecting = (async () => {
        if (redis.status === 'wait') {
          await redis.connect();
          return;
        }
        if (redis.status === 'connecting' || redis.status === 'connect') {
          await new Promise<void>((resolve, reject) => {
            redis.once('ready', resolve);
            redis.once('error', reject);
          });
        }
      })().finally(() => {
        connecting = null;
      });
    }
    await connecting;
  };

  /**
   * The same check as a bare handler, for a route that needs the limit without
   * imposing it on its neighbours.
   *
   * A plugin's `{ as: 'scoped' }` hook propagates to every route declared after
   * the `.use()`. On a route file that mixes public and authenticated endpoints
   * that means one endpoint's login budget silently governs all of them — six
   * requests to `/auth/sessions` were enough to trip the login limiter. A route
   * opts in explicitly with `beforeHandle: limiter.guard`. One implementation
   * backs both forms.
   */
  const guard = async ({
    request,
    set,
  }: {
    request: Request;
    set: { headers: Record<string, string>; status?: number | string };
  }) => {
    await ensureConnected();

    const ip =
      request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
      request.headers.get('X-Real-IP') ||
      'unknown';

    const accountId = by === 'account' ? requestCtx(request).userId || undefined : undefined;
    const key = `ratelimit:${keyPrefix}:${accountId ? `account:${accountId}` : `ip:${ip}`}`;

    const current = await redis.incr(key);

    if (current === 1) {
      await redis.expire(key, windowSeconds);
    }

    const remaining = Math.max(0, max - current);
    const ttl = await redis.ttl(key);

    set.headers['X-RateLimit-Limit'] = max.toString();
    set.headers['X-RateLimit-Remaining'] = remaining.toString();
    set.headers['X-RateLimit-Reset'] = (Date.now() + ttl * 1000).toString();

    if (current > max) {
      throw new TooManyRequestsError('Too many requests', ttl);
    }
  };

  const plugin = new Elysia({ name: `rate-limit-${keyPrefix}-${by}` }).onBeforeHandle(
    { as: 'scoped' },
    async ({ request, set }) => {
      await guard({ request, set: set as { headers: Record<string, string> } });
    },
  );

  return Object.assign(plugin, { guard });
};
