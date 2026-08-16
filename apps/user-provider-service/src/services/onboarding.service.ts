import { NotFoundError, ConflictError, ValidationError } from '@longeny/errors';
import { Value } from '@sinclair/typebox/value';
import { createLogger } from '@longeny/utils';
import { db } from '../db/index.js';
import { provider_onboarding, provider_admin_checks, providers, users } from '../db/schema.js';
import { eq, and, sql } from 'drizzle-orm';
import {
  SECTION_KEYS,
  sectionSchemas,
  getPartialSchema,
  ADMIN_CHECK_KEYS,
  CONSENT_KEYS,
  DECLARATION_KEYS,
  type SectionKey,
} from '../validators/onboarding.validators.js';
import { config } from '../config/index.js';

const logger = createLogger('onboarding-service');

const UPLOAD_ALLOWED_FIELDS = [
  'profile_photo_url',
  'govt_id_proof_url',
  'address_proof_url',
  'insurance_proof_url',
] as const;

type UploadField = typeof UPLOAD_ALLOWED_FIELDS[number];

const CONTENT_TYPE_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

export class OnboardingService {
  private async resolveProviderId(authId: string): Promise<string> {
    const [user] = await db.select({ id: users.id }).from(users).where(eq(users.auth_id, authId)).limit(1);
    if (!user) throw new NotFoundError('User not found');

    const [provider] = await db.select({ id: providers.id }).from(providers).where(eq(providers.user_id, user.id)).limit(1);
    if (!provider) throw new NotFoundError('Provider profile not found');

    return provider.id;
  }

  async init(authId: string) {
    const providerId = await this.resolveProviderId(authId);

    const existing = await db
      .select()
      .from(provider_onboarding)
      .where(eq(provider_onboarding.provider_id, providerId))
      .limit(1);

    if (existing.length > 0) {
      return existing[0];
    }

    const [row] = await db
      .insert(provider_onboarding)
      .values({ provider_id: providerId })
      .returning();

    logger.info({ providerId }, 'Onboarding initialized');
    return row;
  }

