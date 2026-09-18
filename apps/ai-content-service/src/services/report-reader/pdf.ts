import { PDFDocument } from 'pdf-lib';
import { extractText, getDocumentProxy } from 'unpdf';

/**
 * A page with fewer non-whitespace characters than this is treated as scanned.
 * A scan often carries a stray line of text — a scanner stamp, a page number —
 * so "no text at all" would send almost nothing to OCR that needs it.
 */
export const SCANNED_PAGE_THRESHOLD = 40;

/** The PDF could not be opened: encrypted, damaged, or not a PDF at all. */
export class UnreadablePdfError extends Error {
  constructor(cause: unknown) {
    super('PDF could not be opened', { cause });
    this.name = 'UnreadablePdfError';
  }
}

export interface PdfTextLayer {
  pageCount: number;
  /** One entry per page, in order. Empty or near-empty for a scanned page. */
  pages: string[];
}

/** The text each page carries itself. Local and free: nothing leaves the process. */
export async function readTextLayer(bytes: Uint8Array): Promise<PdfTextLayer> {
  try {
    // pdf.js takes ownership of the buffer it is given; hand it a copy so the
    // caller can still split pages out of the original.
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { totalPages, text } = await extractText(pdf, { mergePages: false });
    return { pageCount: totalPages, pages: text.map((t) => t.trim()) };
  } catch (error) {
    throw new UnreadablePdfError(error);
  }
}

export function isScanned(pageText: string): boolean {
  return pageText.replace(/\s/g, '').length < SCANNED_PAGE_THRESHOLD;
}

/**
 * One page as a single-page PDF, so only that page is sent for OCR and only
 * that page is paid for. `index` is zero-based.
 */
export async function extractPage(bytes: Uint8Array, index: number): Promise<Uint8Array> {
  try {
    const source = await PDFDocument.load(bytes);
    const single = await PDFDocument.create();
    const [page] = await single.copyPages(source, [index]);
    single.addPage(page);
    return await single.save();
  } catch (error) {
    throw new UnreadablePdfError(error);
  }
}
