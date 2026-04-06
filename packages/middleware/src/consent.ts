import Elysia from 'elysia';
import Redis from 'ioredis';
import { ConsentRequiredError } from '@longeny/errors';
import type { ConsentType } from '@longeny/types';
import { authStore } from './auth.js';

const CONSENT_CACHE_TTL = 300; // 5 minutes in seconds

interface ConsentCheckResult {
  granted: string[];
}

/**
 * Elysia plugin: verify that the authenticated user has granted
 * all required consent types. Checks Auth Service internal endpoint
 * with Redis caching (5 min TTL).
 */
export const requireConsent = (...requiredTypes: ConsentType[]) =>
  new Elysia({ name: `require-consent-${requiredTypes.join('-')}` })
    .use(authStore())
    .onBeforeHandle(async ({ store, error }) => {
      const userId = store.userId;

      if (!userId) {
        throw new ConsentRequiredError(requiredTypes);
      }

      const redisHost = Bun.env.REDIS_HOST || 'localhost';
      const redisPort = Number(Bun.env.REDIS_PORT) || 6379;
      const redisPassword = Bun.env.REDIS_PASSWORD || undefined;
      const redis = new Redis({ host: redisHost, port: redisPort, password: redisPassword });

      try {
        const cacheKey = `consent:${userId}`;
        const cached = await redis.get(cacheKey);

        let grantedConsents: string[];

        if (cached) {
          grantedConsents = JSON.parse(cached) as string[];
        } else {
          // Call Auth Service internal endpoint to fetch user consents
          const authServiceUrl = Bun.env.AUTH_SERVICE_URL || 'http://localhost:3001';
          const response = await fetch(`${authServiceUrl}/internal/consents/${userId}`);

          if (!response.ok) {
            throw new ConsentRequiredError(requiredTypes);
          }

          const data = (await response.json()) as ConsentCheckResult;
          grantedConsents = data.granted;

          // Cache for 5 minutes
          await redis.set(cacheKey, JSON.stringify(grantedConsents), 'EX', CONSENT_CACHE_TTL);
        }

        const missingConsents = requiredTypes.filter(
          (type) => !grantedConsents.includes(type),
        );

        if (missingConsents.length > 0) {
          throw new ConsentRequiredError(missingConsents);
        }
      } finally {
        await redis.quit();
      }
    });