  async getUploadUrl(authId: string, fieldName: string, contentType: string) {
    if (!UPLOAD_ALLOWED_FIELDS.includes(fieldName as UploadField)) {
      throw new ValidationError(
        [{ field: 'field_name', message: `Must be one of: ${UPLOAD_ALLOWED_FIELDS.join(', ')}` }],
      );
    }

    const allowedContentTypes = Object.keys(CONTENT_TYPE_EXT);
    if (!allowedContentTypes.includes(contentType)) {
      throw new ValidationError(
        [{ field: 'content_type', message: `Must be one of: ${allowedContentTypes.join(', ')}` }],
      );
    }

    const providerId = await this.resolveProviderId(authId);
    const ext = CONTENT_TYPE_EXT[contentType];
    const key = `providers/${providerId}/documents/${fieldName}/${crypto.randomUUID()}.${ext}`;

    const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');

    const s3 = new S3Client({
      region: config.AWS_REGION,
      credentials: {
        accessKeyId: config.AWS_ACCESS_KEY_ID,
        secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
      },
    });

    const commandParams: Record<string, unknown> = {
      Bucket: config.S3_UPLOADS_BUCKET,
      Key: key,
      ContentType: contentType,
      ServerSideEncryption: 'aws:kms',
    };

    if (config.KMS_KEY_ID) {
      commandParams['SSEKMSKeyId'] = config.KMS_KEY_ID;
    }

    const command = new PutObjectCommand(commandParams as any);
    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 900 });
    const publicUrl = `https://${config.S3_UPLOADS_BUCKET}.s3.${config.AWS_REGION}.amazonaws.com/${key}`;

    logger.info({ providerId, fieldName, key }, 'Presigned upload URL generated');
    return { upload_url: uploadUrl, public_url: publicUrl, key, expires_in: 900 };
  }

  async getFullOnboarding(providerId: string) {
    const [row] = await db
      .select()
      .from(provider_onboarding)
      .where(eq(provider_onboarding.provider_id, providerId))
      .limit(1);

    if (!row) throw new NotFoundError('Onboarding record not found');
    return row;
  }

  async getFullOnboardingByAuthId(authId: string) {
    const providerId = await this.resolveProviderId(authId);
    return this.getFullOnboarding(providerId);
  }

  async getProgress(providerId: string) {
    const row = await this.getFullOnboarding(providerId);

    const sections: Record<string, string> = {};
    for (const key of SECTION_KEYS) {
      sections[key] = row[`${key}_status` as keyof typeof row] as string;
    }

    return {
      status: row.status,
      completed_sections: row.completed_sections,
      total_sections: row.total_sections,
      sections,
    };
  }

  async getSection(providerId: string, sectionKey: SectionKey) {
    const row = await this.getFullOnboarding(providerId);
    return {
      section: sectionKey,
      status: row[`${sectionKey}_status` as keyof typeof row],
      data: row[sectionKey as keyof typeof row] ?? null,
    };
  }

  async saveSection(
    providerId: string,
    sectionKey: SectionKey,
    data: unknown,
    markComplete: boolean,
  ) {
    const row = await this.getFullOnboarding(providerId);

    if (row.status === 'submitted' || row.status === 'approved') {
      throw new ConflictError(`Cannot edit sections in ${row.status} state`);
    }

    const schema = markComplete ? sectionSchemas[sectionKey] : getPartialSchema(sectionKey);

    const errors = [...Value.Errors(schema, data)];
    if (errors.length > 0) {
      throw new ValidationError(
        errors.map((e) => ({
          field: e.path.replace(/^\//, '').replace(/\//g, '.'),
          message: e.message,
        })),
      );
    }
    const parsed = Value.Cast(schema, data);

    if (markComplete && sectionKey === 'compliance_consents') {
      const items = parsed as Array<{ consent_key: string; granted_at?: string }>;
      const keys = items.map((i) => i.consent_key);
      const missing = CONSENT_KEYS.filter((k) => !keys.includes(k));
      if (missing.length > 0) {
        throw new ValidationError([
          { field: 'consent_key', message: `Missing consent keys: ${missing.join(', ')}` },
        ]);
      }
    }

    if (markComplete && sectionKey === 'legal_declarations') {
      const items = parsed as Array<{ declaration_key: string; declared_at?: string }>;
      const keys = items.map((i) => i.declaration_key);
      const missing = DECLARATION_KEYS.filter((k) => !keys.includes(k));
      if (missing.length > 0) {
        throw new ValidationError([
          { field: 'declaration_key', message: `Missing declaration keys: ${missing.join(', ')}` },
        ]);
      }
    }

    let finalData = parsed;
    if (markComplete && sectionKey === 'compliance_consents') {
      finalData = (parsed as any[]).map((item: any) => ({
        ...item,
        granted_at: item.granted_at || new Date().toISOString(),
      }));
    }
    if (markComplete && sectionKey === 'legal_declarations') {
      finalData = (parsed as any[]).map((item: any) => ({
        ...item,
        declared_at: item.declared_at || new Date().toISOString(),
      }));
    }

    const newStatus = markComplete ? 'completed' : 'in_progress';
    const statusCol = `${sectionKey}_status` as keyof typeof provider_onboarding;

    const wasCompleted = row[`${sectionKey}_status` as keyof typeof row] === 'completed';
    let completedDelta = 0;
    if (markComplete && !wasCompleted) completedDelta = 1;
    if (!markComplete && wasCompleted) completedDelta = -1;

    const [updated] = await db
      .update(provider_onboarding)
      .set({
        [sectionKey]: finalData,
        [statusCol]: newStatus,
        completed_sections: row.completed_sections + completedDelta,
        updated_at: new Date(),
      } as any)
      .where(eq(provider_onboarding.id, row.id))
      .returning();

    logger.info({ providerId, sectionKey, markComplete }, 'Section saved');
    return {
      section: sectionKey,
      status: newStatus,
      data: finalData,
    };
  }

  async submit(providerId: string) {
    const row = await this.getFullOnboarding(providerId);

    if (row.status !== 'draft') {
      throw new ConflictError(`Cannot submit from ${row.status} state`);
    }

    if (row.completed_sections < row.total_sections) {
      throw new ConflictError(
        `All ${row.total_sections} sections must be completed. Currently ${row.completed_sections} done.`,
      );
    }

    const [updated] = await db
      .update(provider_onboarding)
      .set({
        status: 'submitted',
        submitted_at: new Date(),
        updated_at: new Date(),
      })
      .where(eq(provider_onboarding.id, row.id))
      .returning();

    logger.info({ providerId }, 'Onboarding submitted');
    return updated;
  }

  async getProgressByAuthId(authId: string) {
    const providerId = await this.resolveProviderId(authId);
    return this.getProgress(providerId);
  }

  async getSectionByAuthId(authId: string, sectionKey: SectionKey) {
    const providerId = await this.resolveProviderId(authId);
    return this.getSection(providerId, sectionKey);
  }

  async saveSectionByAuthId(authId: string, sectionKey: SectionKey, data: unknown, markComplete: boolean) {
    const providerId = await this.resolveProviderId(authId);
    return this.saveSection(providerId, sectionKey, data, markComplete);
  }

  async submitByAuthId(authId: string) {
    const providerId = await this.resolveProviderId(authId);
    return this.submit(providerId);
  }

  // ── Admin methods ──

  async adminListProviders(filters?: { status?: string; page?: number; limit?: number }) {
    const page = filters?.page || 1;
    const limit = filters?.limit || 20;
    const offset = (page - 1) * limit;

    let query = db
      .select({
        provider_id: providers.id,
        business_name: providers.business_name,
        display_name: providers.display_name,
        provider_status: providers.status,
        user_id: users.id,
        first_name: users.first_name,
        last_name: users.last_name,
        email: users.email,
        onboarding_id: provider_onboarding.id,
        onboarding_status: provider_onboarding.status,
        completed_sections: provider_onboarding.completed_sections,
        total_sections: provider_onboarding.total_sections,
        submitted_at: provider_onboarding.submitted_at,
        reviewed_at: provider_onboarding.reviewed_at,
        created_at: provider_onboarding.created_at,
      })
      .from(providers)
      .innerJoin(users, eq(users.id, providers.user_id))
      .leftJoin(provider_onboarding, eq(provider_onboarding.provider_id, providers.id))
      .$dynamic();

    if (filters?.status) {
      query = query.where(eq(provider_onboarding.status, filters.status as any));
    }

    const rows = await query.orderBy(providers.created_at).limit(limit).offset(offset);

    const [{ count }] = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(providers)
      .innerJoin(users, eq(users.id, providers.user_id))
      .leftJoin(provider_onboarding, eq(provider_onboarding.provider_id, providers.id));

    return {
      data: rows,
      pagination: {
        page,
        limit,
        total: count,
        totalPages: Math.ceil(count / limit),
      },
    };
  }

  async adminGetOnboarding(providerId: string) {
    return this.getFullOnboarding(providerId);
  }

  async adminGetChecks(providerId: string) {
    const row = await this.getFullOnboarding(providerId);

    let checks = await db
      .select()
      .from(provider_admin_checks)
      .where(eq(provider_admin_checks.onboarding_id, row.id));

    if (checks.length === 0) {
      const values = ADMIN_CHECK_KEYS.map((key) => ({
        provider_id: providerId,
        onboarding_id: row.id,
        check_key: key,
      }));
      checks = await db.insert(provider_admin_checks).values(values).returning();
    }

    return checks;
  }

  async adminUpdateCheck(
    providerId: string,
    adminUserId: string,
    checkKey: string,
    isChecked: boolean,
    notes?: string,
  ) {
    if (!ADMIN_CHECK_KEYS.includes(checkKey as any)) {
      throw new ValidationError(
        [{ field: 'check_key', message: `Must be one of: ${ADMIN_CHECK_KEYS.join(', ')}` }],
      );
    }

    const row = await this.getFullOnboarding(providerId);

    const [existing] = await db
      .select()
      .from(provider_admin_checks)
      .where(
        and(
          eq(provider_admin_checks.onboarding_id, row.id),
          eq(provider_admin_checks.check_key, checkKey),
        ),
      )
      .limit(1);

    if (!existing) {
      const [created] = await db
        .insert(provider_admin_checks)
        .values({
          provider_id: providerId,
          onboarding_id: row.id,
          check_key: checkKey,
          is_checked: isChecked,
          checked_by: adminUserId,
          checked_at: isChecked ? new Date() : null,
          notes: notes ?? null,
        })
        .returning();
      return created;
    }

    const [updated] = await db
      .update(provider_admin_checks)
      .set({
        is_checked: isChecked,
        checked_by: adminUserId,
        checked_at: isChecked ? new Date() : null,
        notes: notes ?? existing.notes,
      })
      .where(eq(provider_admin_checks.id, existing.id))
      .returning();

    return updated;
  }

  async adminGetDocumentUrls(providerId: string) {
    const row = await this.getFullOnboarding(providerId);

    const documentFields: { field: string; section: string; sectionKey: string }[] = [
      { field: 'profile_photo_url', section: 'basic_identity', sectionKey: 'basic_identity' },
      { field: 'govt_id_proof_url', section: 'license_verification', sectionKey: 'license_verification' },
      { field: 'address_proof_url', section: 'license_verification', sectionKey: 'license_verification' },
      { field: 'insurance_proof_url', section: 'license_verification', sectionKey: 'license_verification' },
      { field: 'profile_photo_url', section: 'marketplace_profile', sectionKey: 'marketplace_profile' },
    ];

    const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');

    const s3 = new S3Client({
      region: config.AWS_REGION,
      credentials: {
        accessKeyId: config.AWS_ACCESS_KEY_ID,
        secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
      },
    });

    const bucket = config.S3_UPLOADS_BUCKET;
    const bucketPrefix = `https://${bucket}.s3.${config.AWS_REGION}.amazonaws.com/`;

    const documents: { field: string; section: string; public_url: string; view_url: string }[] = [];

    for (const { field, section, sectionKey } of documentFields) {
      const sectionData = row[sectionKey as keyof typeof row] as Record<string, unknown> | null;
      if (!sectionData || !sectionData[field]) continue;

      const publicUrl = sectionData[field] as string;
      if (!publicUrl.startsWith(bucketPrefix)) {
        documents.push({ field, section, public_url: publicUrl, view_url: publicUrl });
        continue;
      }

      const key = publicUrl.replace(bucketPrefix, '');
      const command = new GetObjectCommand({ Bucket: bucket, Key: key });
      const viewUrl = await getSignedUrl(s3, command, { expiresIn: 900 });
      documents.push({ field, section, public_url: publicUrl, view_url: viewUrl });
    }

    logger.info({ providerId, count: documents.length }, 'Admin document view URLs generated');
    return { provider_id: providerId, documents, expires_in: 900 };
  }

  async adminUpdateStatus(
    providerId: string,
    adminUserId: string,
    status: 'approved' | 'rejected',
    reviewerNotes?: string,
  ) {
    const row = await this.getFullOnboarding(providerId);

    if (row.status !== 'submitted' && row.status !== 'under_review') {
      throw new ConflictError(`Cannot ${status} from ${row.status} state`);
    }

    const [updated] = await db
      .update(provider_onboarding)
      .set({
        status,
        reviewed_at: new Date(),
        reviewer_notes: reviewerNotes ?? null,
        updated_at: new Date(),
      })
      .where(eq(provider_onboarding.id, row.id))
      .returning();

    if (status === 'approved') {
      await db
        .update(providers)
        .set({ status: 'verified', updated_at: new Date() })
        .where(eq(providers.id, providerId));
    }

    logger.info({ providerId, status }, 'Onboarding status updated by admin');
    return updated;
  }
}
