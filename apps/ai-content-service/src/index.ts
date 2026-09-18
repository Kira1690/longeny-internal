import { createLogger } from '@longeny/utils';
import { createApp } from './app.js';
import { config } from './config/index.js';
import { disconnectPublisher } from './events/publishers.js';
import { startSubscribers, stopSubscribers } from './events/subscribers.js';
import { ReportReader } from './services/report-reader/reader.js';
import { S3Service } from './services/s3.service.js';

const logger = createLogger('ai-content-service');

const reader = config.REPORT_READER_ENABLED ? new ReportReader(new S3Service()) : null;
const app = createApp(reader);
const port = config.AI_CONTENT_SERVICE_PORT;

// ── Start event subscribers ──
const consumer = startSubscribers();

// ── Start HTTP server ──
app.listen(port);
reader?.start();

logger.info({ port, env: config.NODE_ENV }, 'AI & Content Service started');

// ── Graceful shutdown ──
async function shutdown(signal: string) {
  logger.info({ signal }, 'Shutdown signal received');

  try {
    reader?.stop();
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
