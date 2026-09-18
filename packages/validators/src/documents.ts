import { z } from 'zod';

/**
 * Document upload — the declaration a client makes before it is handed an
 * upload link.
 *
 * The link is presigned with the declared size and type as signed headers, so
 * what is checked here is exactly what S3 will accept: a different size or a
 * different content type is refused by S3 itself, not only by this service.
 * Checking the declaration is therefore checking the file, before any byte of
 * it reaches storage.
 */

/**
 * Patient reports hold labs and imaging. Nothing executable, nothing that
 * renders as a page.
 *
 * Every type here except DICOM can be read for text: PDFs from their own text
 * layer, and scans, screenshots and photos by OCR, which reads JPEG, PNG and
 * TIFF. WebP and HEIC are not accepted because OCR cannot read them — the app
 * converts a phone's HEIC photo to JPEG before declaring it. DICOM is medical
 * imaging: stored, never read.
 */
export const UPLOAD_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/tiff',
  'application/dicom',
] as const;
export type UploadMimeType = (typeof UPLOAD_MIME_TYPES)[number];

/** The types whose text the reader can obtain. */
export const READABLE_MIME_TYPES: readonly UploadMimeType[] = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/tiff',
];

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export const DOCUMENT_TYPES = [
  'lab_report',
  'prescription',
  'imaging',
  'insurance',
  'certificate',
  'other',
] as const;

export const uploadDocumentSchema = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().trim().max(5000).optional(),
  fileName: z.string().trim().min(1).max(300),
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
  documentType: z.enum(DOCUMENT_TYPES).optional(),
  ownerType: z.enum(['user', 'provider']).optional(),
  reportedAt: z.string().datetime({ offset: true }).optional(),
  tags: z.array(z.string().trim().min(1).max(50)).max(20).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type UploadDocument = z.infer<typeof uploadDocumentSchema>;
