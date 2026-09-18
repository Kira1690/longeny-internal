import {
  AnalyzeDocumentCommand,
  type Block,
  TextractClient,
  type TextractServiceException,
} from '@aws-sdk/client-textract';
import { createLogger } from '@longeny/utils';
import { explicitAwsCredentials } from '../../config/aws.js';
import { config } from '../../config/index.js';

const logger = createLogger('report-reader:ocr');

/** Textract's limit for a document sent in the request itself. */
export const OCR_MAX_BYTES = 10 * 1024 * 1024;

export interface OcrTable {
  rows: string[][];
}

export interface OcrPage {
  /** Lines in reading order, joined by newlines. Empty when nothing was found. */
  text: string;
  tables: OcrTable[];
  /** Mean line confidence, 0–100; null when there were no lines. */
  confidence: number | null;
}

/**
 * The input itself cannot be read — the fault is the file, not the service —
 * so retrying will not help. `reason` is safe to show the person.
 */
export class OcrInputError extends Error {
  constructor(
    readonly reason: string,
    cause?: unknown,
  ) {
    super(reason, { cause });
    this.name = 'OcrInputError';
  }
}

/** Reads one page: an image, or a single-page PDF. */
export interface OcrProvider {
  readonly name: 'textract' | 'fake' | 'disabled';
  readPage(bytes: Uint8Array): Promise<OcrPage>;
}

// ── Textract ────────────────────────────────────────────────────────────────

const THROTTLED = new Set([
  'ThrottlingException',
  'ProvisionedThroughputExceededException',
  'LimitExceededException',
]);
const BAD_INPUT: Record<string, string> = {
  BadDocumentException: 'file could not be opened',
  UnsupportedDocumentException: 'file type could not be read',
  DocumentTooLargeException: 'page is too large to read (over 10 MB)',
  InvalidParameterException: 'file could not be opened',
};

/** Lines in the order Textract returns them, which is reading order. */
function linesOf(blocks: Block[]): Block[] {
  return blocks.filter((b) => b.BlockType === 'LINE' && b.Text);
}

/** Each TABLE block as rows of cell text. Merged cells repeat their text. */
function tablesOf(blocks: Block[]): OcrTable[] {
  const byId = new Map(blocks.map((b) => [b.Id, b]));
  const childIds = (b: Block) =>
    (b.Relationships ?? []).filter((r) => r.Type === 'CHILD').flatMap((r) => r.Ids ?? []);

  return blocks
    .filter((b) => b.BlockType === 'TABLE')
    .map((table) => {
      const cells = childIds(table)
        .map((id) => byId.get(id))
        .filter((c): c is Block => c?.BlockType === 'CELL');
      const rowCount = Math.max(0, ...cells.map((c) => c.RowIndex ?? 0));
      const colCount = Math.max(0, ...cells.map((c) => c.ColumnIndex ?? 0));
      const rows = Array.from({ length: rowCount }, () => Array<string>(colCount).fill(''));
      for (const cell of cells) {
        const text = childIds(cell)
          .map((id) => byId.get(id))
          .filter((w): w is Block => w?.BlockType === 'WORD' && Boolean(w.Text))
          .map((w) => w.Text)
          .join(' ');
        const row = rows[(cell.RowIndex ?? 1) - 1];
        if (row) row[(cell.ColumnIndex ?? 1) - 1] = text;
      }
      return { rows };
    })
    .filter((t) => t.rows.length > 0);
}

export function pageFromBlocks(blocks: Block[]): OcrPage {
  const lines = linesOf(blocks);
  const confidences = lines.map((l) => l.Confidence ?? 0);
  return {
    text: lines.map((l) => l.Text).join('\n'),
    tables: tablesOf(blocks),
    confidence:
      confidences.length === 0
        ? null
        : Math.round((confidences.reduce((a, b) => a + b, 0) / confidences.length) * 100) / 100,
  };
}

class TextractOcr implements OcrProvider {
  readonly name = 'textract' as const;
  private readonly client = new TextractClient({
    region: config.TEXTRACT_REGION,
    ...explicitAwsCredentials(),
  });

  async readPage(bytes: Uint8Array): Promise<OcrPage> {
    if (bytes.byteLength > OCR_MAX_BYTES) {
      throw new OcrInputError('page is too large to read (over 10 MB)');
    }

    // Throttling is the service being busy, not the file being bad: wait and
    // try again, and do not count it against the report.
    for (let attempt = 0; ; attempt++) {
      try {
        const result = await this.client.send(
          new AnalyzeDocumentCommand({ Document: { Bytes: bytes }, FeatureTypes: ['TABLES'] }),
        );
        return pageFromBlocks(result.Blocks ?? []);
      } catch (error) {
        const name = (error as TextractServiceException).name;
        if (BAD_INPUT[name]) throw new OcrInputError(BAD_INPUT[name], error);
        if (THROTTLED.has(name) && attempt < 4) {
          const waitMs = 500 * 2 ** attempt;
          logger.warn({ attempt, waitMs }, 'OCR throttled, backing off');
          await Bun.sleep(waitMs);
          continue;
        }
        throw error;
      }
    }
  }
}

// ── Fake, for tests ─────────────────────────────────────────────────────────

/** A test file carrying this marker reads as a photo with nothing legible on it. */
export const FAKE_UNREADABLE_MARKER = 'LONGENY-TEST-UNREADABLE';

/**
 * Fixed answers so the pipeline can be tested without AWS. Selected by
 * configuration only, and the service refuses to boot with it when deployed.
 */
class FakeOcr implements OcrProvider {
  readonly name = 'fake' as const;

  async readPage(bytes: Uint8Array): Promise<OcrPage> {
    if (bytes.byteLength > OCR_MAX_BYTES) {
      throw new OcrInputError('page is too large to read (over 10 MB)');
    }
    const asText = new TextDecoder('latin1').decode(bytes);
    if (asText.includes(FAKE_UNREADABLE_MARKER)) {
      return { text: '', tables: [], confidence: null };
    }
    return {
      text: 'FAKE OCR\nHbA1c 6.2 %\nFasting glucose 104 mg/dL',
      tables: [
        {
          rows: [
            ['Test', 'Result', 'Unit'],
            ['HbA1c', '6.2', '%'],
          ],
        },
      ],
      confidence: 99,
    };
  }
}

// ── Disabled ────────────────────────────────────────────────────────────────

class DisabledOcr implements OcrProvider {
  readonly name = 'disabled' as const;

  async readPage(): Promise<OcrPage> {
    throw new OcrInputError('scanned pages cannot be read here yet');
  }
}

export function createOcrProvider(
  kind: 'textract' | 'fake' | 'disabled' = config.REPORT_OCR_PROVIDER,
): OcrProvider {
  if (kind === 'textract') return new TextractOcr();
  if (kind === 'fake') return new FakeOcr();
  return new DisabledOcr();
}
