import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createLogger } from '@longeny/utils';
import { explicitAwsCredentials } from '../config/aws.js';
import { config } from '../config/index.js';

const logger = createLogger('ai-content:s3');

const s3Client = new S3Client({
  region: config.AWS_REGION,
  ...explicitAwsCredentials(),
  // Since SDK 3.729 the client computes a checksum for every request by
  // default. For a presigned PUT it computes it over the empty body it has at
  // signing time and bakes `x-amz-checksum-crc32` into the link — so S3 rejects
  // every real file uploaded through that link. No upload link this service
  // issued could ever have worked. Only checksum when an operation requires it.
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
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
    expiresIn = 900,
  ): Promise<{ uploadUrl: string; key: string; expiresIn: number }> {
    const targetBucket = bucket || config.S3_DOCUMENTS_BUCKET;

    const command = new PutObjectCommand({
      Bucket: targetBucket,
      Key: key,
      ContentType: contentType,
      ContentLength: maxSizeBytes,
    });

    // Both headers are signed, so S3 itself refuses an upload whose size or type
    // differs from what was declared and checked. The SDK signs content-length
    // by default but not content-type: without this, a link issued for a 2 KB
    // PDF accepted any file of that size — HTML, an executable — labelled as
    // whatever the uploader liked.
    const uploadUrl = await getSignedUrl(s3Client, command, {
      expiresIn,
      signableHeaders: new Set(['content-type', 'content-length']),
    });

    logger.debug({ key, contentType, bucket: targetBucket }, 'Generated upload presigned URL');

    return { uploadUrl, key, expiresIn };
  }

  /**
   * Size and type of a stored object, or null when there is none.
   *
   * Other failures are thrown: "could not ask" must never read as "not there",
   * or an outage would look like an upload that never happened.
   */
  async headObject(
    key: string,
    bucket?: string,
  ): Promise<{ contentLength: number; contentType: string } | null> {
    try {
      const head = await s3Client.send(
        new HeadObjectCommand({ Bucket: bucket || config.S3_DOCUMENTS_BUCKET, Key: key }),
      );
      return { contentLength: head.ContentLength ?? -1, contentType: head.ContentType ?? '' };
    } catch (error) {
      if (error instanceof NotFound || (error as { name?: string }).name === 'NotFound') {
        return null;
      }
      throw error;
    }
  }

  /** The whole object, for the report reader. Reports are capped at 50 MB. */
  async getObjectBytes(key: string, bucket?: string): Promise<Uint8Array> {
    const response = await s3Client.send(
      new GetObjectCommand({ Bucket: bucket || config.S3_DOCUMENTS_BUCKET, Key: key }),
    );
    if (!response.Body) throw new Error('S3 returned no body');
    return response.Body.transformToByteArray();
  }

  /**
   * A short-lived download link that saves the file rather than rendering it,
   * under the name it was uploaded with.
   */
  async generateAttachmentUrl(
    key: string,
    fileName: string,
    expiresIn: number,
  ): Promise<{ downloadUrl: string; expiresIn: number }> {
    // Printable ASCII only, without quote or backslash: anything else could
    // break out of the header value.
    const safeName = fileName.replace(/[^\x20-\x7e]|["\\]/g, '_');
    const command = new GetObjectCommand({
      Bucket: config.S3_DOCUMENTS_BUCKET,
      Key: key,
      ResponseContentDisposition: `attachment; filename="${safeName}"`,
    });
    const downloadUrl = await getSignedUrl(s3Client, command, { expiresIn });
    return { downloadUrl, expiresIn };
  }

  /**
   * Generate a presigned GET URL for download.
   */
  async generateDownloadUrl(
    key: string,
    expiresIn = 3600, // 1 hour default
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
   * Upload raw bytes directly to S3. Used for server-side uploads (e.g. KB ingestion).
   */
  async putObject(
    key: string,
    body: Uint8Array | Buffer,
    contentType: string,
    bucket?: string,
  ): Promise<void> {
    const targetBucket = bucket || config.S3_UPLOADS_BUCKET;
    await s3Client.send(
      new PutObjectCommand({
        Bucket: targetBucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
    logger.debug({ key, bucket: targetBucket }, 'Uploaded object to S3');
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
   * Key for a patient report. Ids only — no file name, no person's name —
   * so the bucket listing and its access logs carry no health information.
   */
  buildReportKey(profileId: string, reportId: string): string {
    return `reports/${profileId}/${reportId}`;
  }

  /**
   * Build an S3 key for AI-generated documents.
   */
  buildGeneratedDocumentKey(providerId: string, documentType: string, docId: string): string {
    return `generated/${providerId}/${documentType}/${docId}.pdf`;
  }
}
