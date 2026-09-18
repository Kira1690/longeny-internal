/**
 * Patient reports, end to end.
 *
 * Declare → upload to storage → confirm → read (text layer or OCR) → look at,
 * download, correct, remove — for one family's profiles, and every way another
 * account or a provider might try to reach them.
 *
 * Real services, real PostgreSQL, S3 on LocalStack with signature validation
 * on. OCR is the `fake` provider (REPORT_OCR_PROVIDER=fake, the local default):
 * real Textract is exercised once on the dev server, not here.
 *
 * Needs the gateway on :3000, user-provider :3002, booking :3003, ai-content
 * :3004 (with its report reader running) and LocalStack :4566.
 *
 *   set -a; source .env; set +a
 *   bun run apps/ai-content-service/test/reports.e2e.ts
 */
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import postgres from 'postgres';

const GATEWAY = `${process.env.GATEWAY_URL ?? 'http://localhost:3000'}/api/v1`;
const AI = process.env.TEST_BASE_URL ?? 'http://localhost:3004';
const USER_PROVIDER = process.env.USER_PROVIDER_SERVICE_URL ?? 'http://localhost:3002';
const BOOKING = process.env.BOOKING_SERVICE_URL ?? 'http://localhost:3003';
const S3 = process.env.AWS_ENDPOINT_URL ?? 'http://localhost:4566';
const BUCKET = process.env.S3_DOCUMENTS_BUCKET ?? 'longeny-documents';
/** Marker the fake OCR reads as "nothing legible" — see report-reader/ocr.ts. */
const UNREADABLE = 'LONGENY-TEST-UNREADABLE';

const JWT_SECRET = process.env.JWT_ACCESS_SECRET;
if (!JWT_SECRET) {
  console.error('JWT_ACCESS_SECRET missing — did you `source .env`?');
  process.exit(1);
}

const RUN = Date.now().toString(36);
const OWNER = crypto.randomUUID();
const OTHER = crypto.randomUUID();
const PROVIDER = crypto.randomUUID();
const UNBOOKED = crypto.randomUUID();

function token(sub: string, extra: Record<string, unknown> = {}) {
  return jwt.sign(
    {
      sub,
      email: `w8rep-${sub.slice(0, 8)}-${RUN}@longeny.test`,
      role: 'user',
      roles: ['user'],
      permissions: [
        'profiles:read',
        'profiles:write',
        'documents:read',
        'documents:write',
        'bookings:read',
        'bookings:write',
      ],
      jti: crypto.randomUUID(),
      ...extra,
    },
    JWT_SECRET as string,
    { expiresIn: '15m' },
  );
}
const json = { 'Content-Type': 'application/json' };
const H = {
  owner: { Authorization: `Bearer ${token(OWNER)}`, ...json },
  other: { Authorization: `Bearer ${token(OTHER)}`, ...json },
  readOnly: {
    Authorization: `Bearer ${token(OWNER, { permissions: ['profiles:read', 'documents:read'] })}`,
    ...json,
  },
  provider: {
    Authorization: `Bearer ${token(PROVIDER, {
      role: 'provider',
      roles: ['provider'],
      // Holding documents:write changes nothing: a provider does not write here.
      permissions: ['documents:read', 'documents:write', 'profiles:read', 'bookings:read'],
    })}`,
    ...json,
  },
  unbooked: {
    Authorization: `Bearer ${token(UNBOOKED, {
      role: 'provider',
      roles: ['provider'],
      permissions: ['documents:read', 'documents:write', 'profiles:read', 'bookings:read'],
    })}`,
    ...json,
  },
  none: json,
};
type Who = keyof typeof H;

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean, detail?: unknown) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    const shown = detail === undefined ? '' : ` — ${JSON.stringify(detail)?.slice(0, 600)}`;
    console.log(`  ✗ ${name}${shown}`);
  }
}

/**
 * Straight to the service by default. The gateway allows one address 100
 * requests a minute, and this suite makes more than that, so the sections that
 * prove routing and refusals go through the gateway (`via = GATEWAY`) and the
 * rest go direct. The service enforces every rule itself either way.
 */
