import { EventConsumer } from '@longeny/events';
import { createLogger } from '@longeny/utils';
import { createApp } from './app.js';
import { registerSubscribers } from './events/subscribers.js';

const logger = createLogger('booking-service');

async function bootstrap(): Promise<void> {
  const { app, config, redis, publisher, reminderService, bookingService, notificationService } = createApp();

  // ── Connect Redis ──
  await redis.connect();
  logger.info('Redis connected');

  // ── Event consumer ──
  const consumer = new EventConsumer(
    `redis://${config.REDIS_PASSWORD ? `:${config.REDIS_PASSWORD}@` : ''}${config.REDIS_HOST}:${config.REDIS_PORT}`,
    'booking-service',
  );
  registerSubscribers(consumer, null, bookingService, notificationService);
  await consumer.start();
  logger.info('Event subscribers started');

  // ── Start reminder polling ──
  reminderService.start();
  logger.info('Reminder polling started');

  // ── Start server ──
  const port = config.BOOKING_SERVICE_PORT;
  app.listen(port);

  logger.info({ port, env: config.NODE_ENV }, `Booking service started on port ${port}`);

  // ── Graceful shutdown ──
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down booking service');
    reminderService.stop();
    await consumer.stop();
    await publisher.disconnect();
    await redis.quit();
    logger.info('Booking service stopped');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

bootstrap().catch((error) => {
  logger.fatal({ error }, 'Failed to start booking service');
  process.exit(1);
});
