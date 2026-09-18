import { REPORT_PROCESSING_STATUSES } from '@longeny/types';
import { z } from 'zod';
import { DOCUMENT_TYPES, MAX_UPLOAD_BYTES, UPLOAD_MIME_TYPES } from './documents.js';

/**
 * Patient reports — declaring an upload, correcting what was declared, and
 * filtering a profile's timeline.
 *
 * Strict throughout: an unknown key is refused rather than ignored, so a
 * client that believes it set a field it cannot set finds out.
 */

/** A report can be dated today in any timezone, but not later. */
const FUTURE_SLACK_MS = 24 * 60 * 60 * 1000;

/** `2026-09-01` or a full ISO date-time with offset; not in the future. */
export const reportDateSchema = z
  .union([z.string().date(), z.string().datetime({ offset: true })])
  .refine((v) => Date.parse(v) <= Date.now() + FUTURE_SLACK_MS, 'Report date is in the future');

const titleSchema = z.string().trim().min(1).max(300);

export const declareReportSchema = z
  .object({
    title: titleSchema,
    /** Shown back to the person and used as the download name. Never a path. */
    fileName: z
      .string()
      .trim()
      .min(1)
      .max(300)
      .refine((v) => !/[/\\]/.test(v), 'File name must not contain a path'),
    fileSize: z
      .number()
      .int()
      .positive()
      .max(MAX_UPLOAD_BYTES, `File exceeds the ${MAX_UPLOAD_BYTES / 1024 / 1024} MB limit`),
    mimeType: z.enum(UPLOAD_MIME_TYPES, {
      errorMap: () => ({
        message: `Unsupported file type. Allowed: ${UPLOAD_MIME_TYPES.join(', ')}`,
      }),
    }),
    documentType: z.enum(DOCUMENT_TYPES),
    /** When the lab produced the report — not when it is uploaded. */
    reportedAt: reportDateSchema.optional(),
  })
  .strict();

/**
 * What the owner may correct after upload. The profile a report belongs to, the
 * care stage recorded at upload, the file and the reader's results are not
 * editable: moving a report between people is not a correction.
 */
export const updateReportSchema = z
  .object({
    title: titleSchema.optional(),
    reportedAt: reportDateSchema.nullable().optional(),
    documentType: z.enum(DOCUMENT_TYPES).optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, 'Nothing to update');

export const reportTimelineQuerySchema = z
  .object({
    documentType: z.enum(DOCUMENT_TYPES).optional(),
    status: z.enum(REPORT_PROCESSING_STATUSES).optional(),
    from: z.string().date().optional(),
    to: z.string().date().optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict()
  .refine((q) => !q.from || !q.to || q.from <= q.to, '`from` is after `to`');

export type DeclareReport = z.infer<typeof declareReportSchema>;
export type UpdateReport = z.infer<typeof updateReportSchema>;
export type ReportTimelineQuery = z.infer<typeof reportTimelineQuerySchema>;
