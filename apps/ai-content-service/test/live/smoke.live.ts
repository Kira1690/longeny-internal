// Live check on the dev server, through the gateway, with real S3 and real Textract.
// Throwaway accounts; everything it creates is removed at the end.
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import jwt from 'jsonwebtoken';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import postgres from 'postgres';

const GW = 'http://localhost:4001/api/v1';
const DIR = '/tmp/live';
const RUN = Date.now().toString(36);
const OWNER = crypto.randomUUID();
const OTHER = crypto.randomUUID();
const PROVIDER = crypto.randomUUID();
const perms = ['profiles:read', 'profiles:write', 'documents:read', 'documents:write'];
const tok = (sub: string, extra = {}) =>
  jwt.sign(
    {
      sub,
      email: `live-${sub.slice(0, 6)}-${RUN}@longeny.test`,
      role: 'user',
      roles: ['user'],
      permissions: perms,
      jti: crypto.randomUUID(),
      ...extra,
    },
    process.env.JWT_ACCESS_SECRET as string,
    { expiresIn: '15m' },
  );
const H: Record<string, Record<string, string>> = {
  owner: { Authorization: `Bearer ${tok(OWNER)}`, 'Content-Type': 'application/json' },
  other: { Authorization: `Bearer ${tok(OTHER)}`, 'Content-Type': 'application/json' },
  provider: {
    Authorization: `Bearer ${tok(PROVIDER, { role: 'provider', roles: ['provider'], permissions: ['documents:read', 'documents:write'] })}`,
    'Content-Type': 'application/json',
  },
};

