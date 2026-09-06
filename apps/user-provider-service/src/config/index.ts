import { type UserProviderConfig, loadConfig, userProviderConfigSchema } from '@longeny/config';

export const config = loadConfig(userProviderConfigSchema) as UserProviderConfig;

export const redisUrl = `redis://${config.REDIS_PASSWORD ? `:${config.REDIS_PASSWORD}@` : ''}${config.REDIS_HOST}:${config.REDIS_PORT}`;
