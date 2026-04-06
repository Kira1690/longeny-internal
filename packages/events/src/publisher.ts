import Redis from 'ioredis';
import type { EventEnvelope } from '@longeny/types';
import { createLogger } from '@longeny/utils';

const CHANNEL = 'longeny:events';

export class EventPublisher {
  private redis: Redis;
  private serviceName: string;
  private logger;

  constructor(redisUrl: string, serviceName: string) {
    this.redis = new Redis(redisUrl);
    this.serviceName = serviceName;
    this.logger = createLogger(`${serviceName}:publisher`);
  }

  async publish<T>(eventType: string, payload: T, correlationId?: string): Promise<void> {
    const envelope: EventEnvelope<T> = {
      eventType,
      payload,
      timestamp: new Date().toISOString(),
      correlationId: correlationId || crypto.randomUUID(),
      source: this.serviceName,
    };

    await this.redis.publish(CHANNEL, JSON.stringify(envelope));
    this.logger.debug({ eventType, correlationId: envelope.correlationId }, 'Event published');
  }

  async disconnect(): Promise<void> {
    await this.redis.quit();
  }
}
