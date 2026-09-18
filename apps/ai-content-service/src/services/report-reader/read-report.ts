import type { ReportPageMethod, ReportReadMethod } from '@longeny/types';
import { OcrInputError, type OcrProvider, type OcrTable } from './ocr.js';
import { UnreadablePdfError, extractPage, isScanned, readTextLayer } from './pdf.js';

/**
 * Turns a stored report into page text: the PDF's own text where it has one,
 * OCR only for the pages that need it. Pure apart from the OCR call, so every
 * branch is testable without a database or a bucket.
 */

export interface ReadPage {
  pageNumber: number;
  method: ReportPageMethod;
  text: string;
  tables: OcrTable[];
  confidence: number | null;
}

export interface ReadResult {
  pageCount: number;
  pages: ReadPage[];
  readMethod: ReportReadMethod;
  /** Something the person should know about a successful read, e.g. pages left unread. */
  note: string | null;
  /** Pages actually sent to OCR — what this read cost. */
  ocrPages: number;
}

/**
 * Nothing usable came out of the file. Retrying the same file will not change
 * that; `reason` is safe to show the person.
 */
export class UnreadableReportError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'UnreadableReportError';
  }
}

export const RETAKE = 'could not read — please retake or upload a clearer copy';

const hasText = (text: string) => text.replace(/\s/g, '').length > 0;

function methodOf(pages: ReadPage[]): ReportReadMethod {
  const ocr = pages.some((p) => p.method === 'ocr');
  const layer = pages.some((p) => p.method === 'text_layer');
  if (ocr && layer) return 'mixed';
  return ocr ? 'ocr' : 'text_layer';
}

async function readImage(bytes: Uint8Array, ocr: OcrProvider): Promise<ReadResult> {
  let page: Awaited<ReturnType<OcrProvider['readPage']>>;
  try {
    page = await ocr.readPage(bytes);
  } catch (error) {
    if (error instanceof OcrInputError) throw new UnreadableReportError(error.reason);
    throw error;
  }
  if (!hasText(page.text)) throw new UnreadableReportError(RETAKE);
  return {
    pageCount: 1,
    pages: [{ pageNumber: 1, method: 'ocr', ...page }],
    readMethod: 'ocr',
    note: null,
    ocrPages: 1,
  };
}

async function readPdf(
  bytes: Uint8Array,
  ocr: OcrProvider,
  maxOcrPages: number,
): Promise<ReadResult> {
  let layer: Awaited<ReturnType<typeof readTextLayer>>;
  try {
    layer = await readTextLayer(bytes);
  } catch (error) {
    if (error instanceof UnreadablePdfError)
      throw new UnreadableReportError('file could not be opened');
    throw error;
  }

  const pages: ReadPage[] = [];
  let ocrPages = 0;
  let skipped = 0;
  let lastOcrProblem: string | null = null;

  for (let i = 0; i < layer.pageCount; i++) {
    const text = layer.pages[i] ?? '';
    if (!isScanned(text)) {
      pages.push({ pageNumber: i + 1, method: 'text_layer', text, tables: [], confidence: null });
      continue;
    }
    if (ocrPages >= maxOcrPages) {
      skipped++;
      continue;
    }
    ocrPages++;
    try {
      const page = await ocr.readPage(await extractPage(bytes, i));
      if (hasText(page.text)) pages.push({ pageNumber: i + 1, method: 'ocr', ...page });
    } catch (error) {
      // One bad page does not sink the rest of the report.
      if (error instanceof OcrInputError) lastOcrProblem = error.reason;
      else if (error instanceof UnreadablePdfError) lastOcrProblem = 'file could not be opened';
      else throw error;
    }
  }

  if (pages.length === 0) throw new UnreadableReportError(lastOcrProblem ?? RETAKE);

  const unread = layer.pageCount - pages.length;
  let note: string | null = null;
  if (skipped > 0) {
    note = `only the first ${maxOcrPages} scanned pages were read`;
  } else if (unread > 0) {
    note = `${unread} of ${layer.pageCount} pages had no readable text`;
  }

  return { pageCount: layer.pageCount, pages, readMethod: methodOf(pages), note, ocrPages };
}

export async function readReport(
  bytes: Uint8Array,
  mimeType: string,
  ocr: OcrProvider,
  maxOcrPages: number,
): Promise<ReadResult> {
  if (mimeType === 'application/pdf') return readPdf(bytes, ocr, maxOcrPages);
  if (mimeType === 'image/jpeg' || mimeType === 'image/png' || mimeType === 'image/tiff') {
    return readImage(bytes, ocr);
  }
  throw new UnreadableReportError('file type could not be read');
}
