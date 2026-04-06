import { loadConfig, aiContentConfigSchema, type AiContentConfig } from '@longeny/config';

export const config: AiContentConfig = loadConfig(aiContentConfigSchema);

export const redisUrl = `redis://${config.REDIS_PASSWORD ? `:${config.REDIS_PASSWORD}@` : ''}${config.REDIS_HOST}:${config.REDIS_PORT}`;
