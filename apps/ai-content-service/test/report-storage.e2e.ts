/**
 * Report storage limits, end to end (Week 8, M-W8-2).
 *
 * Real ai-content-service, real S3 API. Locally that is LocalStack started with
 * signature validation ON — its default is to skip it, which would make every
 * "S3 refused it" check below pass for the wrong reason:
 *
 *   docker run -d --name w8s3 -p 4566:4566 -e SERVICES=s3 \
 *     -e S3_SKIP_SIGNATURE_VALIDATION=0 localstack/localstack:3
 *
 * The suite creates the documents bucket there if it is missing. It never
 * talks to real AWS: it refuses to run unless the upload link points at
 * localhost.
 *
 *   set -a; source .env; set +a
 *   bun run apps/ai-content-service/test/report-storage.e2e.ts
 */
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import postgres from 'postgres';

const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:3004';
const USER_PROVIDER = process.env.USER_PROVIDER_SERVICE_URL ?? 'http://localhost:3002';
const S3 = process.env.AWS_ENDPOINT_URL ?? 'http://localhost:4566';
const BUCKET = process.env.S3_DOCUMENTS_BUCKET ?? 'longeny-documents';

const JWT_SECRET = process.env.JWT_ACCESS_SECRET;
if (!JWT_SECRET) {
  console.error('JWT_ACCESS_SECRET missing — did you `source .env`?');
  process.exit(1);
}

const RUN = Date.now().toString(36);
const AUTH_ID = crypto.randomUUID();
const token = jwt.sign(
  {
    sub: AUTH_ID,
    email: `w8st-${RUN}@longeny.test`,
    role: 'user',
    roles: ['user'],
    permissions: ['profiles:read', 'profiles:write', 'documents:read', 'documents:write'],
    jti: crypto.randomUUID(),
  },
  JWT_SECRET,
  { expiresIn: '15m' },
);
const authHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean, detail?: unknown) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`);
  }
}
async function call(res: Response) {
  const text = await res.text();
  try {
    return { status: res.status, body: JSON.parse(text) as any };
  } catch {
    return { status: res.status, body: text as any };
  }
}

try {
  await fetch(`${S3}/_localstack/health`);
} catch {
  console.error(`No S3 at ${S3}. Start LocalStack with signature validation on (see header).`);
  process.exit(1);
}
// Idempotent: 200 if created, 409 if it exists — either way it is there.
await fetch(`${S3}/${BUCKET}`, { method: 'PUT' });

const core = postgres(process.env.CORE_DATABASE_URL as string);
const ai = postgres(process.env.AI_CONTENT_DATABASE_URL as string);
await core`
  INSERT INTO users (auth_id, email, first_name, last_name)
  VALUES (${AUTH_ID}::uuid, ${`w8st-${RUN}@longeny.test`}, 'W8', 'Storage')
  ON CONFLICT (auth_id) DO NOTHING
`;

const declare = async (overrides: Record<string, unknown>) =>
  call(
    await fetch(`${BASE}/documents/upload`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        title: `Panel ${RUN}`,
        fileName: 'panel.pdf',
        fileSize: 16,
        mimeType: 'application/pdf',
        documentType: 'lab_report',
        ...overrides,
      }),
    }),
  );

const docIds: string[] = [];

// ── 1. Refused before a link exists ──────────────────────────────────────────

console.log('\n1. Refused before any link is issued');

let r = await declare({ fileSize: 50 * 1024 * 1024 + 1 });
check('one byte over 50 MB → 400', r.status === 400, r);
r = await declare({ mimeType: 'text/html', fileName: 'report.html' });
check('an HTML page → 400', r.status === 400, r);
r = await declare({ mimeType: 'application/x-msdownload', fileName: 'report.exe' });
check('an executable → 400', r.status === 400, r);
r = await declare({ fileSize: 0 });
check('an empty file → 400', r.status === 400, r);
r = await declare({ fileSize: 1.5 });
check('a fractional size → 400', r.status === 400, r);
r = await declare({ title: '' });
check('no title → 400', r.status === 400, r);

const refusedRows = await ai`
  SELECT count(*)::int AS n FROM documents WHERE owner_id = ${AUTH_ID}::uuid
`;
check('and no document row was created for any of them', refusedRows[0]?.n === 0, refusedRows);

// ── 2. The link carries the limits ───────────────────────────────────────────

console.log('\n2. The upload link has the size and type signed into it');

const body = new TextEncoder().encode('%PDF-1.4 sixteen'); // exactly 16 bytes
r = await declare({ fileSize: body.byteLength });
check('a valid declaration → 201', r.status === 201, r);
const uploadUrl: string = r.body.data?.uploadUrl ?? '';
docIds.push(r.body.data?.documentId);

if (!uploadUrl.startsWith('http://localhost') && !uploadUrl.startsWith('http://127.0.0.1')) {
  console.error(
    `Upload link points at ${uploadUrl.split('?')[0]} — refusing to write to real AWS.`,
  );
  process.exit(1);
}

const signed = new URL(uploadUrl).searchParams.get('X-Amz-SignedHeaders') ?? '';
check('content-type is a signed header', signed.split(';').includes('content-type'), signed);
check('content-length is a signed header', signed.split(';').includes('content-length'), signed);

// ── 3. S3 itself enforces them ───────────────────────────────────────────────

console.log('\n3. S3 refuses an upload that differs from the declaration');

const put = async (bytes: Uint8Array, contentType: string) =>
  (await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': contentType }, body: bytes }))
    .status;

let status = await put(body, 'text/html');
check('same size, declared PDF, sent as text/html → refused', status === 403, status);

status = await put(new TextEncoder().encode('%PDF-1.4 sixteen plus more bytes'), 'application/pdf');
check('declared 16 bytes, sent more → refused', status >= 400, status);

status = await put(body, 'application/pdf');
check('exactly what was declared → accepted', status === 200, status);

// ── Teardown ─────────────────────────────────────────────────────────────────

if (docIds.length > 0) await ai`DELETE FROM document_access_log WHERE document_id IN ${ai(docIds)}`;
if (docIds.length > 0) await ai`DELETE FROM documents WHERE id IN ${ai(docIds)}`;
await core.end();
await ai.end();

console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed === 0 ? 0 : 1);