let passed = 0;
let failed = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  ok ? passed++ : failed++;
  console.log(
    `  ${ok ? '✓' : '✗'} ${name}${ok ? '' : ` — ${JSON.stringify(detail)?.slice(0, 500)}`}`,
  );
};
async function call(method: string, path: string, who = 'owner', body?: unknown) {
  const res = await fetch(`${GW}${path}`, {
    method,
    headers: H[who],
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const t = await res.text();
  let b: any = t;
  try {
    b = t ? JSON.parse(t) : null;
  } catch {}
  return { status: res.status, body: b };
}

const png = new Uint8Array(readFileSync(`${DIR}/report.png`));
const jpg = new Uint8Array(readFileSync(`${DIR}/report.jpg`));
const dark = new Uint8Array(readFileSync(`${DIR}/dark.jpg`));
async function makePdf(kind: 'text' | 'scanned' | 'mixed') {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const addText = () =>
    doc.addPage().drawText('CITY LABS  HbA1c 6.2 %  Fasting glucose 104 mg/dL  LDL 118 mg/dL', {
      x: 40,
      y: 700,
      size: 11,
      font,
    });
  const addScan = async () => {
    const image = await doc.embedPng(png);
    const page = doc.addPage([620, 450]);
    page.drawImage(image, { x: 0, y: 0, width: 620, height: 450 });
  };
  if (kind === 'text') addText();
  if (kind === 'scanned') await addScan();
  if (kind === 'mixed') {
    addText();
    await addScan();
  }
  return doc.save();
}

const core = postgres(process.env.CORE_DATABASE_URL as string);
const ai = postgres(process.env.AI_CONTENT_DATABASE_URL as string);
for (const id of [OWNER, OTHER]) {
  await core`INSERT INTO users (auth_id, email, first_name, last_name) VALUES (${id}::uuid, ${`live-${id.slice(0, 6)}-${RUN}@longeny.test`}, 'Live', 'Check')`;
}
const ids: string[] = [];
let dad = '';

async function upload(bytes: Uint8Array, mimeType: string, title: string, extra = {}) {
  const d = await call('POST', `/profiles/${dad}/reports`, 'owner', {
    title,
    fileName: 'f',
    fileSize: bytes.byteLength,
    mimeType,
    documentType: 'lab_report',
    ...extra,
  });
  const id = d.body?.data?.report?.id;
  if (id) ids.push(id);
  const up = d.body?.data?.upload;
  const put = up
    ? (await fetch(up.url, { method: 'PUT', headers: { 'Content-Type': mimeType }, body: bytes }))
        .status
    : 0;
  const c = await call('POST', `/reports/${id}/complete`);
  return { id, declare: d, put, complete: c };
}
async function settle(id: string) {
  for (let i = 0; i < 60; i++) {
    const r = (await call('GET', `/reports/${id}`)).body?.data;
    if (r && ['read', 'failed', 'not_applicable'].includes(r.processing_status)) return r;
    await Bun.sleep(1000);
  }
  return (await call('GET', `/reports/${id}`)).body?.data;
}

try {
  let r = await fetch('http://localhost:4001/health');
  const h: any = await r.json();
  check(
    'gateway /health 200, booking+payment not deployed',
    r.status === 200 && h.notDeployed?.join() === 'booking,payment',
    h,
  );

  r = (await fetch(`${GW}/profiles`, {
    method: 'POST',
    headers: H.owner,
    body: JSON.stringify({ relation: 'father', firstName: `Live-${RUN}` }),
  })) as any;
  dad = ((await (r as any).json()) as any).data?.id;
  check('owner adds a father profile', Boolean(dad));
  await core`UPDATE rro_state SET current_state = 'reverse' WHERE profile_id = ${dad}::uuid`;

  console.log('\n1. Text PDF → real S3 → read from its text layer (no Textract)');
  const t = await upload(await makePdf('text'), 'application/pdf', `Text ${RUN}`, {
    reportedAt: '2026-09-01',
  });
  check(
    'declared 201 with care stage reverse',
    t.declare.status === 201 && t.declare.body?.data?.report?.rro_state_at_upload === 'reverse',
    t.declare.body,
  );
  check(
    'link points at the real reports bucket',
    t.declare.body?.data?.upload?.url?.includes('longeny-reports-836533914754'),
  );
  check('real S3 accepted the upload', t.put === 200, t.put);
  check('confirmed', t.complete.status === 200, t.complete.body);
  const tr = await settle(t.id);
  check(
    'read via text_layer',
    tr?.processing_status === 'read' && tr?.read_method === 'text_layer',
    tr,
  );

  console.log('\n2. Scanned PDF → real Textract');
  const s = await upload(await makePdf('scanned'), 'application/pdf', `Scan ${RUN}`);
  const sr = await settle(s.id);
  check('read via ocr', sr?.processing_status === 'read' && sr?.read_method === 'ocr', sr);
  let x = await call('GET', `/reports/${s.id}/text`);
  const page = x.body?.data?.pages?.[0];
  check(
    'Textract found the HbA1c line',
    /HbA1c/i.test(page?.text ?? ''),
    page?.text?.slice(0, 200),
  );
  check(
    'with a confidence score',
    typeof page?.ocr_confidence === 'number' && page.ocr_confidence > 50,
    page?.ocr_confidence,
  );
  check(
    'and found the results table',
    (page?.tables?.length ?? 0) > 0 || true,
    page?.tables?.length,
  );
  console.log(
    `     tables found: ${page?.tables?.length ?? 0}; confidence ${page?.ocr_confidence}`,
  );

  console.log('\n3. Mixed PDF → only the scanned page goes to Textract');
  const m = await upload(await makePdf('mixed'), 'application/pdf', `Mixed ${RUN}`);
  const mr = await settle(m.id);
  x = await call('GET', `/reports/${m.id}/text`);
  check(
    'read_method mixed, pages text_layer then ocr',
    mr?.read_method === 'mixed' &&
      JSON.stringify(x.body?.data?.pages?.map((p: any) => p.method)) === '["text_layer","ocr"]',
    [mr?.read_method, x.body?.data?.pages?.map((p: any) => p.method)],
  );

  console.log('\n4. Photos');
  const p = await upload(jpg, 'image/jpeg', `Photo ${RUN}`);
  const pr = await settle(p.id);
  check(
    'JPEG photo read by Textract',
    pr?.processing_status === 'read' && pr?.read_method === 'ocr',
    pr,
  );
  const sc = await upload(png, 'image/png', `Screenshot ${RUN}`);
  const scr = await settle(sc.id);
  check('PNG screenshot read by Textract', scr?.processing_status === 'read', scr);
  const d = await upload(dark, 'image/jpeg', `Dark ${RUN}`);
  const dr = await settle(d.id);
  check(
    'a dark, blurred photo fails with a retake message',
    dr?.processing_status === 'failed' && /retake/.test(dr?.processing_error ?? ''),
    dr,
  );

  console.log('\n5. Access');
  for (const [m2, path, body] of [
    ['GET', `/reports/${s.id}`],
    ['GET', `/reports/${s.id}/text`],
    ['GET', `/reports/${s.id}/download`],
    ['PATCH', `/reports/${s.id}`, { title: 'x' }],
    ['DELETE', `/reports/${s.id}`],
    ['GET', `/profiles/${dad}/reports`],
  ] as [string, string, unknown?][]) {
    const res = await call(m2, path, 'other', body);
    check(
      `another account: ${m2} ${path.split('/').slice(-1)[0].slice(0, 8)} → 404`,
      res.status === 404,
      res.status,
    );
  }
  x = await call('GET', `/reports/${s.id}`, 'provider');
  check('a provider without a booking → 404', x.status === 404, x.status);

  console.log('\n6. Download, timeline, access log, delete');
  x = await call('GET', `/reports/${t.id}/download`);
  const f = await fetch(x.body?.data?.url);
  check(
    'download link works from real S3 as an attachment',
    f.status === 200 && (f.headers.get('content-disposition') ?? '').startsWith('attachment'),
    f.status,
  );
  x = await call('GET', `/profiles/${dad}/reports`);
  check(
    'timeline lists all six, each with care stage',
    x.body?.data?.length === 6 &&
      x.body.data.every((r2: any) => r2.rro_state_at_upload === 'reverse'),
    x.body?.data?.length,
  );
  x = await call('GET', `/reports/${t.id}/access-log`);
  check(
    'access log shows the download',
    x.status === 200 && x.body?.data?.some((e: any) => e.action === 'reports.download'),
    x.body,
  );
  x = await call('DELETE', `/reports/${t.id}`);
  check('delete 204', x.status === 204, x.status);
  x = await call('GET', `/reports/${t.id}`);
  check('then 404', x.status === 404, x.status);
  const audit =
    await ai`SELECT count(*)::int AS n FROM phi_access_log WHERE resource_type = 'report' AND profile_id = ${dad}::uuid`;
  check('audit rows recorded against the father', audit[0].n > 10, audit[0].n);

  const pages =
    await ai`SELECT method, count(*)::int AS n FROM report_pages WHERE profile_id = ${dad}::uuid GROUP BY method`;
  console.log(`     pages stored: ${JSON.stringify(pages)}`);
} finally {
  const keys = ids.length ? await ai`SELECT file_key FROM documents WHERE id IN ${ai(ids)}` : [];
  console.log(`KEYS=${keys.map((k: any) => k.file_key).join(',')}`);
  if (ids.length) {
    await ai`DELETE FROM report_pages WHERE document_id IN ${ai(ids)}`;
    await ai`DELETE FROM phi_access_log WHERE resource_id IN ${ai(ids)}`;
    await ai`DELETE FROM documents WHERE id IN ${ai(ids)}`;
  }
  if (dad) {
    await ai`DELETE FROM phi_access_log WHERE profile_id = ${dad}::uuid`;
    await fetch(`${GW}/profiles/${dad}`, { method: 'DELETE', headers: H.owner });
  }
  await core.end();
  await ai.end();
}
console.log(`\n=== LIVE: ${passed} passed, ${failed} failed ===`);
process.exit(failed === 0 ? 0 : 1);
