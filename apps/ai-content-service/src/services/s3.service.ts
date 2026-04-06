import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '../config/index.js';
import { createLogger } from '@longeny/utils';

const logger = createLogger('ai-content:s3');

const s3Client = new S3Client({
  region: config.AWS_REGION,
  credentials: {
    accessKeyId: config.AWS_ACCESS_KEY_ID,
    secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
  },
  ...(config.NODE_ENV === 'development' && {
    endpoint: config.AWS_ENDPOINT_URL,
    forcePathStyle: true,
  }),
});

export class S3Service {
  /**
   * Generate a presigned PUT URL for direct upload.
   */
  async generateUploadUrl(
    key: string,
    contentType: string,
    maxSizeBytes: number = 50 * 1024 * 1024, // 50MB default
    bucket?: string,
  ): Promise<{ uploadUrl: string; key: string; expiresIn: number }> {
    const targetBucket = bucket || config.S3_DOCUMENTS_BUCKET;
    const expiresIn = 900; // 15 minutes

    const command = new PutObjectCommand({
      Bucket: targetBucket,
      Key: key,
      ContentType: contentType,
      ContentLength: maxSizeBytes,
    });

    const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn });

    logger.debug({ key, contentType, bucket: targetBucket }, 'Generated upload presigned URL');

    return { uploadUrl, key, expiresIn };
  }

  /**
   * Generate a presigned GET URL for download.
   */
  async generateDownloadUrl(
    key: string,
    expiresIn: number = 3600, // 1 hour default
    bucket?: string,
  ): Promise<{ downloadUrl: string; expiresIn: number }> {
    const targetBucket = bucket || config.S3_DOCUMENTS_BUCKET;

    const command = new GetObjectCommand({
      Bucket: targetBucket,
      Key: key,
    });

    const downloadUrl = await getSignedUrl(s3Client, command, { expiresIn });

    logger.debug({ key, bucket: targetBucket }, 'Generated download presigned URL');

    return { downloadUrl, expiresIn };
  }

  /**
   * Delete an object from S3.
   */
  async deleteObject(key: string, bucket?: string): Promise<void> {
    const targetBucket = bucket || config.S3_DOCUMENTS_BUCKET;

    const command = new DeleteObjectCommand({
      Bucket: targetBucket,
      Key: key,
    });

    await s3Client.send(command);

    logger.info({ key, bucket: targetBucket }, 'Deleted S3 object');
  }

  /**
   * Build an S3 key for user documents.
   */
  buildDocumentKey(ownerId: string, fileName: string): string {
    const timestamp = Date.now();
    const sanitized = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    return `documents/${ownerId}/${timestamp}-${sanitized}`;
  }

  /**
   * Build an S3 key for AI-generated documents.
   */
  buildGeneratedDocumentKey(providerId: string, documentType: string, docId: string): string {
    return `generated/${providerId}/${documentType}/${docId}.pdf`;
  }
}
