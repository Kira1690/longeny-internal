import { db } from '../db/index.js';
import { sql, eq, and, ne, isNull, inArray } from 'drizzle-orm';
import {
  documents,
  document_access,
  document_access_log,
  document_tags,
  document_versions,
} from '../db/schema.js';
import type { S3Service } from './s3.service.js';
import { createLogger } from '@longeny/utils';
import { NotFoundError, ForbiddenError, BadRequestError } from '@longeny/errors';

const logger = createLogger('ai-content:document');

type DocOwnerType = 'user' | 'provider';
type DocumentType = 'lab_report' | 'prescription' | 'imaging' | 'insurance' | 'certificate' | 'other';
type DocStatus = 'processing' | 'active' | 'archived' | 'deleted';
type AccessPermission = 'view' | 'download';

interface UploadInput {
  ownerId: string;
  ownerType: DocOwnerType;
  documentType: DocumentType;
  title: string;
  description?: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

interface ShareInput {
  grantedToId: string;
  grantedToType: 'user' | 'provider';
  permission: AccessPermission;
  consentId?: string;
  notes?: string;
  expiresAt?: Date;
}

export class DocumentService {
  constructor(
    _prismaUnused: unknown,
    private s3Service: S3Service,
  ) {}

  // ── Upload ──

  /**
   * Create document metadata and return a presigned upload URL.
   */
  async initiateUpload(input: UploadInput): Promise<{
    documentId: string;
    uploadUrl: string;
    expiresIn: number;
  }> {
    const s3Key = this.s3Service.buildDocumentKey(input.ownerId, input.fileName);

    const [doc] = await db.insert(documents).values({
      owner_id: input.ownerId,
      owner_type: input.ownerType,
      document_type: input.documentType,
      title: input.title,
      description: input.description || null,
      file_key: s3Key,
      file_name: input.fileName,
      file_size: BigInt(input.fileSize),
      mime_type: input.mimeType,
      tags: JSON.stringify(input.tags || []),
      metadata: input.metadata || {},
      status: 'processing',
    }).returning();

    const { uploadUrl, expiresIn } = await this.s3Service.generateUploadUrl(
      s3Key,
      input.mimeType,
      input.fileSize,
    );

    // Log the upload
    await db.insert(document_access_log).values({
      document_id: doc.id,
      accessed_by: input.ownerId,
      access_type: 'upload',
    });

    logger.info({ documentId: doc.id, ownerId: input.ownerId }, 'Document upload initiated');

    return { documentId: doc.id, uploadUrl, expiresIn };
  }

  // ── List ──

  /**
   * List documents for a user.
   */
  async listDocuments(
    ownerId: string,
    filters: {
      documentType?: DocumentType;
      status?: DocStatus;
      tags?: string[];
      page: number;
      limit: number;
      sortBy: string;
      sortOrder: 'asc' | 'desc';
    },
  ) {
    const conditions = [
      eq(documents.owner_id, ownerId),
      ne(documents.status, 'deleted'),
    ];

    if (filters.documentType) {
      conditions.push(eq(documents.document_type, filters.documentType));
    }
    if (filters.status) {
      conditions.push(eq(documents.status, filters.status));
    }

    const [rows, [{ count }]] = await Promise.all([
      db
        .select({
          id: documents.id,
          document_type: documents.document_type,
          title: documents.title,
          description: documents.description,
          file_name: documents.file_name,
          file_size: documents.file_size,
          mime_type: documents.mime_type,
          tags: documents.tags,
          status: documents.status,
          ai_generated: documents.ai_generated,
          version_count: documents.version_count,
          created_at: documents.created_at,
          updated_at: documents.updated_at,
        })
        .from(documents)
        .where(and(...conditions))
        .orderBy(
          filters.sortOrder === 'desc'
            ? sql`${documents.created_at} DESC`
            : sql`${documents.created_at} ASC`,
        )
        .limit(filters.limit)
        .offset((filters.page - 1) * filters.limit),
      db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(documents)
        .where(and(...conditions)),
    ]);

    const serialized = rows.map((d) => ({ ...d, file_size: Number(d.file_size) }));

    return { documents: serialized, total: count };
  }

  // ── Detail ──

