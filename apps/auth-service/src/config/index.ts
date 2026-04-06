import { loadConfig, authConfigSchema, type AuthConfig } from '@longeny/config';

export const config: AuthConfig = loadConfig(authConfigSchema);

export const redisUrl = `redis://${config.REDIS_PASSWORD ? `:${config.REDIS_PASSWORD}@` : ''}${config.REDIS_HOST}:${config.REDIS_PORT}`;
