import { BadRequestError, ConflictError, NotFoundError } from '@longeny/errors';
import { createLogger } from '@longeny/utils';
import type { CorrectReading, SubmitReadings } from '@longeny/validators';
import { asc, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { biomarker_readings, documents } from '../db/schema.js';

const logger = createLogger('readings');

type ReadingRow = typeof biomarker_readings.$inferSelect;

/** A report a reading can be attached to: exists, not deleted, belongs to a patient. */
export interface ReportRef {
  id: string;
  profileId: string;
  documentType: string;
  reportedAt: Date | null;
  createdAt: Date;
}

function present(row: ReadingRow, supersededBy: string | null = null) {
  return {
    id: row.id,
    profile_id: row.profile_id,
    document_id: row.document_id,
    marker_code: row.marker_code,
    value: Number(row.value),
    unit: row.unit,
    measured_at: row.measured_at.toISOString(),
    entry_method: row.entry_method,
    supersedes_id: row.supersedes_id,
    superseded_by: supersededBy,
    current: supersededBy === null,
    created_at: row.created_at.toISOString(),
  };
}

/**
 * Readings — the values inside a report.
 *
 * Every reading belongs to one report, and takes its subject of care from that
 * report rather than from the request: the report was scoped to a profile when
 * it was uploaded, and a body-supplied profile id would let a value be filed
 * against someone else.
 *
 * Nothing is updated in place. A correction is a new row that names the one it
 * replaces, so a benchmark or score computed before the correction can still be
 * explained from what was stored at the time.
 */
export class ReadingsService {
  /** The report, if it exists and is not deleted. Access is checked by the caller. */
  async findReport(documentId: string): Promise<ReportRef> {
    const [doc] = await db
      .select({
        id: documents.id,
        profileId: documents.profile_id,
        documentType: documents.document_type,
        reportedAt: documents.reported_at,
        createdAt: documents.created_at,
        status: documents.status,
        deletedAt: documents.deleted_at,
      })
      .from(documents)
      .where(eq(documents.id, documentId))
      .limit(1);

    // A deleted report, and a provider-owned document with no patient, both
    // answer as missing: neither has a subject of care to attach a value to.
    if (!doc || doc.status === 'deleted' || doc.deletedAt !== null || !doc.profileId) {
      throw new NotFoundError('Report');
    }
    return {
      id: doc.id,
      profileId: doc.profileId,
      documentType: doc.documentType,
      reportedAt: doc.reportedAt,
      createdAt: doc.createdAt,
    };
  }

  /**
   * Enter the values from one report, all or nothing.
   *
   * Only lab reports carry values. A prescription or an insurance letter with a
   * "HbA1c" typed against it is a filing mistake, not a measurement.
   */
  async submit(report: ReportRef, authId: string, body: SubmitReadings) {
    if (report.documentType !== 'lab_report') {
      throw new BadRequestError('Readings can only be entered against a lab report');
    }

    // The sample date defaults to the date on the report, never to today: a
    // value typed in a month after the blood draw was not measured today.
    const fallback = report.reportedAt ?? report.createdAt;

    const rows = await db
      .insert(biomarker_readings)
      .values(
        body.readings.map((reading) => ({
          profile_id: report.profileId,
          document_id: report.id,
          marker_code: reading.markerCode,
          value: String(reading.value),
          unit: reading.unit,
          measured_at: reading.measuredAt ? new Date(reading.measuredAt) : fallback,
          entry_method: 'manual' as const,
          entered_by_auth_id: authId,
        })),
      )
      .returning();

    logger.info(
      { documentId: report.id, profileId: report.profileId, count: rows.length },
      'Readings entered',
    );
    return rows.map((row) => present(row));
  }

  /** Every reading on a report, corrected ones included, oldest entry first. */
  async listForReport(documentId: string) {
    const rows = await db
      .select()
      .from(biomarker_readings)
      .where(eq(biomarker_readings.document_id, documentId))
      .orderBy(asc(biomarker_readings.marker_code), asc(biomarker_readings.created_at));

    const supersededBy = new Map<string, string>();
    for (const row of rows) {
      if (row.supersedes_id) supersededBy.set(row.supersedes_id, row.id);
    }
    return rows.map((row) => present(row, supersededBy.get(row.id) ?? null));
  }

  /** A reading and the report it sits on. */
  async findReading(readingId: string) {
    const [row] = await db
      .select()
      .from(biomarker_readings)
      .where(eq(biomarker_readings.id, readingId))
      .limit(1);
    if (!row) throw new NotFoundError('Reading');
    const report = await this.findReport(row.document_id).catch(() => {
      throw new NotFoundError('Reading');
    });
    return { reading: row, report };
  }

  /**
   * Replace a reading with a corrected one.
   *
   * Only the current reading can be corrected. Correcting one that has already
   * been replaced would fork the history into two "current" values; the caller
   * is told to correct the latest instead. Two corrections racing for the same
   * reading are decided by the unique constraint on `supersedes_id`, and the
   * loser gets the same 409.
   */
  async correct(reading: ReadingRow, authId: string, body: CorrectReading) {
    const [already] = await db
      .select({ id: biomarker_readings.id })
      .from(biomarker_readings)
      .where(eq(biomarker_readings.supersedes_id, reading.id))
      .limit(1);
    if (already) {
      throw new ConflictError(
        'This reading has already been corrected; correct the latest value instead',
        'READING_SUPERSEDED',
      );
    }

    try {
      const [row] = await db
        .insert(biomarker_readings)
        .values({
          profile_id: reading.profile_id,
          document_id: reading.document_id,
          marker_code: reading.marker_code,
          value: String(body.value),
          unit: body.unit,
          measured_at: body.measuredAt ? new Date(body.measuredAt) : reading.measured_at,
          entry_method: 'manual',
          entered_by_auth_id: authId,
          supersedes_id: reading.id,
        })
        .returning();

      logger.info({ readingId: reading.id, correctionId: row.id }, 'Reading corrected');
      return present(row);
    } catch (error) {
      if (error instanceof Error && error.message.includes('biomarker_reading_supersedes_unique')) {
        throw new ConflictError(
          'This reading has already been corrected; correct the latest value instead',
          'READING_SUPERSEDED',
        );
      }
      throw error;
    }
  }
}