  /**
   * Get document detail with access check.
   */
  async getDocument(id: string, requesterId: string) {
    const [doc] = await db
      .select()
      .from(documents)
      .where(eq(documents.id, id))
      .limit(1);

    if (!doc || doc.status === 'deleted') throw new NotFoundError('Document', id);

    // Get access grants
    const grants = await db
      .select({
        id: document_access.id,
        granted_to_id: document_access.granted_to_id,
        granted_to_type: document_access.granted_to_type,
        permission: document_access.permission,
        created_at: document_access.created_at,
      })
      .from(document_access)
      .where(
        and(
          eq(document_access.document_id, id),
          isNull(document_access.revoked_at),
        ),
      );

    // Check access: owner or granted access
    const isOwner = doc.owner_id === requesterId;
    const hasGrant = grants.some((g) => g.granted_to_id === requesterId);

    if (!isOwner && !hasGrant) throw new ForbiddenError('Access denied to this document');

    // Log access
    await db.insert(document_access_log).values({
      document_id: id,
      accessed_by: requesterId,
      access_type: 'view',
    });

    return { ...doc, file_size: Number(doc.file_size), access_grants: grants };
  }

  // ── Download ──

  /**
   * Generate a presigned download URL.
   */
  async getDownloadUrl(id: string, requesterId: string) {
    const [doc] = await db
      .select()
      .from(documents)
      .where(eq(documents.id, id))
      .limit(1);

    if (!doc || doc.status === 'deleted') throw new NotFoundError('Document', id);

    // Check access
    const isOwner = doc.owner_id === requesterId;

    if (!isOwner) {
      const [grant] = await db
        .select()
        .from(document_access)
        .where(
          and(
            eq(document_access.document_id, id),
            eq(document_access.granted_to_id, requesterId),
            eq(document_access.permission, 'download'),
            isNull(document_access.revoked_at),
          ),
        )
        .limit(1);

      if (!grant) throw new ForbiddenError('Download access denied');
    }

    const { downloadUrl, expiresIn } = await this.s3Service.generateDownloadUrl(doc.file_key);

    // Log download
    await db.insert(document_access_log).values({
      document_id: id,
      accessed_by: requesterId,
      access_type: 'download',
    });

    return { downloadUrl, expiresIn, fileName: doc.file_name, mimeType: doc.mime_type };
  }

  // ── Update Document ──

  /**
   * Update document metadata (owner only).
   */
  async updateDocument(
    id: string,
    ownerId: string,
    data: {
      title?: string;
      description?: string;
      documentType?: DocumentType;
      metadata?: Record<string, unknown>;
    },
  ) {
    const [doc] = await db
      .select()
      .from(documents)
      .where(eq(documents.id, id))
      .limit(1);

    if (!doc || doc.status === 'deleted') throw new NotFoundError('Document', id);
    if (doc.owner_id !== ownerId) throw new ForbiddenError('Only the owner can update this document');

    const updateData: Record<string, unknown> = { updated_at: new Date() };
    if (data.title !== undefined) updateData.title = data.title;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.documentType !== undefined) updateData.document_type = data.documentType;
    if (data.metadata !== undefined) updateData.metadata = data.metadata;

    const [updated] = await db
      .update(documents)
      .set(updateData as any)
      .where(eq(documents.id, id))
      .returning();

    logger.info({ documentId: id, ownerId }, 'Document metadata updated');
    return { ...updated, file_size: Number(updated.file_size) };
  }

  // ── Access Log ──

  /**
   * Get access log for a document (owner only).
   */
  async getAccessLog(id: string, requesterId: string, page: number, limit: number) {
    const [doc] = await db
      .select()
      .from(documents)
      .where(eq(documents.id, id))
      .limit(1);

    if (!doc || doc.status === 'deleted') throw new NotFoundError('Document', id);
    if (doc.owner_id !== requesterId) throw new ForbiddenError('Only the owner can view the access log');

    const [logs, [{ count }]] = await Promise.all([
      db
        .select()
        .from(document_access_log)
        .where(eq(document_access_log.document_id, id))
        .orderBy(sql`${document_access_log.created_at} DESC`)
        .limit(limit)
        .offset((page - 1) * limit),
      db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(document_access_log)
        .where(eq(document_access_log.document_id, id)),
    ]);

    return { logs, total: count };
  }

  // ── Provider Accessible Documents ──

