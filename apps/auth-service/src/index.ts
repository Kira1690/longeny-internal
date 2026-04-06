import Redis from 'ioredis';
import { createLogger } from '@longeny/utils';
import { config, redisUrl } from './config/index.js';
import { initTokenService } from './services/token.service.js';
import { initPublisher } from './events/publishers.js';
import { initSubscribers, startSubscribers } from './events/subscribers.js';
import app from './app.js';

const logger = createLogger('auth-service');

async function bootstrap(): Promise<void> {
  logger.info('Starting auth-service...');

  // Initialize Redis
  const redis = new Redis(redisUrl);
  redis.on('error', (err) => logger.error({ err }, 'Redis connection error'));
  redis.on('connect', () => logger.info('Redis connected'));

  // Initialize services that need Redis
  initTokenService(null, redis);

  // Initialize event publisher
  initPublisher();

  // Initialize and start event subscribers
  initSubscribers(null);
  await startSubscribers();
  logger.info('Event subscribers started');

  // Start Elysia server
  const port = config.AUTH_SERVICE_PORT;

  app.listen(port);
  logger.info({ port }, `Auth service running on port ${port}`);

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down auth-service...');
    await redis.quit();
    logger.info('Auth service stopped');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

bootstrap().catch((err) => {
  logger.fatal({ err }, 'Failed to start auth-service');
  process.exit(1);
});
