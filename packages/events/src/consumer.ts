import Redis from 'ioredis';
import type { EventHandler, EventEnvelope } from '@longeny/types';
import { createLogger } from '@longeny/utils';

const CHANNEL = 'longeny:events';

export class EventConsumer {
  private redis: Redis;
  private handlers: Map<string, EventHandler[]>;
  private serviceName: string;
  private logger;

  constructor(redisUrl: string, serviceName: string) {
    this.redis = new Redis(redisUrl);
    this.handlers = new Map();
    this.serviceName = serviceName;
    this.logger = createLogger(`${serviceName}:consumer`);
  }

  on<T>(eventType: string, handler: EventHandler<T>): void {
    const existing = this.handlers.get(eventType) || [];
    existing.push(handler as EventHandler);
    this.handlers.set(eventType, existing);
  }

  async start(): Promise<void> {
    await this.redis.subscribe(CHANNEL);
    this.logger.info({ channel: CHANNEL }, 'Event consumer started');

    this.redis.on('message', async (_channel: string, message: string) => {
      try {
        const envelope = JSON.parse(message) as EventEnvelope;
        const handlers = this.handlers.get(envelope.eventType) || [];

        if (handlers.length === 0) {
          return;
        }

        this.logger.debug(
          { eventType: envelope.eventType, correlationId: envelope.correlationId },
          'Processing event',
        );

        for (const handler of handlers) {
          try {
            await handler(envelope);
          } catch (error) {
            this.logger.error(
              { eventType: envelope.eventType, correlationId: envelope.correlationId, error },
              'Event handler failed',
            );
          }
        }
      } catch (error) {
        this.logger.error({ error }, 'Failed to parse event message');
      }
    });
  }

  async stop(): Promise<void> {
    await this.redis.unsubscribe(CHANNEL);
    await this.redis.quit();
    this.logger.info('Event consumer stopped');
  }
}
