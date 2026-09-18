/**
 * Biomarker taxonomy — readings, reference ranges and benchmark verdicts.
 *
 * Week 8 puts measured values underneath the RRO classification. The chain is
 * `report (file) → readings → benchmark → score`, and this file holds the words
 * each step speaks, so the database enums, the validators and the API contract
 * cannot drift apart.
 */

/**
 * How a reading reached the system. Manual entry ships first; extraction only
 * ever proposes values a human confirms, because a misread decimal in a lab
 * value is a clinical error.
 */
export const READING_ENTRY_METHODS = ['manual', 'extracted'] as const;
export type ReadingEntryMethod = (typeof READING_ENTRY_METHODS)[number];

/**
 * Which people a reference range applies to. `any` is a range that does not
 * differ by sex; a sex-specific range is never applied to someone whose sex is
 * unknown.
 */
export const RANGE_SEXES = ['any', 'male', 'female'] as const;
export type RangeSex = (typeof RANGE_SEXES)[number];

/**
 * The verdict on one reading.
 *
 *  - `optimal`       inside the optimal band, which sits inside the normal band
 *  - `normal`        inside the normal band, outside the optimal one
 *  - `low` / `high`  outside the normal band
 *  - `no_reference`  nothing to compare against — never guessed
 *  - `unit_mismatch` the reading and the range use different units; values are
 *                    never converted silently
 */
export const BENCHMARK_STATUSES = [
  'optimal',
  'normal',
  'low',
  'high',
  'no_reference',
  'unit_mismatch',
] as const;
export type BenchmarkStatus = (typeof BENCHMARK_STATUSES)[number];

/** Why a reading has no reference. */
export const NO_REFERENCE_REASONS = [
  // No range exists for this marker at all.
  'no_range_for_marker',
  // Ranges exist, but every one of them is sex- or age-specific and the subject's
  // sex or age is not known.
  'needs_demographics',
] as const;
export type NoReferenceReason = (typeof NO_REFERENCE_REASONS)[number];
