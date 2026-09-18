/**
 * The report reader's decisions, without a database or a bucket: which pages
 * are read locally, which go to OCR, and what a person is told when nothing
 * can be read. OCR is a counting stand-in, so "only scanned pages are sent"
 * is checked, not assumed.
 *
 *   bun test apps/ai-content-service/test/report-reader.test.ts
 */
import { describe, expect, test } from 'bun:test';
import type { Block } from '@aws-sdk/client-textract';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import {
  FAKE_UNREADABLE_MARKER,
  OcrInputError,
  type OcrPage,
  type OcrProvider,
  createOcrProvider,
  pageFromBlocks,
} from '../src/services/report-reader/ocr.js';
import { SCANNED_PAGE_THRESHOLD, isScanned } from '../src/services/report-reader/pdf.js';
import {
  RETAKE,
  UnreadableReportError,
  readReport,
} from '../src/services/report-reader/read-report.js';

const LAB_LINE = 'HbA1c 6.2 % (reference 4.0 - 5.6) Fasting glucose 104 mg/dL';

/** `pages[i]` is that page's text; an empty string is a scanned (image-only) page. */
async function pdf(pages: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const text of pages) {
    const page = doc.addPage();
    if (text) page.drawText(text, { x: 40, y: 700, size: 11, font });
  }
  return doc.save();
}

class CountingOcr implements OcrProvider {
  readonly name = 'fake' as const;
  calls = 0;
  constructor(private readonly answer: (n: number) => OcrPage | Error) {}
  async readPage(): Promise<OcrPage> {
    this.calls++;
    const a = this.answer(this.calls);
    if (a instanceof Error) throw a;
    return a;
  }
}

const found = (text = 'Lipid panel LDL 118 mg/dL'): OcrPage => ({
  text,
  tables: [],
  confidence: 95.5,
});
const nothing: OcrPage = { text: '', tables: [], confidence: null };

describe('isScanned', () => {
  test('a page under the threshold is scanned', () => {
    expect(isScanned('Page 1')).toBe(true);
    expect(isScanned('x'.repeat(SCANNED_PAGE_THRESHOLD - 1))).toBe(true);
  });
  test('whitespace does not count', () => {
    expect(isScanned(`${' '.repeat(200)}\n\n\t`)).toBe(true);
  });
  test('a page with real text is not', () => {
    expect(isScanned(LAB_LINE)).toBe(false);
  });
});

describe('PDF', () => {
  test('a PDF with its own text is read locally — OCR is never called', async () => {
    const ocr = new CountingOcr(() => found());
    const r = await readReport(await pdf([LAB_LINE, LAB_LINE]), 'application/pdf', ocr, 30);
    expect(ocr.calls).toBe(0);
    expect(r.readMethod).toBe('text_layer');
    expect(r.pageCount).toBe(2);
    expect(r.pages.map((p) => p.method)).toEqual(['text_layer', 'text_layer']);
    expect(r.pages[0]?.text).toContain('HbA1c 6.2');
    expect(r.pages[0]?.confidence).toBeNull();
    expect(r.ocrPages).toBe(0);
  });

  test('a scanned PDF goes to OCR page by page', async () => {
    const ocr = new CountingOcr(() => found());
    const r = await readReport(await pdf(['', '']), 'application/pdf', ocr, 30);
    expect(ocr.calls).toBe(2);
    expect(r.readMethod).toBe('ocr');
    expect(r.pages.map((p) => p.pageNumber)).toEqual([1, 2]);
    expect(r.pages[0]?.confidence).toBe(95.5);
  });

  test('mixed: only the scanned page is sent to OCR', async () => {
    const ocr = new CountingOcr(() => found());
    const r = await readReport(await pdf([LAB_LINE, '', LAB_LINE]), 'application/pdf', ocr, 30);
    expect(ocr.calls).toBe(1);
    expect(r.readMethod).toBe('mixed');
    expect(r.pages.map((p) => p.method)).toEqual(['text_layer', 'ocr', 'text_layer']);
    expect(r.ocrPages).toBe(1);
  });

  test('a scanned page with nothing legible is left out and noted, the rest kept', async () => {
    const ocr = new CountingOcr(() => nothing);
    const r = await readReport(await pdf([LAB_LINE, '']), 'application/pdf', ocr, 30);
    expect(r.pages.map((p) => p.pageNumber)).toEqual([1]);
    expect(r.readMethod).toBe('text_layer');
    expect(r.note).toBe('1 of 2 pages had no readable text');
  });

  test('OCR is capped: pages past the limit are not sent, and the person is told', async () => {
    const ocr = new CountingOcr(() => found());
    const r = await readReport(await pdf(['', '', '', '']), 'application/pdf', ocr, 2);
    expect(ocr.calls).toBe(2);
    expect(r.pages).toHaveLength(2);
    expect(r.pageCount).toBe(4);
    expect(r.note).toBe('only the first 2 scanned pages were read');
  });

  test('one page OCR refuses does not sink the others', async () => {
    const ocr = new CountingOcr((n) =>
      n === 1 ? new OcrInputError('page is too large to read (over 10 MB)') : found(),
    );
    const r = await readReport(await pdf(['', '']), 'application/pdf', ocr, 30);
    expect(r.pages.map((p) => p.pageNumber)).toEqual([2]);
  });

  test('nothing legible anywhere → unreadable, with a reason the person can act on', async () => {
    const ocr = new CountingOcr(() => nothing);
    const error = await readReport(await pdf(['', '']), 'application/pdf', ocr, 30).catch((e) => e);
    expect(error).toBeInstanceOf(UnreadableReportError);
    expect(error.reason).toBe(RETAKE);
  });

  test('the last OCR refusal is the reason when every page was refused', async () => {
    const ocr = new CountingOcr(() => new OcrInputError('page is too large to read (over 10 MB)'));
    const error = await readReport(await pdf(['']), 'application/pdf', ocr, 30).catch((e) => e);
    expect(error.reason).toBe('page is too large to read (over 10 MB)');
  });

  test('a damaged PDF is "could not be opened", not a crash', async () => {
    const junk = new TextEncoder().encode('%PDF-1.7\nthis is not really a pdf at all');
    const error = await readReport(junk, 'application/pdf', new CountingOcr(found), 30).catch(
      (e) => e,
    );
    expect(error).toBeInstanceOf(UnreadableReportError);
    expect(error.reason).toBe('file could not be opened');
  });

  test('an unexpected OCR failure is not dressed up as an unreadable file', async () => {
    const ocr = new CountingOcr(() => new Error('socket hang up'));
    const error = await readReport(await pdf(['']), 'application/pdf', ocr, 30).catch((e) => e);
    expect(error).not.toBeInstanceOf(UnreadableReportError);
  });
});

