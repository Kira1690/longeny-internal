import { AppError } from '@longeny/errors';
import type { KbUploadService } from '../services/kb-upload.service.js';

const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'text/plain',
  'text/markdown',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];
const MAX_SIZE_BYTES = 50 * 1024 * 1024; // 50MB

export class KbController {
  constructor(private readonly kbSvc: KbUploadService) {}

  async upload({ body, store }: { body: { file: File; title?: string; description?: string; collection_name?: string }; store: { userId: string } }) {
    const { file } = body;

    const mimeBase = file.type.split(';')[0].trim();
    if (!ALLOWED_MIME_TYPES.includes(mimeBase)) {
      throw new AppError(`Unsupported file type: ${file.type}`, 400, 'INVALID_FILE_TYPE');
    }
    if (file.size > MAX_SIZE_BYTES) {
      throw new AppError('File exceeds 50MB limit', 400, 'FILE_TOO_LARGE');
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = await this.kbSvc.uploadAndQueue(bytes, file.name, mimeBase, {
      title: body.title,
      description: body.description,
      collection_name: body.collection_name,
      uploaded_by: store.userId,
    });

    return { success: true, data: { ...result, status: 'queued' } };
  }

  async getStatus({ params }: { params: { jobId: string } }) {
    const status = await this.kbSvc.getStatus(params.jobId);
    if (!status) {
      throw new AppError('Job not found or expired', 404, 'NOT_FOUND');
    }
    return { success: true, data: status };
  }
}
