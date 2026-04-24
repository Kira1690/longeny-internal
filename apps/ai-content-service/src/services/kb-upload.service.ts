import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import { config } from '../config/index.js';
import { S3Service } from './s3.service.js';
import { createLogger } from '@longeny/utils';

const logger = createLogger('ai-content:kb-upload');

export interface KbJobStatus {
  job_id: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  chunks_indexed?: number;
  error?: string;
  completed_at?: string;
}

export interface KbMetadata {
  title?: string;
  description?: string;
  collection_name?: string;
  uploaded_by?: string;
}

const REDIS_TTL = 86400; // 24h

export class KbUploadService {
  private readonly redis: Redis;

  constructor(private readonly s3: S3Service) {
    this.redis = new Redis({
      host: config.REDIS_HOST,
      port: config.REDIS_PORT,
      password: config.REDIS_PASSWORD || undefined,
    });
  }

  async uploadAndQueue(
    fileBytes: Uint8Array,
    fileName: string,
    mimeType: string,
    metadata: KbMetadata,
  ): Promise<{ job_id: string; s3_key: string }> {
    const jobId = randomUUID();
    const sanitized = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const s3Key = `kb/${Date.now()}-${sanitized}`;

    // Upload to S3
    await this.s3.putObject(s3Key, fileBytes, mimeType, config.S3_UPLOADS_BUCKET);

    // Mark as queued in Redis
    await this.redis.set(
      `kb:status:${jobId}`,
      JSON.stringify({ status: 'queued' }),
      'EX',
      REDIS_TTL,
    );

    // Trigger Python ingestion (fire-and-forget from Node perspective)
    const agentUrl = config.AI_AGENT_URL;
    fetch(`${agentUrl}/ai/kb/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        s3_key: s3Key,
        job_id: jobId,
        collection_name: metadata.collection_name ?? 'knowledge_base',
        source_metadata: {
          title: metadata.title ?? fileName,
          description: metadata.description ?? '',
          uploaded_by: metadata.uploaded_by ?? '',
        },
      }),
    }).catch((err) => logger.error({ err, jobId }, 'Failed to trigger KB ingest'));

    return { job_id: jobId, s3_key: s3Key };
  }

  async getStatus(jobId: string): Promise<KbJobStatus | null> {
    const raw = await this.redis.get(`kb:status:${jobId}`);
    if (!raw) return null;
    return { job_id: jobId, ...(JSON.parse(raw) as Omit<KbJobStatus, 'job_id'>) };
  }
}
