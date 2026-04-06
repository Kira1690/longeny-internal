import Elysia from 'elysia';
import Redis from 'ioredis';
import { TooManyRequestsError } from '@longeny/errors';

export interface RateLimitConfig {
  windowMs: number;
  max: number;
  keyPrefix?: string;
}

/**
 * Elysia plugin: Redis-based sliding window rate limiter.
 * Uses INCR + EXPIRE for each unique IP key.
 */
export const rateLimit = (config: RateLimitConfig) => {
  const { windowMs, max, keyPrefix = 'global' } = config;
  const windowSeconds = Math.ceil(windowMs / 1000);

  const redisHost = Bun.env.REDIS_HOST || 'localhost';
  const redisPort = Number(Bun.env.REDIS_PORT) || 6379;
  const redisPassword = Bun.env.REDIS_PASSWORD || undefined;
  const redis = new Redis({
    host: redisHost,
    port: redisPort,
    password: redisPassword,
    lazyConnect: true,
  });

  let connected = false;

  return new Elysia({ name: `rate-limit-${keyPrefix}` })
    .onBeforeHandle(async ({ request, set, error }) => {
      if (!connected) {
        await redis.connect();
        connected = true;
      }

      const ip =
        request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
        request.headers.get('X-Real-IP') ||
        'unknown';

      const key = `ratelimit:${keyPrefix}:${ip}`;

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
    });
};