let via = AI;
async function call(method: string, path: string, who: Who = 'owner', body?: unknown) {
  // Direct, a profile route that is not about reports belongs to user-provider;
  // the gateway makes that split itself.
  const direct = path.startsWith('/profiles') && !path.includes('/reports') ? USER_PROVIDER : AI;
  const base = via === GATEWAY ? GATEWAY : direct;
  const res = await fetch(`${base}${path}`, {
    method,
    headers: H[who],
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: any = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {}
  return { status: res.status, body: parsed };
}

// ── Fixture files ────────────────────────────────────────────────────────────

async function pdf(pages: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const text of pages) {
    const page = doc.addPage();
    if (text) page.drawText(text, { x: 40, y: 700, size: 11, font });
  }
  return doc.save();
}
const LAB = 'City Labs  HbA1c 6.2 %  (reference 4.0 - 5.6)  Fasting glucose 104 mg/dL';
const FILES = {
  textPdf: await pdf([LAB]),
  scannedPdf: await pdf(['', '']),
  mixedPdf: await pdf([LAB, '', LAB]),
  photo: new TextEncoder().encode('\x89PNG\r\n\x1a\n pretend photo of a lab report'),
  blurred: new TextEncoder().encode(`\x89PNG\r\n\x1a\n ${UNREADABLE}`),
  dicom: new TextEncoder().encode('DICM pretend chest x-ray'),
};

// ── Helpers ──────────────────────────────────────────────────────────────────

interface Declared {
  id: string;
  url: string;
  headers: Record<string, string>;
  status: number;
  body: any;
}

async function declare(
  profileId: string,
  bytes: Uint8Array,
  mimeType: string,
  extra: Record<string, unknown> = {},
  who: Who = 'owner',
): Promise<Declared> {
  const r = await call('POST', `/profiles/${profileId}/reports`, who, {
    title: `Report ${RUN}`,
    fileName: 'report.bin',
    fileSize: bytes.byteLength,
    mimeType,
    documentType: 'lab_report',
    ...extra,
  });
  return {
    id: r.body?.data?.report?.id,
    url: r.body?.data?.upload?.url,
    headers: r.body?.data?.upload?.headers,
    status: r.status,
    body: r.body,
  };
}

const put = async (d: Declared, bytes: Uint8Array, contentType = d.headers['Content-Type']) =>
  (
    await fetch(d.url, {
      method: 'PUT',
      headers: { 'Content-Type': contentType as string },
      body: bytes,
    })
  ).status;

async function waitFor(id: string, done: (s: string) => boolean, ms = 15_000) {
  const until = Date.now() + ms;
  let last: any;
  while (Date.now() < until) {
    last = (await call('GET', `/reports/${id}`)).body?.data;
    if (last && done(last.processing_status)) return last;
    await Bun.sleep(250);
  }
  return last;
}
const settled = (s: string) => s === 'read' || s === 'failed';

/** Declare, upload, confirm and wait until read. */
async function uploadAndRead(profileId: string, bytes: Uint8Array, mimeType: string, extra = {}) {
  const d = await declare(profileId, bytes, mimeType, extra);
  await put(d, bytes);
  await call('POST', `/reports/${d.id}/complete`);
  return { id: d.id, report: await waitFor(d.id, settled) };
}

// ── Preflight ────────────────────────────────────────────────────────────────

for (const [name, url] of [
  ['gateway', `${GATEWAY.replace('/api/v1', '')}/health/live`],
  ['ai-content', `${AI}/health`],
  ['user-provider', `${USER_PROVIDER}/health`],
  ['booking', `${BOOKING}/health`],
  ['S3', `${S3}/_localstack/health`],
] as const) {
  try {
    if (!(await fetch(url)).ok) throw new Error('not ok');
  } catch (err) {
    console.error(`${name} not reachable at ${url} — start it first.\n  ${err}`);
    process.exit(1);
  }
}
await fetch(`${S3}/${BUCKET}`, { method: 'PUT' }); // 200 or 409 — either way it exists

const core = postgres(process.env.CORE_DATABASE_URL as string);
const ai = postgres(process.env.AI_CONTENT_DATABASE_URL as string);
const bookingDb = postgres(process.env.BOOKING_DATABASE_URL as string);

for (const [id, label] of [
  [OWNER, 'owner'],
  [OTHER, 'other'],
] as const) {
  await core`
    INSERT INTO users (auth_id, email, first_name, last_name)
    VALUES (${id}::uuid, ${`w8rep-${label}-${RUN}@longeny.test`}, 'W8', ${label})
    ON CONFLICT (auth_id) DO NOTHING
  `;
}

let r = await call('POST', '/profiles', 'owner', { relation: 'father', firstName: `Dad-${RUN}` });
const dad: string = r.body?.data?.id;
check('fixture: the owner adds their father', r.status === 201 && Boolean(dad), r);
r = await call('GET', '/profiles');
const self: string = r.body?.data?.find((p: any) => p.is_self)?.id;
r = await call('GET', '/profiles', 'other');
const otherSelf: string = r.body?.data?.find((p: any) => p.is_self)?.id;
check('fixture: both accounts have their own profile', Boolean(self && otherSelf));

const setStage = (profileId: string, stage: string) => core`
  INSERT INTO rro_state (profile_id, current_state) VALUES (${profileId}::uuid, ${stage}::rro_state_value)
  ON CONFLICT (profile_id) DO UPDATE SET current_state = EXCLUDED.current_state
`;
await setStage(dad, 'restore');

const reportIds: string[] = [];
let bookingId = '';

try {
  // ── 1. Declaring ───────────────────────────────────────────────────────────

  console.log('\n1. Declaring an upload — what is refused before any link exists');

  const base = {
    title: 'Panel',
    fileName: 'panel.pdf',
    fileSize: 1000,
    mimeType: 'application/pdf',
    documentType: 'lab_report',
  };
  const refused = async (label: string, body: unknown, who: Who = 'owner', expect = 400) => {
    const res = await call('POST', `/profiles/${dad}/reports`, who, body);
    check(`${label} → ${expect}`, res.status === expect, res);
  };
  await refused('WebP (OCR cannot read it)', { ...base, mimeType: 'image/webp' });
  await refused('HEIC (convert to JPEG first)', { ...base, mimeType: 'image/heic' });
  await refused('HTML', { ...base, mimeType: 'text/html' });
  await refused('one byte over 50 MB', { ...base, fileSize: 50 * 1024 * 1024 + 1 });
  await refused('an empty file', { ...base, fileSize: 0 });
  await refused('a file name with a path', { ...base, fileName: '../../etc/passwd' });
  await refused('a report dated next week', {
    ...base,
    reportedAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
  });
  await refused('no document type', { ...base, documentType: undefined });
  await refused('an unknown field (profileId in the body)', { ...base, profileId: otherSelf });
  await refused('no token', base, 'none', 401);
  await refused('a token without documents:write', base, 'readOnly', 403);
  await refused('another account declaring on this father', base, 'other', 404);
  await refused('a provider declaring on a patient', base, 'provider', 404);

  const [{ n: stray }] = await ai`
    SELECT count(*)::int AS n FROM documents WHERE profile_id = ${dad}::uuid
  `;
  check('none of those created a report', stray === 0, stray);

  // ── 2. The whole path, for a PDF with its own text ─────────────────────────

  console.log('\n2. Declare → upload → confirm → read (a PDF with text), through the gateway');
  via = GATEWAY;

  const text = await declare(dad, FILES.textPdf, 'application/pdf', {
    title: `HbA1c ${RUN}`,
    reportedAt: '2026-06-01',
  });
  reportIds.push(text.id);
  check(
    '201 with a report and an upload link',
    text.status === 201 && Boolean(text.url),
    text.body,
  );
  const t0 = text.body?.data?.report;
  check('the report starts awaiting upload', t0?.processing_status === 'awaiting_upload', t0);
  check('the father’s care stage is recorded on it', t0?.rro_state_at_upload === 'restore', t0);
  check('it belongs to the father', t0?.profile_id === dad, t0);
  check('no storage key in the response', !JSON.stringify(text.body).includes('file_key'));
  check(
    'upload headers name the exact size and type',
    text.headers?.['Content-Type'] === 'application/pdf' &&
      text.headers?.['Content-Length'] === String(FILES.textPdf.byteLength),
    text.headers,
  );
  check('the link lasts 10 minutes', text.body?.data?.upload?.expires_in === 600);
  if (!text.url?.startsWith('http://localhost')) {
    console.error('Upload link does not point at LocalStack — refusing to write to real AWS.');
    process.exit(1);
  }
  const [row] = await ai`SELECT file_key, owner_id FROM documents WHERE id = ${text.id}::uuid`;
  check(
    'the storage key is ids only: reports/{profile}/{report}',
    row?.file_key === `reports/${dad}/${text.id}`,
    row,
  );

  r = await call('POST', `/reports/${text.id}/complete`);
  check(
    'confirming before uploading → 409 UPLOAD_MISSING',
    r.status === 409 && r.body?.error?.code === 'UPLOAD_MISSING',
    r,
  );

  check(
    'storage refuses the right size sent as the wrong type',
    (await put(text, FILES.textPdf, 'text/html')) === 403,
  );
  check('storage accepts exactly what was declared', (await put(text, FILES.textPdf)) === 200);

  r = await call('POST', `/reports/${text.id}/complete`);
  check(
    'confirm → 200, queued to be read',
    r.status === 200 && ['uploaded', 'reading', 'read'].includes(r.body?.data?.processing_status),
    r,
  );
  r = await call('POST', `/reports/${text.id}/complete`);
  check('confirming twice → 409', r.status === 409, r);

  const readText = await waitFor(text.id, settled);
  check('the reader finishes: read', readText?.processing_status === 'read', readText);
  check('read from the PDF’s own text — no OCR', readText?.read_method === 'text_layer', readText);
  check('page count recorded', readText?.page_count === 1, readText);

  r = await call('GET', `/reports/${text.id}/text`);
  check('text → 200', r.status === 200, r);
  check(
    'page 1 was read from the text layer',
    r.body?.data?.pages?.[0]?.method === 'text_layer',
    r.body?.data,
  );
  check(
    'the lab values are in the text',
    r.body?.data?.pages?.[0]?.text?.includes('HbA1c 6.2'),
    r.body?.data,
  );
  check('marked machine-read, not verified', r.body?.meta?.machine_read === true, r.body?.meta);

  // ── 3. The care stage is a snapshot ────────────────────────────────────────

  via = AI;
  console.log('\n3. The care stage on a report is the stage at upload, and stays');

  await setStage(dad, 'optimise');
  r = await call('GET', `/reports/${text.id}`);
  check(
    'moving the father to optimise does not rewrite the old report',
    r.body?.data?.rro_state_at_upload === 'restore',
    r.body?.data,
  );
  const later = await declare(dad, FILES.textPdf, 'application/pdf', {
    title: `Later ${RUN}`,
    reportedAt: '2026-08-01',
  });
  reportIds.push(later.id);
  check(
    'a new report records the new stage',
    later.body?.data?.report?.rro_state_at_upload === 'optimise',
    later.body,
  );
  await put(later, FILES.textPdf);
  await call('POST', `/reports/${later.id}/complete`);

  // ── 4. OCR only where it is needed ─────────────────────────────────────────

  console.log('\n4. Scans, photos and screenshots are read by OCR — and only they are');

  const scanned = await uploadAndRead(dad, FILES.scannedPdf, 'application/pdf', {
    title: `Scan ${RUN}`,
    reportedAt: '2026-03-01',
  });
  reportIds.push(scanned.id);
  check(
    'a scanned PDF → read by OCR',
    scanned.report?.processing_status === 'read' && scanned.report?.read_method === 'ocr',
    scanned.report,
  );

  const mixed = await uploadAndRead(dad, FILES.mixedPdf, 'application/pdf', {
    title: `Mixed ${RUN}`,
  });
  reportIds.push(mixed.id);
  check('text pages plus one scan → mixed', mixed.report?.read_method === 'mixed', mixed.report);
  r = await call('GET', `/reports/${mixed.id}/text`);
  check(
    'only the scanned page went to OCR',
    JSON.stringify(r.body?.data?.pages?.map((p: any) => p.method)) ===
      '["text_layer","ocr","text_layer"]',
    r.body?.data?.pages?.map((p: any) => p.method),
  );
  check(
    'an OCR page carries its confidence',
    r.body?.data?.pages?.[1]?.ocr_confidence === 99,
    r.body?.data?.pages?.[1],
  );
  check('a text page has none', r.body?.data?.pages?.[0]?.ocr_confidence === null);

  const photo = await uploadAndRead(dad, FILES.photo, 'image/png', { title: `Photo ${RUN}` });
  reportIds.push(photo.id);
  check('a phone photo → read by OCR', photo.report?.read_method === 'ocr', photo.report);
  r = await call('GET', `/reports/${photo.id}/text?page=1`);
  check(
    'tables come back as rows of cells',
    JSON.stringify(r.body?.data?.pages?.[0]?.tables?.[0]?.rows?.[1]) === '["HbA1c","6.2","%"]',
    r.body?.data?.pages?.[0],
  );

  const blurred = await uploadAndRead(dad, FILES.blurred, 'image/png', { title: `Blurred ${RUN}` });
  reportIds.push(blurred.id);
  check('a blurred photo → failed', blurred.report?.processing_status === 'failed', blurred.report);
  check(
    'with a reason the person can act on',
    /retake/.test(blurred.report?.processing_error ?? ''),
    blurred.report,
  );
  r = await call('GET', `/reports/${blurred.id}/text`);
  check(
    'its text answers 200 with no pages, so an app can poll',
    r.status === 200 && r.body?.data?.pages?.length === 0,
    r.body,
  );

  const dicom = await declare(dad, FILES.dicom, 'application/dicom', {
    title: `X-ray ${RUN}`,
    documentType: 'imaging',
  });
  reportIds.push(dicom.id);
  await put(dicom, FILES.dicom);
  r = await call('POST', `/reports/${dicom.id}/complete`);
  check(
    'DICOM is stored, never read: not_applicable',
    r.body?.data?.processing_status === 'not_applicable',
    r,
  );

  // ── 5. Retry ───────────────────────────────────────────────────────────────

  console.log('\n5. Retrying a failed read — limited, because OCR costs money');

  r = await call('POST', `/reports/${text.id}/ocr/retry`);
  check('a report that read fine cannot be retried → 409', r.status === 409, r);
  for (let i = 1; i <= 3; i++) {
    r = await call('POST', `/reports/${blurred.id}/ocr/retry`);
    check(
      `retry ${i} → 202`,
      r.status === 202 && r.body?.data?.processing_status === 'uploaded',
      r,
    );
    const again = await waitFor(blurred.id, settled);
    check(
      `retry ${i} is read again (still failed — same blurred photo)`,
      again?.processing_status === 'failed',
      again,
    );
  }
  r = await call('POST', `/reports/${blurred.id}/ocr/retry`);
  check('a fourth retry within the hour → 429', r.status === 429, r);

  // ── 6. The timeline ────────────────────────────────────────────────────────

  console.log('\n6. The father’s timeline');

  const abandoned = await declare(dad, FILES.textPdf, 'application/pdf', {
    title: `Abandoned ${RUN}`,
  });
  reportIds.push(abandoned.id);
  const pending = await declare(dad, FILES.textPdf, 'application/pdf', { title: `Pending ${RUN}` });
  reportIds.push(pending.id);
  await ai`UPDATE documents SET created_at = now() - interval '25 hours' WHERE id = ${abandoned.id}::uuid`;

  r = await call('GET', `/profiles/${dad}/reports?limit=100`);
  const titles: string[] = (r.body?.data ?? []).map((d: any) => d.title);
  check('200', r.status === 200, r);
  check(
    'an upload declared a day ago and never sent is hidden',
    !titles.includes(`Abandoned ${RUN}`),
    titles,
  );
  check('one declared just now is shown', titles.includes(`Pending ${RUN}`), titles);
  check(
    'newest test first: August before June before March',
    titles.indexOf(`Later ${RUN}`) < titles.indexOf(`HbA1c ${RUN}`) &&
      titles.indexOf(`HbA1c ${RUN}`) < titles.indexOf(`Scan ${RUN}`),
    titles,
  );
  check(
    'each carries its stage and read status',
    (r.body?.data ?? []).every((d: any) => 'rro_state_at_upload' in d && 'processing_status' in d),
    r.body?.data?.[0],
  );
  check('total in meta', r.body?.meta?.total === titles.length, r.body?.meta);

  r = await call('GET', `/profiles/${dad}/reports?status=failed`);
  check(
    'filter by status',
    r.body?.data?.length === 1 && r.body?.data?.[0]?.id === blurred.id,
    r.body?.data,
  );
  r = await call('GET', `/profiles/${dad}/reports?documentType=imaging`);
  check(
    'filter by type',
    r.body?.data?.length === 1 && r.body?.data?.[0]?.id === dicom.id,
    r.body?.data,
  );
  r = await call('GET', `/profiles/${dad}/reports?from=2026-05-01&to=2026-06-30`);
  check(
    'filter by test date',
    r.body?.data?.length === 1 && r.body?.data?.[0]?.id === text.id,
    r.body?.data?.map((d: any) => d.title),
  );
  r = await call('GET', `/profiles/${dad}/reports?status=bogus`);
  check('an unknown status → 400', r.status === 400, r);
  r = await call('GET', `/profiles/${dad}/reports?from=2026-07-01&to=2026-06-01`);
  check('from after to → 400', r.status === 400, r);

  r = await call('GET', `/profiles/${self}/reports`);
  check(
    'the owner’s own timeline holds none of the father’s reports',
    r.status === 200 && r.body?.data?.length === 0,
    r.body?.data,
  );

  // ── 7. Another account ─────────────────────────────────────────────────────

  console.log('\n7. Another account reaches nothing — and learns nothing (through the gateway)');
  via = GATEWAY;

  const strangerProbe: [string, string, unknown?][] = [
    ['GET', `/reports/${text.id}`],
    ['GET', `/reports/${text.id}/text`],
    ['GET', `/reports/${text.id}/download`],
    ['GET', `/reports/${text.id}/access-log`],
    ['PATCH', `/reports/${text.id}`, { title: 'mine now' }],
    ['DELETE', `/reports/${text.id}`],
    ['POST', `/reports/${pending.id}/complete`],
    ['POST', `/reports/${blurred.id}/ocr/retry`],
    ['GET', `/profiles/${dad}/reports`],
  ];
  for (const [method, path, body] of strangerProbe) {
    r = await call(method, path, 'other', body);
    check(`${method} ${path.replace(RUN, '…')} → 404`, r.status === 404, r);
  }
  const nobody = crypto.randomUUID();
  r = await call('GET', `/reports/${nobody}`, 'other');
  const r2 = await call('GET', `/reports/${text.id}`, 'other');
  check(
    'a real report and a made-up id answer identically',
    r.status === r2.status &&
      r.body?.error?.code === r2.body?.error?.code &&
      r.body?.error?.message === r2.body?.error?.message,
    [r.body?.error, r2.body?.error],
  );
  r = await call('GET', '/reports/not-a-uuid');
  check('a malformed id → 400', r.status === 400, r);
  r = await call('GET', `/reports/${text.id}`);
  check('the stranger changed nothing', r.body?.data?.title === `HbA1c ${RUN}`, r.body?.data);

  // ── 8. Providers ───────────────────────────────────────────────────────────

  via = AI;
  console.log('\n8. A provider reads through an active booking, and never writes');

  r = await call('GET', `/reports/${text.id}`, 'provider');
  check('before a booking: 404, like a stranger', r.status === 404, r);

  const booked = await fetch(`${BOOKING}/bookings`, {
    method: 'POST',
    headers: { ...H.owner, 'X-Active-Profile-Id': dad },
    body: JSON.stringify({
      providerId: PROVIDER,
      sessionType: 'consultation',
      startTime: new Date(Date.now() + 86_400_000).toISOString(),
      endTime: new Date(Date.now() + 90_000_000).toISOString(),
      timezone: 'Asia/Kolkata',
    }),
  });
  const bookedBody: any = await booked.json();
  bookingId = bookedBody?.data?.id ?? '';
  check('fixture: the family books the provider for the father', booked.status === 201, bookedBody);

  r = await call('GET', `/reports/${text.id}`, 'provider');
  check('booked provider: details → 200', r.status === 200, r);
  r = await call('GET', `/reports/${text.id}/text`, 'provider');
  check('booked provider: text → 200', r.status === 200 && r.body?.data?.pages?.length === 1, r);
  r = await call('GET', `/reports/${text.id}/download`, 'provider');
  check('booked provider: download → 200', r.status === 200, r);
  r = await call('GET', `/profiles/${dad}/reports`, 'provider');
  check('booked provider: timeline → 200', r.status === 200, r);
  for (const [method, path, body] of [
    ['PATCH', `/reports/${text.id}`, { title: 'edited by provider' }],
    ['DELETE', `/reports/${text.id}`],
    ['POST', `/reports/${pending.id}/complete`],
    ['POST', `/reports/${blurred.id}/ocr/retry`],
    ['GET', `/reports/${text.id}/access-log`],
  ] as [string, string, unknown?][]) {
    r = await call(method, path, 'provider', body);
    check(
      `booked provider: ${method} ${path.split('/').slice(3).join('/') || 'report'} → 404`,
      r.status === 404,
      r,
    );
  }
  r = await call('GET', `/reports/${text.id}`, 'unbooked');
  check('a provider with no booking → 404', r.status === 404, r);
  r = await call('GET', `/profiles/${self}/reports`, 'provider');
  check('the booking is for the father only — not the rest of the family', r.status === 404, r);

  // ── 9. Correcting ──────────────────────────────────────────────────────────

  console.log('\n9. The owner corrects title, date and type');

  r = await call('PATCH', `/reports/${later.id}`, 'owner', {
    title: `Lipids ${RUN}`,
    reportedAt: '2026-08-15',
    documentType: 'lab_report',
  });
  check(
    '200 with the new values',
    r.status === 200 &&
      r.body?.data?.title === `Lipids ${RUN}` &&
      r.body?.data?.reported_at?.startsWith('2026-08-15'),
    r,
  );
  check(
    'the care stage recorded at upload is untouched',
    r.body?.data?.rro_state_at_upload === 'optimise',
    r.body?.data,
  );
  r = await call('PATCH', `/reports/${later.id}`, 'owner', {});
  check('an empty change → 400', r.status === 400, r);
  r = await call('PATCH', `/reports/${later.id}`, 'owner', { profileId: self });
  check('moving a report to another person → 400 (not a field)', r.status === 400, r);
  r = await call('PATCH', `/reports/${later.id}`, 'owner', { rroStateAtUpload: 'intake' });
  check('rewriting the recorded stage → 400', r.status === 400, r);
  r = await call('PATCH', `/reports/${later.id}`, 'owner', { reportedAt: null });
  check('clearing the date is allowed', r.status === 200 && r.body?.data?.reported_at === null, r);

  // ── 10. Download ───────────────────────────────────────────────────────────

  console.log('\n10. Download');

  r = await call('GET', `/reports/${text.id}/download`);
  check('owner → 200, a 5-minute link', r.status === 200 && r.body?.data?.expires_in === 300, r);
  const file = await fetch(r.body?.data?.url);
  const got = new Uint8Array(await file.arrayBuffer());
  check(
    'the link returns the exact file',
    file.status === 200 && got.byteLength === FILES.textPdf.byteLength,
    file.status,
  );
  check(
    'as a download, not rendered in the browser',
    (file.headers.get('content-disposition') ?? '').startsWith('attachment'),
    file.headers.get('content-disposition'),
  );
  r = await call('GET', `/reports/${pending.id}/download`);
  check('nothing uploaded yet → 409', r.status === 409, r);

  // ── 11. The audit trail ────────────────────────────────────────────────────

  console.log('\n11. Every look is recorded against the right person');

  const audit = await ai`
    SELECT action, actor_id, profile_id, resource_id, success
      FROM phi_access_log
     WHERE resource_type = 'report' AND resource_id = ${text.id}
  `;
  check('rows exist for this report', audit.length > 0, audit.length);
  check(
    'every row names the father as the subject — never the report id',
    audit.every((a: any) => a.profile_id === dad),
    audit.filter((a: any) => a.profile_id !== dad),
  );
  const downloads = audit.filter((a: any) => a.action === 'reports.download' && a.success);
  check(
    'one row per download (owner + provider = 2), none doubled',
    downloads.length === 2,
    downloads,
  );
  check(
    'the provider’s download is theirs',
    downloads.some((a: any) => a.actor_id === PROVIDER),
  );
  check(
    'the stranger’s refusals are recorded as refusals',
    audit.some((a: any) => a.actor_id === OTHER && a.success === false),
    audit.filter((a: any) => a.actor_id === OTHER),
  );

  r = await call('GET', `/reports/${text.id}/access-log`);
  const entries: any[] = r.body?.data ?? [];
  check('owner’s access log → 200', r.status === 200, r);
  check(
    'it shows the provider’s look',
    entries.some((e) => e.actor_type === 'provider' && e.action === 'reports.download'),
    entries,
  );
  check(
    'and the owner’s own, marked as theirs',
    entries.some((e) => e.is_you && e.action === 'reports.view'),
    entries,
  );
  check(
    'refused attempts are not shown to the owner',
    entries.length === r.body?.meta?.total && !JSON.stringify(entries).includes(OTHER),
    entries,
  );
  check(
    'no addresses or browsers',
    !('ip' in (entries[0] ?? {})) && !('user_agent' in (entries[0] ?? {})),
    entries[0],
  );

  // ── 12. Removing ───────────────────────────────────────────────────────────

  console.log('\n12. Removing a report');

  r = await call('DELETE', `/reports/${text.id}`);
  check('204', r.status === 204, r);
  r = await call('GET', `/reports/${text.id}`);
  check('gone for the owner', r.status === 404, r);
  r = await call('GET', `/reports/${text.id}`, 'provider');
  check('gone for the provider', r.status === 404, r);
  r = await call('GET', `/reports/${text.id}/text`);
  check('its text is gone too', r.status === 404, r);
  r = await call('GET', `/profiles/${dad}/reports?limit=100`);
  check('and it left the timeline', !(r.body?.data ?? []).some((d: any) => d.id === text.id));
  r = await call('GET', `/reports/${text.id}/access-log`);
  check(
    'the owner can still see who looked at it',
    r.status === 200 && r.body?.data?.length > 0,
    r,
  );
  const [{ n: kept }] =
    await ai`SELECT count(*)::int AS n FROM report_pages WHERE document_id = ${text.id}::uuid`;
  check('its text is kept for the audit record', kept === 1, kept);
  r = await call('DELETE', `/reports/${text.id}`);
  check('removing it again → 404', r.status === 404, r);

  // ── 13. Only through the gateway ───────────────────────────────────────────

  console.log('\n13. The removed routes are gone from the gateway');
  via = GATEWAY;

  for (const path of [
    `/profiles/${dad}/benchmarks`,
    `/profiles/${dad}/scores`,
    '/reference-ranges',
  ]) {
    r = await call('GET', path);
    check(`GET ${path.replace(dad, ':id')} → 404`, r.status === 404, r.status);
  }
} finally {
  // ── Teardown ──
  if (reportIds.length > 0) {
    await ai`DELETE FROM report_pages WHERE document_id IN ${ai(reportIds.filter(Boolean))}`;
    await ai`DELETE FROM documents WHERE id IN ${ai(reportIds.filter(Boolean))}`;
  }
  if (bookingId) await bookingDb`DELETE FROM bookings WHERE id = ${bookingId}::uuid`;
  if (dad) await fetch(`${USER_PROVIDER}/profiles/${dad}`, { method: 'DELETE', headers: H.owner });
  await core.end();
  await ai.end();
  await bookingDb.end();
}

console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed === 0 ? 0 : 1);