  /**
   * List documents a provider has access to via grants.
   */
  async getProviderAccessibleDocuments(providerId: string, page: number, limit: number) {
    const grants = await db
      .select()
      .from(document_access)
      .where(
        and(
          eq(document_access.granted_to_id, providerId),
          isNull(document_access.revoked_at),
        ),
      )
      .orderBy(sql`${document_access.created_at} DESC`)
      .limit(limit)
      .offset((page - 1) * limit);

    const [{ count }] = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(document_access)
      .where(
        and(
          eq(document_access.granted_to_id, providerId),
          isNull(document_access.revoked_at),
        ),
      );

    // Fetch documents for each grant
    const docIds = grants.map((g) => g.document_id);
    const docs = docIds.length > 0
      ? await db
          .select({
            id: documents.id,
            document_type: documents.document_type,
            title: documents.title,
            description: documents.description,
            file_name: documents.file_name,
            file_size: documents.file_size,
            mime_type: documents.mime_type,
            tags: documents.tags,
            owner_id: documents.owner_id,
            status: documents.status,
            created_at: documents.created_at,
            updated_at: documents.updated_at,
          })
          .from(documents)
          .where(inArray(documents.id, docIds))
      : [];

    const docMap = new Map(docs.map((d) => [d.id, d]));

    const result = grants
      .map((g) => {
        const doc = docMap.get(g.document_id);
        if (!doc || doc.status === 'deleted') return null;
        return {
          grantId: g.id,
          permission: g.permission,
          grantedAt: g.created_at,
          expiresAt: g.expires_at,
          document: { ...doc, file_size: Number(doc.file_size) },
        };
      })
      .filter(Boolean);

    return { documents: result, total: count };
  }

  // ── Soft Delete ──

  /**
   * Soft delete a document (owner only).
   */
  async softDelete(id: string, ownerId: string) {
    const [doc] = await db
      .select()
      .from(documents)
      .where(eq(documents.id, id))
      .limit(1);

    if (!doc) throw new NotFoundError('Document', id);
    if (doc.owner_id !== ownerId) throw new ForbiddenError('Only the owner can delete this document');
    if (doc.status === 'deleted') throw new BadRequestError('Document is already deleted');

    await db
      .update(documents)
      .set({ status: 'deleted', deleted_at: new Date(), updated_at: new Date() })
      .where(eq(documents.id, id));

    // Log deletion
    await db.insert(document_access_log).values({
      document_id: id,
      accessed_by: ownerId,
      access_type: 'delete',
    });

    logger.info({ documentId: id, ownerId }, 'Document soft deleted');
  }

  // ── Sharing ──

  /**
   * Share document with a provider (consent-gated).
   */
  async shareDocument(id: string, ownerId: string, input: ShareInput) {
    const [doc] = await db
      .select()
      .from(documents)
      .where(eq(documents.id, id))
      .limit(1);

    if (!doc) throw new NotFoundError('Document', id);
    if (doc.owner_id !== ownerId) throw new ForbiddenError('Only the owner can share this document');
    if (doc.status !== 'active') throw new BadRequestError('Only active documents can be shared');

    // Select-then-upsert pattern for document_access
    const [existing] = await db
      .select()
      .from(document_access)
      .where(
        and(
          eq(document_access.document_id, id),
          eq(document_access.granted_to_id, input.grantedToId),
        ),
      )
      .limit(1);

    let grant;
    if (existing) {
      [grant] = await db
        .update(document_access)
        .set({
          permission: input.permission,
          consent_id: input.consentId || null,
          notes: input.notes || null,
          expires_at: input.expiresAt || null,
          revoked_at: null, // Re-grant if previously revoked
        })
        .where(eq(document_access.id, existing.id))
        .returning();
    } else {
      [grant] = await db
        .insert(document_access)
        .values({
          document_id: id,
          granted_to_id: input.grantedToId,
          granted_to_type: input.grantedToType,
          permission: input.permission,
          granted_by: ownerId,
          consent_id: input.consentId || null,
          notes: input.notes || null,
          expires_at: input.expiresAt || null,
        })
        .returning();
    }

    // Log share
    await db.insert(document_access_log).values({
      document_id: id,
      accessed_by: ownerId,
      access_type: 'share',
      metadata: { grantedTo: input.grantedToId, permission: input.permission },
    });

    logger.info({ documentId: id, grantedTo: input.grantedToId }, 'Document shared');
    return grant;
  }

