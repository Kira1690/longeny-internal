import { z } from 'zod';
import { markerCodeSchema } from './readings.js';

/**
 * Report extraction contract (P-W8-1) — what a model returns after reading a
 * lab report.
 *
 * Extraction **proposes**; it never commits. Its output becomes draft readings
 * that a person confirms through the readings API. A misread decimal in a lab
 * value is a clinical error, and OCR of a scanned report is where it happens.
 *
 * Two things the shape insists on:
 *  - `uncertain` on every value. A value the model is unsure of is marked, not
 *    guessed, so the confirming screen can put it in front of a person first.
 *  - `unmapped` and `unreadable` lists. A value silently skipped is worse than
 *    one read wrongly, because nobody goes looking for it — so anything seen
 *    and not extracted has to be said.
 */

export const READING_EXTRACTION_CONTRACT = 'extract-v1' as const;

export const extractedReadingSchema = z.object({
  /** Our code, when the printed test name maps to one; null when it does not. */
  markerCode: markerCodeSchema.nullable(),
  /** The test name exactly as printed. */
  printedName: z.string().min(1).max(200),
  value: z.number().finite(),
  /** As printed. Never converted. */
  unit: z.string().min(1).max(32),
  /** Sample date if the report prints one. */
  measuredAt: z.string().datetime({ offset: true }).nullable(),
  uncertain: z.boolean(),
  uncertainReason: z.string().max(300).nullable(),
});

export const readingExtractionOutputSchema = z.object({
  contract: z.literal(READING_EXTRACTION_CONTRACT),
  readings: z.array(extractedReadingSchema).max(200),
  /** Printed test names that were read but could not be mapped to a code. */
  unmapped: z.array(z.string().max(200)).max(200),
  /** Parts of the report that could not be read at all. */
  unreadable: z.array(z.string().max(300)).max(50),
});

export type ExtractedReading = z.infer<typeof extractedReadingSchema>;
export type ReadingExtractionOutput = z.infer<typeof readingExtractionOutputSchema>;
