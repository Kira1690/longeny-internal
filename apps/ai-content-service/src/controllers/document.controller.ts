import type { DocumentService } from '../services/document.service.js';
import { BadRequestError } from '@longeny/errors';
import { parsePaginationParams, buildPaginationMeta } from '@longeny/utils';

type DocumentType = 'lab_report' | 'prescription' | 'imaging' | 'insurance' | 'certificate' | 'other';
type DocOwnerType = 'user' | 'provider';
type AccessPermission = 'view' | 'download';

const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/dicom',
  'application/dicom',
];

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

export class DocumentController {
  constructor(private documentService: DocumentService) {}

  /**
   * POST /documents/upload
   */
  upload = async ({ store, body, set }: any) => {
    if (!body.title) throw new BadRequestError('title is required');
    if (!body.fileName) throw new BadRequestError('fileName is required');
    if (!body.fileSize || body.fileSize <= 0) throw new BadRequestError('fileSize must be positive');
    if (body.fileSize > MAX_FILE_SIZE) throw new BadRequestError('File exceeds maximum size of 50MB');
    if (!body.mimeType) throw new BadRequestError('mimeType is required');
    if (!ALLOWED_MIME_TYPES.includes(body.mimeType)) {
      throw new BadRequestError(`Unsupported MIME type. Allowed: ${ALLOWED_MIME_TYPES.join(', ')}`);
    }

    const result = await this.documentService.initiateUpload({
      ownerId: store.userId,
      ownerType: (body.ownerType as DocOwnerType) || 'user',
      documentType: (body.documentType as DocumentType) || 'other',
      title: body.title,
      description: body.description,
      fileName: body.fileName,
      fileSize: body.fileSize,
      mimeType: body.mimeType,
      tags: body.tags,
      metadata: body.metadata,
    });

    set.status = 201;
    return {
      success: true,
      data: result,
      meta: { timestamp: new Date().toISOString() },
    };
  };

  /**
   * GET /documents
   */
  listDocuments = async ({ store, query }: any) => {
    const pagination = parsePaginationParams(query);

    const { documents, total } = await this.documentService.listDocuments(store.userId, {
      documentType: query.documentType as DocumentType | undefined,
      tags: query.tags ? query.tags.split(',') : undefined,
      page: pagination.page,
      limit: pagination.limit,
      sortBy: pagination.sortBy,
      sortOrder: pagination.sortOrder,
    });

    return {
      success: true,
      data: documents,
      pagination: buildPaginationMeta(total, pagination.page, pagination.limit),
      meta: { timestamp: new Date().toISOString() },
    };
  };

  /**
   * GET /documents/:id
   */
  getDocument = async ({ store, params }: any) => {
    const doc = await this.documentService.getDocument(params.id, store.userId);

    return {
      success: true,
      data: doc,
      meta: { timestamp: new Date().toISOString() },
    };
  };

  /**
   * GET /documents/:id/download
   */
  downloadDocument = async ({ store, params }: any) => {
    const result = await this.documentService.getDownloadUrl(params.id, store.userId);

    return {
      success: true,
      data: result,
      meta: { timestamp: new Date().toISOString() },
    };
  };

  /**
   * PUT /documents/:id
   */
  updateDocument = async ({ store, params, body }: any) => {
    const doc = await this.documentService.updateDocument(params.id, store.userId, {
      title: body.title,
      description: body.description,
      documentType: body.documentType as DocumentType | undefined,
      metadata: body.metadata,
    });

    return {
      success: true,
      data: doc,
      message: 'Document updated',
      meta: { timestamp: new Date().toISOString() },
    };
  };

  /**
   * GET /documents/:id/access-log
   */
  getAccessLog = async ({ store, params, query }: any) => {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 50));

    const { logs, total } = await this.documentService.getAccessLog(params.id, store.userId, page, limit);

    return {
      success: true,
      data: logs,
      pagination: buildPaginationMeta(total, page, limit),
      meta: { timestamp: new Date().toISOString() },
    };
  };

  /**
   * GET /documents/provider/:providerId/accessible
   */
  getProviderAccessibleDocuments = async ({ store, params, query }: any) => {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));

    // Verify the requesting user is the provider
    if (store.userId !== params.providerId) {
      throw new BadRequestError('You can only view your own accessible documents');
    }

    const { documents, total } = await this.documentService.getProviderAccessibleDocuments(
      params.providerId,
      page,
      limit,
    );

    return {
      success: true,
      data: documents,
      pagination: buildPaginationMeta(total, page, limit),
      meta: { timestamp: new Date().toISOString() },
    };
  };

  /**
   * DELETE /documents/:id
   */
  deleteDocument = async ({ store, params }: any) => {
    await this.documentService.softDelete(params.id, store.userId);

    return {
      success: true,
      data: { message: 'Document deleted' },
      meta: { timestamp: new Date().toISOString() },
    };
  };

  /**
   * POST /documents/:id/share
   */
  shareDocument = async ({ store, params, body, set }: any) => {
    if (!body.grantedToId) throw new BadRequestError('grantedToId is required');

    const grant = await this.documentService.shareDocument(params.id, store.userId, {
      grantedToId: body.grantedToId,
      grantedToType: body.grantedToType || 'provider',
      permission: (body.permission as AccessPermission) || 'view',
      consentId: body.consentId,
      notes: body.notes,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
    });

    set.status = 201;
    return {
      success: true,
      data: grant,
      meta: { timestamp: new Date().toISOString() },
    };
  };

  /**
   * DELETE /documents/:id/share/:grantId
   */
  revokeAccess = async ({ store, params }: any) => {
    await this.documentService.revokeAccess(params.id, params.grantId, store.userId);

    return {
      success: true,
      data: { message: 'Access revoked' },
      meta: { timestamp: new Date().toISOString() },
    };
  };

  /**
   * GET /documents/shared-with-me
   */
  sharedWithMe = async ({ store, query }: any) => {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));

    const { documents, total } = await this.documentService.getSharedWithMe(store.userId, page, limit);

    return {
      success: true,
      data: documents,
      pagination: buildPaginationMeta(total, page, limit),
      meta: { timestamp: new Date().toISOString() },
    };
  };

  /**
   * POST /documents/:id/tags
   */
  addTags = async ({ store, params, body }: any) => {
    if (!body.tags || !Array.isArray(body.tags) || body.tags.length === 0) {
      throw new BadRequestError('tags array is required');
    }

    const doc = await this.documentService.addTags(params.id, store.userId, body.tags);

    return {
      success: true,
      data: doc,
      meta: { timestamp: new Date().toISOString() },
    };
  };

  /**
   * DELETE /documents/:id/tags/:tag
   */
  removeTag = async ({ store, params }: any) => {
    await this.documentService.removeTag(params.id, store.userId, decodeURIComponent(params.tag));

    return {
      success: true,
      data: { message: 'Tag removed' },
      meta: { timestamp: new Date().toISOString() },
    };
  };

  /**
   * GET /documents/tags
   */
  tagCloud = async ({ query }: any) => {
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 50));

    const tags = await this.documentService.getTagCloud(limit);

    return {
      success: true,
      data: tags,
      meta: { timestamp: new Date().toISOString() },
    };
  };

  /**
   * GET /documents/timeline
   */
  timeline = async ({ store, query }: any) => {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 50));

    const { timeline, total } = await this.documentService.getTimeline(store.userId, page, limit);

    return {
      success: true,
      data: timeline,
      pagination: buildPaginationMeta(total, page, limit),
      meta: { timestamp: new Date().toISOString() },
    };
  };
}
