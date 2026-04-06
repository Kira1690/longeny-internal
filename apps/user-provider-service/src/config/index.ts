import { loadConfig, userProviderConfigSchema, type UserProviderConfig } from '@longeny/config';

export const config: UserProviderConfig = loadConfig(userProviderConfigSchema);

export const redisUrl = `redis://${config.REDIS_PASSWORD ? `:${config.REDIS_PASSWORD}@` : ''}${config.REDIS_HOST}:${config.REDIS_PORT}`;
