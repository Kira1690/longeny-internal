import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { reference_ranges } from '../db/schema.js';
import { type RangeInput, type Subject, benchmark } from './benchmark/engine.js';

type RangeRow = typeof reference_ranges.$inferSelect;

/** numeric columns arrive as strings; null stays null. */
const num = (v: string | null): number | null => (v === null ? null : Number(v));

function toRangeInput(row: RangeRow): RangeInput {
  return {
    id: row.id,
    markerCode: row.marker_code,
    markerName: row.marker_name,
    unit: row.unit,
    sex: row.sex,
    ageMinYears: row.age_min_years,
    ageMaxYears: row.age_max_years,
    normalLow: num(row.normal_low),
    normalHigh: num(row.normal_high),
    optimalLow: num(row.optimal_low),
    optimalHigh: num(row.optimal_high),
    source: row.source,
    isPlaceholder: row.is_placeholder,
    effectiveFrom: row.effective_from,
  };
}

function presentRange(row: RangeRow) {
  return {
    id: row.id,
    marker_code: row.marker_code,
    marker_name: row.marker_name,
    unit: row.unit,
    sex: row.sex,
    age_min_years: row.age_min_years,
    age_max_years: row.age_max_years,
    normal_low: num(row.normal_low),
    normal_high: num(row.normal_high),
    optimal_low: num(row.optimal_low),
    optimal_high: num(row.optimal_high),
    pillar: row.pillar,
    source: row.source,
    provisional: row.is_placeholder,
  };
}

interface CurrentReading {
  id: string;
  marker_code: string;
  value: string;
  unit: string;
  measured_at: Date;
  document_id: string;
  entry_method: 'manual' | 'extracted';
}

/**
 * Benchmarks — each current reading for a profile, judged against the range
 * that applies to it.
 *
 * The judgement itself lives in `benchmark/engine.ts`; this class only loads the
 * inputs and shapes the output.
 *
 * Demographics: user-provider's profile resolution deliberately carries no PII,
 * so this service does not know the subject's sex or age. Only ranges that do
 * not depend on either are applied, and a marker whose only ranges are sex- or
 * age-specific answers `no_reference / needs_demographics` rather than borrowing
 * someone else's range. Supplying demographics is a follow-up (see the Week 8
 * plan) and needs no change here beyond passing a `Subject`.
 */
export class BenchmarkService {
  /** Ranges currently in force, optionally for one marker. */
  async listReferenceRanges(markerCode?: string) {
    const rows = await db
      .select()
      .from(reference_ranges)
      .where(
        and(
          isNull(reference_ranges.retired_at),
          markerCode ? eq(reference_ranges.marker_code, markerCode) : undefined,
        ),
      )
      .orderBy(asc(reference_ranges.marker_code), asc(reference_ranges.sex));
    return rows.map(presentRange);
  }

  /**
   * The newest reading per marker that no correction has replaced, from reports
   * that still exist.
   */
  async currentReadings(profileId: string): Promise<CurrentReading[]> {
    const rows = await db.execute(sql`
      SELECT DISTINCT ON (r.marker_code)
        r.id, r.marker_code, r.value, r.unit, r.measured_at, r.document_id, r.entry_method
      FROM biomarker_readings r
      JOIN documents d ON d.id = r.document_id
      WHERE r.profile_id = ${profileId}
        AND d.deleted_at IS NULL
        AND d.status <> 'deleted'
        AND NOT EXISTS (
          SELECT 1 FROM biomarker_readings s WHERE s.supersedes_id = r.id
        )
      ORDER BY r.marker_code, r.measured_at DESC, r.created_at DESC
    `);
    return (rows as unknown as CurrentReading[]).map((row) => ({
      ...row,
      measured_at: new Date(row.measured_at),
    }));
  }

  async profileBenchmarks(profileId: string, subject: Subject = {}) {
    const readings = await this.currentReadings(profileId);
    if (readings.length === 0) return [];

    const markers = [...new Set(readings.map((r) => r.marker_code))];
    const rangeRows = await db
      .select()
      .from(reference_ranges)
      .where(
        and(isNull(reference_ranges.retired_at), inArray(reference_ranges.marker_code, markers)),
      );
    const byId = new Map(rangeRows.map((row) => [row.id, row]));
    const ranges = rangeRows.map(toRangeInput);

    return readings.map((reading) => {
      const verdict = benchmark(
        { markerCode: reading.marker_code, value: Number(reading.value), unit: reading.unit },
        ranges,
        subject,
      );
      const rangeRow = verdict.range ? byId.get(verdict.range.id) : undefined;
      return {
        marker_code: reading.marker_code,
        marker_name: rangeRow?.marker_name ?? null,
        status: verdict.status,
        reason: verdict.reason ?? null,
        provisional: verdict.provisional,
        reading: {
          id: reading.id,
          value: Number(reading.value),
          unit: reading.unit,
          measured_at: reading.measured_at.toISOString(),
          document_id: reading.document_id,
          entry_method: reading.entry_method,
        },
        range: rangeRow ? presentRange(rangeRow) : null,
      };
    });
  }
}
