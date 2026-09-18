import {
  ConflictError,
  NotFoundError,
  ServiceUnavailableError,
  TooManyRequestsError,
} from '@longeny/errors';
import { type AuditEntry, requestCtx } from '@longeny/middleware';
import { UserRole } from '@longeny/types';
import { createLogger } from '@longeny/utils';
import type { DeclareReport, ReportTimelineQuery, UpdateReport } from '@longeny/validators';
import { type InferSelectModel, and, asc, desc, eq, gte, ne, or, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { documents, phi_access_log, report_pages } from '../db/schema.js';
import { writePhiAccessLog } from './phi-audit.service.js';
import type { ProfileAccessService } from './profile-access.service.js';
import type { ReportReader } from './report-reader/reader.js';
import type { S3Service } from './s3.service.js';

const logger = createLogger('reports');

type DocumentRow = InferSelectModel<typeof documents>;

export interface Caller {
  userId: string;
  userRole?: string;
  userRoles?: string[];
  /** The request, so the audit row can name whose report was touched. */
  request?: Request;
}

/** Upload links are short: long enough for a slow phone connection, no longer. */
export const UPLOAD_LINK_SECONDS = 600;
export const DOWNLOAD_LINK_SECONDS = 300;
/** Every retry of a scanned report is paid for at OCR. */
export const RETRIES_PER_HOUR = 3;
/** A declaration nobody uploaded against for this long is abandoned and not listed. */
const ABANDONED_AFTER = sql`interval '24 hours'`;

/** What the API says about a report. Never the storage key. */
export function toReport(row: DocumentRow) {
  return {
    id: row.id,
    profile_id: row.profile_id as string,
    title: row.title,
    document_type: row.document_type,
    file_name: row.file_name,
    file_size: Number(row.file_size),
    mime_type: row.mime_type,
    reported_at: row.reported_at,
    rro_state_at_upload: row.rro_state_at_upload,
    processing_status: row.processing_status,
    read_method: row.read_method,
    processing_error: row.processing_error,
    processing_note: row.processing_note,
    page_count: row.page_count,
    processed_at: row.processed_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

const isProvider = (caller: Caller) =>
  caller.userRole === UserRole.PROVIDER || (caller.userRoles ?? []).includes(UserRole.PROVIDER);

/**
 * A patient's reports: declared, confirmed, read, looked at, corrected, removed.
 *
 * Every route names a profile or a report, and every one goes through
 * ProfileAccessService — this class never decides ownership itself:
 *
 *  - read  — the account that owns the report's profile, or a provider with an
 *            active booking for it;
 *  - write — the owning account only. A provider's write answers 404, the same
 *            as a stranger's: writing on a patient's record needs the care
 *            team model, which does not exist yet.
 *
 * "Not yours" is always 404, never 403, so report ids cannot be probed. A
 * deleted report is 404 everywhere except its owner's access log.
 */
export class ReportService {
  constructor(
    private readonly s3: S3Service,
    private readonly profileAccess: ProfileAccessService,
    private readonly reader: ReportReader | null,
  ) {}

  // ── Access ──

  private async load(reportId: string, { includeDeleted = false } = {}): Promise<DocumentRow> {
    const [row] = await db
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.id, reportId),
          eq(documents.owner_type, 'user'),
          sql`${documents.profile_id} IS NOT NULL`,
          includeDeleted ? undefined : ne(documents.status, 'deleted'),
        ),
      )
      .limit(1);
    if (!row) throw new NotFoundError('Report');
    return row;
  }

  /**
   * The subject of care goes on the audit row as soon as it is known — before
   * the access check, so a refused attempt records whose report was tried.
   */
  private noteProfile(caller: Caller, row: DocumentRow) {
    if (caller.request) requestCtx(caller.request).auditProfileId = row.profile_id as string;
  }

  /** Owner or booked provider. */
  async forRead(caller: Caller, reportId: string): Promise<DocumentRow> {
    const row = await this.load(reportId);
    this.noteProfile(caller, row);
    try {
      await this.profileAccess.assertCanRead(caller, row.profile_id as string);
    } catch (error) {
      if (error instanceof NotFoundError) throw new NotFoundError('Report');
      throw error;
    }
    return row;
  }

  /** Owning account only. */
  async forWrite(
    caller: Caller,
    reportId: string,
    opts: { includeDeleted?: boolean } = {},
  ): Promise<DocumentRow> {
    const row = await this.load(reportId, opts);
    this.noteProfile(caller, row);
    if (isProvider(caller)) throw new NotFoundError('Report');
    try {
      await this.profileAccess.assertOwns(caller.userId, row.profile_id as string);
    } catch (error) {
      // The profile was removed, or it was never theirs: either way, no report.
      if (error instanceof NotFoundError) throw new NotFoundError('Report');
      throw error;
    }
    return row;
  }

  // ── Declare and confirm ──

  async declare(caller: Caller, profileId: string, body: DeclareReport) {
    if (isProvider(caller)) throw new NotFoundError('Profile');
    const profile = await this.profileAccess.assertOwns(caller.userId, profileId);

    const id = crypto.randomUUID();
    const key = this.s3.buildReportKey(profile.profileId, id);

    const [row] = await db
      .insert(documents)
      .values({
        id,
        owner_id: caller.userId,
        owner_type: 'user',
        profile_id: profile.profileId,
        document_type: body.documentType,
        title: body.title,
        file_key: key,
        file_name: body.fileName,
        file_size: BigInt(body.fileSize),
        mime_type: body.mimeType,
        reported_at: body.reportedAt ? new Date(body.reportedAt) : null,
        rro_state_at_upload: profile.rroState,
        processing_status: 'awaiting_upload',
        status: 'active',
      })
      .returning();

    const { uploadUrl, expiresIn } = await this.s3.generateUploadUrl(
      key,
      body.mimeType,
      body.fileSize,
      undefined,
      UPLOAD_LINK_SECONDS,
    );

    return {
      report: toReport(row as DocumentRow),
      upload: {
        url: uploadUrl,
        method: 'PUT' as const,
        headers: { 'Content-Type': body.mimeType, 'Content-Length': String(body.fileSize) },
        expires_in: expiresIn,
      },
    };
  }

  /**
   * The app says the upload finished. Believed only once storage agrees: the
   * object must exist with exactly the declared size and type.
   */
  async complete(caller: Caller, reportId: string) {
    const row = await this.forWrite(caller, reportId);
    if (row.processing_status !== 'awaiting_upload') {
      throw new ConflictError(`Report is already ${row.processing_status}`, 'REPORT_STATE');
    }

    let head: Awaited<ReturnType<S3Service['headObject']>>;
    try {
      head = await this.s3.headObject(row.file_key);
    } catch (error) {
      logger.error({ reportId, errorName: (error as Error)?.name }, 'Storage check failed');
      throw new ServiceUnavailableError('storage');
    }
    if (!head) {
      throw new ConflictError('No file has been uploaded for this report', 'UPLOAD_MISSING');
    }
    if (head.contentLength !== Number(row.file_size) || head.contentType !== row.mime_type) {
      throw new ConflictError('Uploaded file does not match what was declared', 'UPLOAD_MISMATCH');
    }

    const next = row.mime_type === 'application/dicom' ? 'not_applicable' : 'uploaded';
    const [updated] = await db
      .update(documents)
      .set({ processing_status: next, updated_at: new Date() })
      .where(and(eq(documents.id, row.id), eq(documents.processing_status, 'awaiting_upload')))
      .returning();
    // Two completes raced and the other one won.
    if (!updated) throw new ConflictError('Report was already confirmed', 'REPORT_STATE');

    if (next === 'uploaded') this.reader?.wake();
    return toReport(updated);
  }

  // ── Read ──

  async get(caller: Caller, reportId: string) {
    return toReport(await this.forRead(caller, reportId));
  }

  /**
   * The download link leaves only after its audit row is written. Any other
   * route can record its access after answering; a link to the file itself
   * cannot, because once it is handed over it can be used.
   */
  async download(caller: Caller & { request: Request }, reportId: string) {
    const { request } = caller;
    const row = await this.forRead(caller, reportId);
    if (row.processing_status === 'awaiting_upload') {
      throw new ConflictError('Nothing has been uploaded for this report yet', 'REPORT_STATE');
    }

    const url = new URL(request.url);
    const entry: AuditEntry = {
      action: 'reports.download',
      resourceType: 'report',
      purpose: 'care_delivery',
      actorId: caller.userId,
      actorRole: caller.userRole,
      profileId: row.profile_id as string,
      resourceId: row.id,
      method: request.method,
      path: url.pathname,
      statusCode: 200,
      success: true,
      durationMs: 0,
      ip:
        request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
        request.headers.get('X-Real-IP') ||
        'unknown',
      userAgent: request.headers.get('User-Agent') || 'unknown',
      correlationId: request.headers.get('X-Correlation-ID') ?? undefined,
      occurredAt: new Date(),
    };
    try {
      await writePhiAccessLog(entry);
    } catch (error) {
      logger.error({ reportId, errorName: (error as Error)?.name }, 'Download audit failed');
      throw new ServiceUnavailableError('audit');
    }

    const { downloadUrl, expiresIn } = await this.s3.generateAttachmentUrl(
      row.file_key,
      row.file_name,
      DOWNLOAD_LINK_SECONDS,
    );
    return {
      url: downloadUrl,
      expires_in: expiresIn,
      file_name: row.file_name,
      mime_type: row.mime_type,
    };
  }

  /** Text read by machine, page by page. Empty until the report is `read`. */
  async text(caller: Caller, reportId: string, page?: number) {
    const row = await this.forRead(caller, reportId);
    const pages =
      row.processing_status !== 'read'
        ? []
        : await db
            .select({
              page_number: report_pages.page_number,
              method: report_pages.method,
              text: report_pages.text,
              tables: report_pages.tables,
              ocr_confidence: report_pages.ocr_confidence,
            })
            .from(report_pages)
            .where(
              and(
                eq(report_pages.document_id, row.id),
                page === undefined ? undefined : eq(report_pages.page_number, page),
              ),
            )
            .orderBy(asc(report_pages.page_number));

    return {
      report_id: row.id,
      processing_status: row.processing_status,
      read_method: row.read_method,
      processing_error: row.processing_error,
      processing_note: row.processing_note,
      page_count: row.page_count,
      pages: pages.map((p) => ({
        ...p,
        ocr_confidence: p.ocr_confidence === null ? null : Number(p.ocr_confidence),
      })),
    };
  }

  // ── Change ──

  async update(caller: Caller, reportId: string, body: UpdateReport) {
    const row = await this.forWrite(caller, reportId);
    const [updated] = await db
      .update(documents)
      .set({
        ...(body.title !== undefined && { title: body.title }),
        ...(body.documentType !== undefined && { document_type: body.documentType }),
        ...(body.reportedAt !== undefined && {
          reported_at: body.reportedAt === null ? null : new Date(body.reportedAt),
        }),
        updated_at: new Date(),
      })
      .where(and(eq(documents.id, row.id), ne(documents.status, 'deleted')))
      .returning();
    if (!updated) throw new NotFoundError('Report');
    return toReport(updated);
  }

  /** Only a failed read is retried, and only a few times an hour: each costs money. */
  async retry(caller: Caller, reportId: string) {
    const row = await this.forWrite(caller, reportId);
    if (row.processing_status !== 'failed') {
      throw new ConflictError(
        `Only a report that failed to read can be retried; this one is ${row.processing_status}`,
        'REPORT_STATE',
      );
    }

    const [{ recent }] = await db
      .select({ recent: sql<number>`COUNT(*)::int` })
      .from(phi_access_log)
      .where(
        and(
          eq(phi_access_log.action, 'reports.retry'),
          eq(phi_access_log.resource_id, row.id),
          eq(phi_access_log.success, true),
          gte(phi_access_log.occurred_at, sql`now() - interval '1 hour'`),
        ),
      );
    if (recent >= RETRIES_PER_HOUR) {
      throw new TooManyRequestsError(`A report can be retried ${RETRIES_PER_HOUR} times an hour`);
    }

    const updated = await db.transaction(async (tx) => {
      await tx.delete(report_pages).where(eq(report_pages.document_id, row.id));
      const [next] = await tx
        .update(documents)
        .set({
          processing_status: 'uploaded',
          processing_error: null,
          processing_note: null,
          read_method: null,
          page_count: null,
          processed_at: null,
          processing_attempts: 0,
          updated_at: new Date(),
        })
        .where(and(eq(documents.id, row.id), eq(documents.processing_status, 'failed')))
        .returning();
      return next;
    });
    if (!updated) throw new ConflictError('Report is no longer failed', 'REPORT_STATE');

    this.reader?.wake();
    return toReport(updated);
  }

  /**
   * Hidden at once from every route and the timeline. The file and its text
   * are kept: a record of what a clinician may have seen is not erased by the
   * patient hiding it.
   */
  async remove(caller: Caller, reportId: string): Promise<void> {
    const row = await this.forWrite(caller, reportId);
    await db
      .update(documents)
      .set({ status: 'deleted', deleted_at: new Date(), updated_at: new Date() })
      .where(eq(documents.id, row.id));
  }

  /**
   * Who opened the report. Owner only, and it outlives a delete: the owner may
   * want to know who saw it before it was removed.
   *
   * Refused attempts are left out on purpose — showing them would tell the
   * owner that someone guessed an id, which is for an access review, not a
   * patient screen. No addresses, no browsers.
   */
  async accessLog(caller: Caller, reportId: string, page: number, limit: number) {
    const row = await this.forWrite(caller, reportId, { includeDeleted: true });
    const where = and(
      eq(phi_access_log.resource_type, 'report'),
      eq(phi_access_log.resource_id, row.id),
      eq(phi_access_log.success, true),
      or(
        eq(phi_access_log.action, 'reports.view'),
        eq(phi_access_log.action, 'reports.download'),
        eq(phi_access_log.action, 'reports.text'),
      ),
    );

    const [rows, [{ total }]] = await Promise.all([
      db
        .select({
          occurred_at: phi_access_log.occurred_at,
          action: phi_access_log.action,
          actor_id: phi_access_log.actor_id,
          actor_role: phi_access_log.actor_role,
        })
        .from(phi_access_log)
        .where(where)
        .orderBy(desc(phi_access_log.occurred_at))
        .limit(limit)
        .offset((page - 1) * limit),
      db.select({ total: sql<number>`COUNT(*)::int` }).from(phi_access_log).where(where),
    ]);

    return {
      entries: rows.map((r) => ({
        occurred_at: r.occurred_at,
        action: r.action,
        actor_type: r.actor_role === UserRole.PROVIDER ? ('provider' as const) : ('owner' as const),
        is_you: r.actor_id === caller.userId,
      })),
      total,
    };
  }

  // ── Timeline ──

  /** A profile's reports, newest report date first. Owner or booked provider. */
  async timeline(caller: Caller, profileId: string, query: ReportTimelineQuery) {
    await this.profileAccess.assertCanRead(caller, profileId);

    const when = sql`COALESCE(${documents.reported_at}, ${documents.created_at})`;
    const where = and(
      eq(documents.profile_id, profileId),
      eq(documents.owner_type, 'user'),
      ne(documents.status, 'deleted'),
      sql`NOT (${documents.processing_status} = 'awaiting_upload' AND ${documents.created_at} < now() - ${ABANDONED_AFTER})`,
      query.documentType ? eq(documents.document_type, query.documentType) : undefined,
      query.status ? eq(documents.processing_status, query.status) : undefined,
      query.from ? gte(when, sql`${query.from}::date`) : undefined,
      query.to ? sql`${when} < (${query.to}::date + interval '1 day')` : undefined,
    );

    const [rows, [{ total }]] = await Promise.all([
      db
        .select()
        .from(documents)
        .where(where)
        .orderBy(desc(when), desc(documents.created_at))
        .limit(query.limit)
        .offset((query.page - 1) * query.limit),
      db.select({ total: sql<number>`COUNT(*)::int` }).from(documents).where(where),
    ]);

    return { reports: rows.map(toReport), total };
  }
}
