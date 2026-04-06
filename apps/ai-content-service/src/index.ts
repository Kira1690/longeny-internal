import { config } from './config/index.js';
import { createApp } from './app.js';
import { startSubscribers, stopSubscribers } from './events/subscribers.js';
import { disconnectPublisher } from './events/publishers.js';
import { createLogger } from '@longeny/utils';

const logger = createLogger('ai-content-service');

const app = createApp();
const port = config.AI_CONTENT_SERVICE_PORT;

// ── Start event subscribers ──
const consumer = startSubscribers();

// ── Start HTTP server ──
app.listen(port);

logger.info({ port, env: config.NODE_ENV }, 'AI & Content Service started');

// ── Graceful shutdown ──
async function shutdown(signal: string) {
  logger.info({ signal }, 'Shutdown signal received');

  try {
    await stopSubscribers();
    await disconnectPublisher();
    logger.info('Graceful shutdown completed');
  } catch (error) {
    logger.error({ error }, 'Error during shutdown');
  }

  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
