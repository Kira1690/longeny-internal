import { createLogger } from '@longeny/utils';
import { and, eq, sql } from 'drizzle-orm';
import { config } from '../../config/index.js';
import { db } from '../../db/index.js';
import { documents, report_pages } from '../../db/schema.js';
import type { S3Service } from '../s3.service.js';
import { type OcrProvider, createOcrProvider } from './ocr.js';
import { UnreadableReportError, readReport } from './read-report.js';

const logger = createLogger('report-reader');

/** A read that has not finished in this long is assumed dead and handed back. */
const STALE_CLAIM = sql`interval '10 minutes'`;
/** Starts of a read before a report is given up on. Throttling does not count. */
export const MAX_ATTEMPTS = 3;
const BATCH = 3;

type ClaimedRow = {
  id: string;
  profile_id: string;
  file_key: string;
  mime_type: string;
  processing_attempts: number;
};

/**
 * The background reader: picks up reports whose file is confirmed in storage
 * and stores their text page by page.
 *
 * Runs inside ai-content-service as a poll loop — no public endpoint. Rows are
 * claimed with `FOR UPDATE SKIP LOCKED`, so two instances never read the same
 * report, and a crashed read is reclaimed after ten minutes.
 *
 * Logs carry ids, counts, methods and timings. Never file content and never
 * extracted text: both are health data.
 */
export class ReportReader {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private stopped = true;
  private wakeRequested = false;

  constructor(
    private readonly s3: S3Service,
    private readonly ocr: OcrProvider = createOcrProvider(),
    private readonly pollMs: number = config.REPORT_READER_POLL_MS,
    private readonly maxOcrPages: number = config.REPORT_OCR_MAX_PAGES,
  ) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    logger.info({ ocr: this.ocr.name, pollMs: this.pollMs }, 'Report reader started');
    this.schedule(0);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** A report just became readable: look now rather than at the next poll. */
  wake(): void {
    if (this.stopped) return;
    if (this.running) {
      this.wakeRequested = true;
      return;
    }
    this.schedule(0);
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.loop(), delayMs);
  }

  private async loop(): Promise<void> {
    this.running = true;
    let claimed = 0;
    try {
      claimed = await this.tick();
    } catch (error) {
      logger.error({ error }, 'Report reader tick failed');
    } finally {
      this.running = false;
    }
    // A full batch means there is probably more waiting.
    const again = this.wakeRequested || claimed === BATCH;
    this.wakeRequested = false;
    this.schedule(again ? 0 : this.pollMs);
  }

  /** One pass: reclaim dead reads, claim a batch, read each. Returns how many were claimed. */
  async tick(): Promise<number> {
    await this.reclaimStale();
    const rows = await this.claim();
    for (const row of rows) await this.process(row);
    return rows.length;
  }

  private async reclaimStale(): Promise<void> {
    // Out of attempts: stop trying.
    await db.execute(sql`
      UPDATE documents
         SET processing_status = 'failed',
             processing_error = 'could not be read — try again later',
             processed_at = now(),
             claimed_at = NULL,
             updated_at = now()
       WHERE processing_status = 'reading'
         AND claimed_at < now() - ${STALE_CLAIM}
         AND processing_attempts >= ${MAX_ATTEMPTS}
    `);
    await db.execute(sql`
      UPDATE documents
         SET processing_status = 'uploaded', claimed_at = NULL, updated_at = now()
       WHERE processing_status = 'reading'
         AND claimed_at < now() - ${STALE_CLAIM}
    `);
  }

  private async claim(): Promise<ClaimedRow[]> {
    const result = await db.execute(sql`
      UPDATE documents
         SET processing_status = 'reading',
             claimed_at = now(),
             processing_attempts = processing_attempts + 1,
             updated_at = now()
       WHERE id IN (
         SELECT id FROM documents
          WHERE processing_status = 'uploaded'
            AND status <> 'deleted'
            AND owner_type = 'user'
            AND profile_id IS NOT NULL
          ORDER BY updated_at
          LIMIT ${BATCH}
          FOR UPDATE SKIP LOCKED
       )
       RETURNING id, profile_id, file_key, mime_type, processing_attempts
    `);
    return result as unknown as ClaimedRow[];
  }

  private async process(row: ClaimedRow): Promise<void> {
    const started = Date.now();
    try {
      let bytes: Uint8Array;
      try {
        bytes = await this.s3.getObjectBytes(row.file_key);
      } catch (error) {
        const name = (error as { name?: string }).name;
        if (name === 'NoSuchKey' || name === 'NotFound') {
          throw new UnreadableReportError('file could not be found in storage');
        }
        throw error;
      }

      const result = await readReport(bytes, row.mime_type, this.ocr, this.maxOcrPages);

      // Pages and status together: a report is never `read` with half its pages.
      await db.transaction(async (tx) => {
        await tx.delete(report_pages).where(eq(report_pages.document_id, row.id));
        await tx.insert(report_pages).values(
          result.pages.map((p) => ({
            document_id: row.id,
            profile_id: row.profile_id,
            page_number: p.pageNumber,
            method: p.method,
            text: p.text,
            tables: p.tables,
            ocr_confidence: p.confidence === null ? null : p.confidence.toFixed(2),
          })),
        );
        await tx
          .update(documents)
          .set({
            processing_status: 'read',
            read_method: result.readMethod,
            page_count: result.pageCount,
            processing_error: null,
            processing_note: result.note,
            processed_at: new Date(),
            claimed_at: null,
            updated_at: new Date(),
          })
          .where(and(eq(documents.id, row.id), eq(documents.processing_status, 'reading')));
      });

      logger.info(
        {
          reportId: row.id,
          pages: result.pageCount,
          pagesWithText: result.pages.length,
          method: result.readMethod,
          ocrPages: result.ocrPages,
          ocr: this.ocr.name,
          ms: Date.now() - started,
        },
        'Report read',
      );
    } catch (error) {
      if (error instanceof UnreadableReportError) {
        await this.finish(row.id, 'failed', error.reason);
        logger.info({ reportId: row.id, reason: error.reason }, 'Report unreadable');
        return;
      }
      // Something on our side. Try again on a later pass, until attempts run out.
      const outOfAttempts = row.processing_attempts >= MAX_ATTEMPTS;
      await this.finish(
        row.id,
        outOfAttempts ? 'failed' : 'uploaded',
        outOfAttempts ? 'could not be read — try again later' : null,
      );
      logger.error(
        { reportId: row.id, attempt: row.processing_attempts, errorName: (error as Error)?.name },
        'Report read failed',
      );
    }
  }

  private async finish(id: string, status: 'failed' | 'uploaded', reason: string | null) {
    await db
      .update(documents)
      .set({
        processing_status: status,
        processing_error: reason,
        processed_at: status === 'failed' ? new Date() : null,
        claimed_at: null,
        updated_at: new Date(),
      })
      .where(and(eq(documents.id, id), eq(documents.processing_status, 'reading')));
  }
}