  /**
   * Revoke a share grant.
   */
  async revokeAccess(documentId: string, grantId: string, ownerId: string) {
    const [doc] = await db
      .select()
      .from(documents)
      .where(eq(documents.id, documentId))
      .limit(1);

    if (!doc) throw new NotFoundError('Document', documentId);
    if (doc.owner_id !== ownerId) throw new ForbiddenError('Only the owner can revoke access');

    const [grant] = await db
      .select()
      .from(document_access)
      .where(eq(document_access.id, grantId))
      .limit(1);

    if (!grant || grant.document_id !== documentId) throw new NotFoundError('AccessGrant', grantId);

    await db
      .update(document_access)
      .set({ revoked_at: new Date() })
      .where(eq(document_access.id, grantId));

    // Log revoke
    await db.insert(document_access_log).values({
      document_id: documentId,
      accessed_by: ownerId,
      access_type: 'revoke',
      metadata: { revokedGrantId: grantId },
    });

    logger.info({ documentId, grantId }, 'Document access revoked');
  }

  /**
   * List documents shared with a provider.
   */
  async getSharedWithMe(providerId: string, page: number, limit: number) {
    const grants = await db
      .select()
      .from(document_access)
      .where(
        and(
          eq(document_access.granted_to_id, providerId),
          isNull(document_access.revoked_at),
        ),
      )
      .orderBy(sql`${document_access.created_at} DESC`)
      .limit(limit)
      .offset((page - 1) * limit);

    const [{ count }] = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(document_access)
      .where(
        and(
          eq(document_access.granted_to_id, providerId),
          isNull(document_access.revoked_at),
        ),
      );

    const docIds = grants.map((g) => g.document_id);
    const docs = docIds.length > 0
      ? await db
          .select({
            id: documents.id,
            document_type: documents.document_type,
            title: documents.title,
            description: documents.description,
            file_name: documents.file_name,
            file_size: documents.file_size,
            mime_type: documents.mime_type,
            tags: documents.tags,
            owner_id: documents.owner_id,
            status: documents.status,
            created_at: documents.created_at,
          })
          .from(documents)
          .where(inArray(documents.id, docIds))
      : [];

    const docMap = new Map(docs.map((d) => [d.id, d]));

    const result = grants
      .map((g) => {
        const doc = docMap.get(g.document_id);
        if (!doc || doc.status === 'deleted') return null;
        return {
          grantId: g.id,
          permission: g.permission,
          sharedAt: g.created_at,
          document: { ...doc, file_size: Number(doc.file_size) },
        };
      })
      .filter(Boolean);

    return { documents: result, total: count };
  }

  // ── Tags ──

  /**
   * Add tags to a document.
   */
  async addTags(id: string, ownerId: string, tags: string[]) {
    const [doc] = await db
      .select()
      .from(documents)
      .where(eq(documents.id, id))
      .limit(1);

    if (!doc) throw new NotFoundError('Document', id);
    if (doc.owner_id !== ownerId) throw new ForbiddenError('Only the owner can modify tags');

    const currentTags: string[] = JSON.parse((doc.tags as string) || '[]');
    const uniqueTags = [...new Set([...currentTags, ...tags])];

    const [updated] = await db
      .update(documents)
      .set({ tags: JSON.stringify(uniqueTags), updated_at: new Date() })
      .where(eq(documents.id, id))
      .returning();

    // Update tag usage counts
    for (const tag of tags) {
      const [existingTag] = await db
        .select()
        .from(document_tags)
        .where(
          and(
            eq(document_tags.name, tag),
            eq(document_tags.category, 'user'),
          ),
        )
        .limit(1);

      if (existingTag) {
        await db
          .update(document_tags)
          .set({ usage_count: existingTag.usage_count + 1 })
          .where(eq(document_tags.id, existingTag.id));
      } else {
        await db.insert(document_tags).values({
          name: tag,
          category: 'user',
          created_by: ownerId,
          usage_count: 1,
        }).catch(() => {
          // Race condition on insert — ignore
        });
      }
    }

    logger.info({ documentId: id, addedTags: tags }, 'Tags added to document');
    return updated;
  }

  /**
   * Remove a tag from a document.
   */
  async removeTag(id: string, ownerId: string, tag: string) {
    const [doc] = await db
      .select()
      .from(documents)
      .where(eq(documents.id, id))
      .limit(1);

    if (!doc) throw new NotFoundError('Document', id);
    if (doc.owner_id !== ownerId) throw new ForbiddenError('Only the owner can modify tags');

    const currentTags: string[] = JSON.parse((doc.tags as string) || '[]');
    const filtered = currentTags.filter((t) => t !== tag);

    await db
      .update(documents)
      .set({ tags: JSON.stringify(filtered), updated_at: new Date() })
      .where(eq(documents.id, id));

    // Decrement tag usage
    const [existingTag] = await db
      .select()
      .from(document_tags)
      .where(eq(document_tags.name, tag))
      .limit(1);

    if (existingTag && existingTag.usage_count > 0) {
      await db
        .update(document_tags)
        .set({ usage_count: existingTag.usage_count - 1 })
        .where(eq(document_tags.id, existingTag.id));
    }

    logger.info({ documentId: id, removedTag: tag }, 'Tag removed from document');
  }

