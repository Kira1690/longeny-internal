import { createLogger } from '@longeny/utils';
import app from './app.js';
import { config } from './config/index.js';
import { disconnectPublisher } from './events/publishers.js';
import { startConsumer, stopConsumer } from './events/subscribers.js';

const logger = createLogger('payment-service');

const port = config.PAYMENT_SERVICE_PORT;

// Start event consumer
startConsumer().catch((error) => {
  logger.error({ error }, 'Failed to start event consumer');
});

// Start Elysia server
app.listen(port);

logger.info({ port }, `Payment service running on port ${port}`);

// Graceful shutdown
const shutdown = async () => {
  logger.info('Shutting down payment service...');
  try {
    await stopConsumer();
    await disconnectPublisher();
    logger.info('Payment service stopped');
    process.exit(0);
  } catch (error) {
    logger.error({ error }, 'Error during shutdown');
    process.exit(1);
  }
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
