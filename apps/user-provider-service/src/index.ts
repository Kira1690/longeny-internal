import { EventConsumer } from '@longeny/events';
import { createLogger } from '@longeny/utils';
import { config, redisUrl } from './config/index.js';
import { createApp } from './app.js';
import { registerSubscribers } from './events/subscribers.js';

const logger = createLogger('user-provider-service');

async function bootstrap() {
  const { app, publisher, userService } = createApp();

  // ── Event consumer ──
  const consumer = new EventConsumer(redisUrl, 'user-provider-service');
  registerSubscribers(consumer, null, userService);
  await consumer.start();

  // ── Start server ──
  const port = config.USER_PROVIDER_SERVICE_PORT;
  app.listen(port);

  logger.info({ port }, `User & Provider Service started on port ${port}`);

  // ── Graceful shutdown ──
  const shutdown = async () => {
    logger.info('Shutting down...');
    await consumer.stop();
    await publisher.disconnect();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

bootstrap().catch((error) => {
  logger.error({ error }, 'Failed to start User & Provider Service');
  process.exit(1);
});
