import { z } from 'zod';

/**
 * Biomarker readings — the values typed in from a lab report.
 *
 * A misread decimal in a lab value is a clinical error, so the shape is strict:
 * unknown keys are rejected, units are required and never inferred, and one
 * submission cannot carry the same marker twice (which of the two would be the
 * value?).
 */

/** Lower-case code shared with the reference ranges, e.g. `hba1c`, `ldl_c`. */
export const markerCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/, 'Marker codes are lower-case letters, digits and underscores');

/**
 * numeric(12, 4) in the column: eight digits before the point. A value outside
 * that is a typo, and the database would refuse it anyway — refuse it here with
 * a message that says why.
 */
const valueSchema = z
  .number()
  .finite()
  .gt(-100_000_000, 'Value is out of range')
  .lt(100_000_000, 'Value is out of range')
  // The column keeps four decimal places. A fifth would be rounded away without
  // a word, so it is refused instead of stored as something else.
  .refine((v) => Math.round(v * 10_000) / 10_000 === v, 'At most four decimal places');

const unitSchema = z.string().trim().min(1).max(32);

export const readingEntrySchema = z
  .object({
    markerCode: markerCodeSchema,
    value: valueSchema,
    /** As printed on the report. Compared to a range's unit, never converted. */
    unit: unitSchema,
    /** When the sample was taken. Defaults to the report date. */
    measuredAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

export const submitReadingsSchema = z
  .object({
    readings: z.array(readingEntrySchema).min(1).max(100),
  })
  .strict()
  .superRefine((body, ctx) => {
    const seen = new Set<string>();
    body.readings.forEach((reading, index) => {
      if (seen.has(reading.markerCode)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['readings', index, 'markerCode'],
          message: `${reading.markerCode} appears more than once in this submission`,
        });
      }
      seen.add(reading.markerCode);
    });
  });

/**
 * A correction replaces one reading with another. The marker stays the same —
 * a value entered under the wrong marker is withdrawn and re-entered, not
 * "corrected" into a different measurement.
 */
export const correctReadingSchema = z
  .object({
    value: valueSchema,
    unit: unitSchema,
    measuredAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

export type ReadingEntry = z.infer<typeof readingEntrySchema>;
export type SubmitReadings = z.infer<typeof submitReadingsSchema>;
export type CorrectReading = z.infer<typeof correctReadingSchema>;