  /**
   * Get tag cloud (most used tags).
   */
  async getTagCloud(limit: number = 50) {
    const tags = await db
      .select({
        name: document_tags.name,
        category: document_tags.category,
        usage_count: document_tags.usage_count,
      })
      .from(document_tags)
      .where(sql`${document_tags.usage_count} > 0`)
      .orderBy(sql`${document_tags.usage_count} DESC`)
      .limit(limit);

    return tags;
  }

  // ── Timeline ──

  /**
   * Chronological document timeline for a user.
   */
  async getTimeline(ownerId: string, page: number, limit: number) {
    const conditions = [
      eq(documents.owner_id, ownerId),
      ne(documents.status, 'deleted'),
    ];

    const [rows, [{ count }]] = await Promise.all([
      db
        .select({
          id: documents.id,
          document_type: documents.document_type,
          title: documents.title,
          file_name: documents.file_name,
          tags: documents.tags,
          ai_generated: documents.ai_generated,
          status: documents.status,
          created_at: documents.created_at,
        })
        .from(documents)
        .where(and(...conditions))
        .orderBy(sql`${documents.created_at} DESC`)
        .limit(limit)
        .offset((page - 1) * limit),
      db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(documents)
        .where(and(...conditions)),
    ]);

    // Group by month
    const timeline = rows.reduce<Record<string, typeof rows>>((acc, doc) => {
      const monthKey = doc.created_at.toISOString().substring(0, 7); // YYYY-MM
      if (!acc[monthKey]) acc[monthKey] = [];
      acc[monthKey].push(doc);
      return acc;
    }, {});

    return { timeline, total: count };
  }

  // ── GDPR ──

  /**
   * Get all documents and access logs for a user (DSAR).
   */
  async getUserDataForDsar(userId: string) {
    const [userDocs, accessGrants, accessLogs] = await Promise.all([
      db
        .select({
          id: documents.id,
          document_type: documents.document_type,
          title: documents.title,
          file_name: documents.file_name,
          file_size: documents.file_size,
          mime_type: documents.mime_type,
          tags: documents.tags,
          status: documents.status,
          ai_generated: documents.ai_generated,
          created_at: documents.created_at,
        })
        .from(documents)
        .where(eq(documents.owner_id, userId)),
      db
        .select()
        .from(document_access)
        .where(eq(document_access.granted_by, userId)),
      db
        .select()
        .from(document_access_log)
        .where(eq(document_access_log.accessed_by, userId))
        .orderBy(sql`${document_access_log.created_at} DESC`)
        .limit(1000),
    ]);

    return {
      documents: userDocs.map((d) => ({ ...d, file_size: Number(d.file_size) })),
      accessGrants,
      accessLogs,
    };
  }

  /**
   * Delete all documents and S3 files for a user (GDPR erasure).
   */
  async deleteAllForUser(userId: string): Promise<{ documentsDeleted: number; s3FilesDeleted: number }> {
    const userDocs = await db
      .select({
        id: documents.id,
        file_key: documents.file_key,
      })
      .from(documents)
      .where(eq(documents.owner_id, userId));

    // Delete S3 files
    let s3FilesDeleted = 0;
    for (const doc of userDocs) {
      try {
        await this.s3Service.deleteObject(doc.file_key);
        s3FilesDeleted++;
      } catch (error) {
        logger.error({ fileKey: doc.file_key, error }, 'Failed to delete S3 file during GDPR erasure');
      }
    }

    // Delete access logs, grants, then documents
    const docIds = userDocs.map((d) => d.id);
    if (docIds.length > 0) {
      await db.delete(document_access_log).where(inArray(document_access_log.document_id, docIds));
      await db.delete(document_access).where(inArray(document_access.document_id, docIds));
      await db.delete(documents).where(eq(documents.owner_id, userId));
    }

    logger.info({ userId, documentsDeleted: userDocs.length, s3FilesDeleted }, 'User documents deleted (GDPR)');
    return { documentsDeleted: userDocs.length, s3FilesDeleted };
  }
}