describe('images', () => {
  test('a photo or screenshot is one OCR page', async () => {
    const ocr = new CountingOcr(() => found());
    const r = await readReport(new Uint8Array([1, 2, 3]), 'image/jpeg', ocr, 30);
    expect(ocr.calls).toBe(1);
    expect(r).toMatchObject({ pageCount: 1, readMethod: 'ocr', ocrPages: 1 });
  });

  test('a blurred photo → "please retake"', async () => {
    const error = await readReport(
      new Uint8Array([1]),
      'image/png',
      new CountingOcr(() => nothing),
      30,
    ).catch((e) => e);
    expect(error.reason).toBe(RETAKE);
  });

  test('a type the reader cannot read is refused, not guessed at', async () => {
    const error = await readReport(
      new Uint8Array([1]),
      'application/dicom',
      new CountingOcr(found),
      30,
    ).catch((e) => e);
    expect(error).toBeInstanceOf(UnreadableReportError);
  });
});

describe('providers', () => {
  test('the fake reads a marked file as illegible and anything else as a lab report', async () => {
    const fake = createOcrProvider('fake');
    const marked = new TextEncoder().encode(`PNG...${FAKE_UNREADABLE_MARKER}`);
    expect((await fake.readPage(marked)).text).toBe('');
    expect((await fake.readPage(new Uint8Array([1, 2]))).text).toContain('HbA1c');
  });

  test('disabled OCR refuses with a reason, so a scan fails cleanly', async () => {
    const error = await createOcrProvider('disabled')
      .readPage(new Uint8Array([1]))
      .catch((e) => e);
    expect(error).toBeInstanceOf(OcrInputError);
  });

  test('over 10 MB is refused before anything is sent', async () => {
    const error = await createOcrProvider('fake')
      .readPage(new Uint8Array(10 * 1024 * 1024 + 1))
      .catch((e) => e);
    expect(error).toBeInstanceOf(OcrInputError);
  });
});

describe('Textract output', () => {
  const blocks: Block[] = [
    { BlockType: 'PAGE', Id: 'p' },
    { BlockType: 'LINE', Id: 'l1', Text: 'City Labs', Confidence: 99 },
    { BlockType: 'LINE', Id: 'l2', Text: 'HbA1c 6.2 %', Confidence: 90 },
    { BlockType: 'WORD', Id: 'w1', Text: 'Test' },
    { BlockType: 'WORD', Id: 'w2', Text: 'Result' },
    { BlockType: 'WORD', Id: 'w3', Text: 'HbA1c' },
    { BlockType: 'WORD', Id: 'w4', Text: '6.2' },
    {
      BlockType: 'CELL',
      Id: 'c11',
      RowIndex: 1,
      ColumnIndex: 1,
      Relationships: [{ Type: 'CHILD', Ids: ['w1'] }],
    },
    {
      BlockType: 'CELL',
      Id: 'c12',
      RowIndex: 1,
      ColumnIndex: 2,
      Relationships: [{ Type: 'CHILD', Ids: ['w2'] }],
    },
    {
      BlockType: 'CELL',
      Id: 'c21',
      RowIndex: 2,
      ColumnIndex: 1,
      Relationships: [{ Type: 'CHILD', Ids: ['w3'] }],
    },
    {
      BlockType: 'CELL',
      Id: 'c22',
      RowIndex: 2,
      ColumnIndex: 2,
      Relationships: [{ Type: 'CHILD', Ids: ['w4'] }],
    },
    // An empty cell has no children and must still hold its place.
    { BlockType: 'CELL', Id: 'c23', RowIndex: 2, ColumnIndex: 3 },
    {
      BlockType: 'TABLE',
      Id: 't',
      Relationships: [{ Type: 'CHILD', Ids: ['c11', 'c12', 'c21', 'c22', 'c23'] }],
    },
  ];

  test('lines in reading order, mean confidence', () => {
    const page = pageFromBlocks(blocks);
    expect(page.text).toBe('City Labs\nHbA1c 6.2 %');
    expect(page.confidence).toBe(94.5);
  });

  test('tables as rows of cells, with empty cells kept in place', () => {
    expect(pageFromBlocks(blocks).tables).toEqual([
      {
        rows: [
          ['Test', 'Result', ''],
          ['HbA1c', '6.2', ''],
        ],
      },
    ]);
  });

  test('no lines → no text, no confidence', () => {
    expect(pageFromBlocks([{ BlockType: 'PAGE', Id: 'p' }])).toEqual({
      text: '',
      tables: [],
      confidence: null,
    });
  });
});
