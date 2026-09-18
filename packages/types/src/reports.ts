/**
 * Report processing taxonomy — how far the reader has got with an uploaded
 * report, and how its text was obtained. Shared by the database enums, the
 * validators and the API contract so they cannot drift apart.
 */

/**
 * `awaiting_upload` — declared, link issued, file not confirmed yet.
 * `uploaded`        — file confirmed in storage, waiting for the reader.
 * `reading`         — claimed by the reader.
 * `read`            — at least one page of usable text stored.
 * `failed`          — nothing usable could be read; `processing_error` says why.
 * `not_applicable`  — stored but never read (medical imaging).
 */
export const REPORT_PROCESSING_STATUSES = [
  'awaiting_upload',
  'uploaded',
  'reading',
  'read',
  'failed',
  'not_applicable',
] as const;
export type ReportProcessingStatus = (typeof REPORT_PROCESSING_STATUSES)[number];

/**
 * `text_layer` — the PDF carried its own text; nothing was sent for OCR.
 * `ocr`        — every page was read by OCR (scans, screenshots, photos).
 * `mixed`      — some pages had text, the scanned ones went to OCR.
 */
export const REPORT_READ_METHODS = ['text_layer', 'ocr', 'mixed'] as const;
export type ReportReadMethod = (typeof REPORT_READ_METHODS)[number];

/** How one page was read. A single page is never `mixed`. */
export const REPORT_PAGE_METHODS = ['text_layer', 'ocr'] as const;
export type ReportPageMethod = (typeof REPORT_PAGE_METHODS)[number];
