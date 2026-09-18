// Hierarchical real-data test on the dev server: 3 accounts, 7 profiles, 15 reports in
// every format, through the gateway, real S3, real Textract. Nothing faked.
// Throwaway accounts; everything created is removed at the end.
import crypto from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import jwt from 'jsonwebtoken';
import { PDFDocument } from 'pdf-lib';
import postgres from 'postgres';

const GW = 'http://localhost:4001/api/v1';
const DIR = '/tmp/hier';
const REPORTS: any[] = JSON.parse(readFileSync(`${DIR}/reports.json`, 'utf8'));
const RUN = Date.now().toString(36);
const ACC: Record<string, string> = {
  A: crypto.randomUUID(),
  B: crypto.randomUUID(),
  C: crypto.randomUUID(),
};
const tok = (sub: string) =>
  jwt.sign(
    {
      sub,
      email: `hier-${sub.slice(0, 6)}-${RUN}@longeny.test`,
      role: 'user',
      roles: ['user'],
      permissions: ['profiles:read', 'profiles:write', 'documents:read', 'documents:write'],
      jti: crypto.randomUUID(),
    },
    process.env.JWT_ACCESS_SECRET as string,
    { expiresIn: '30m' },
  );
const H: Record<string, Record<string, string>> = Object.fromEntries(
  Object.entries(ACC).map(([k, v]) => [
    k,
    { Authorization: `Bearer ${tok(v)}`, 'Content-Type': 'application/json' },
  ]),
);

let passed = 0;
let failed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) passed++;
  else {
    failed++;
    failures.push(name);
  }
  console.log(
    `  ${ok ? '✓' : '✗'} ${name}${ok ? '' : ` — ${JSON.stringify(detail)?.slice(0, 400)}`}`,
  );
};

// The gateway allows 100 requests a minute per address; stay under it.
const stamps: number[] = [];
async function pace() {
  for (;;) {
    const now = Date.now();
    while (stamps.length && now - stamps[0] > 60_000) stamps.shift();
    if (stamps.length < 88) break;
    await Bun.sleep(60_000 - (now - stamps[0]) + 50);
  }
  stamps.push(Date.now());
}
async function call(method: string, path: string, who: string, body?: unknown) {
  await pace();
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

const file = (n: string) => new Uint8Array(readFileSync(`${DIR}/out/${n}`));
async function bytesFor(r: any): Promise<[Uint8Array, string]> {
  switch (r.format) {
    case 'digital':
    case 'scanned':
      return [file(`${r.key}.pdf`), 'application/pdf'];
    case 'same_as_A1':
      return [file('A1.pdf'), 'application/pdf'];
    case 'screenshot':
      return [file(`${r.key}.png`), 'image/png'];
    case 'photo':
    case 'dark':
      return [file(`${r.key}.jpg`), 'image/jpeg'];
    case 'tiff':
      return [file(`${r.key}.tiff`), 'image/tiff'];
    case 'dicom':
      return [file(`${r.key}.dcm`), 'application/dicom'];
    case 'mixed': {
      // Page 1 printed from HTML (has text), page 2 a screenshot (image only).
      const doc = await PDFDocument.load(file(`${r.key}_d.pdf`));
      const img = await doc.embedPng(file(`${r.key}.png`));
      doc
        .addPage([img.width, img.height])
        .drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
      return [await doc.save(), 'application/pdf'];
    }
  }
  throw new Error(`unknown format ${r.format}`);
}

const core = postgres(process.env.CORE_DATABASE_URL as string);
const ai = postgres(process.env.AI_CONTENT_DATABASE_URL as string);
const profiles: Record<string, string> = {}; // "A.father" → id
const stage: Record<string, string> = {
  'A.self': 'optimise',
  'A.father': 'restore',
  'A.mother': 'reverse',
  'A.child': 'intake',
  'B.self': 'reverse',
  'B.spouse': 'restore',
  'C.self': 'intake',
};
const reportId: Record<string, string> = {};
const summary: any[] = [];

try {
  // ── Setup: accounts and family ──
  console.log('\n0. Accounts and family members');
  for (const [k, id] of Object.entries(ACC)) {
    await core`INSERT INTO users (auth_id, email, first_name, last_name) VALUES (${id}::uuid, ${`hier-${k}-${RUN}@longeny.test`}, ${k}, 'Hier')`;
  }
  const family: [string, string, string][] = [
    ['A', 'father', 'Ramesh'],
    ['A', 'mother', 'Sunita'],
    ['A', 'child', 'Aarav'],
    ['B', 'spouse', 'Neha'],
  ];
  for (const [acc, rel, name] of family) {
    const r = await call('POST', '/profiles', acc, { relation: rel, firstName: `${name}-${RUN}` });
    profiles[`${acc}.${rel}`] = r.body?.data?.id;
    check(`${acc} adds ${rel}`, r.status === 201, r);
  }
  for (const acc of ['A', 'B', 'C']) {
    const r = await call('GET', '/profiles', acc);
    profiles[`${acc}.self`] = r.body?.data?.find((p: any) => p.is_self)?.id;
  }
  check(
    'all 7 profiles exist',
    Object.keys(stage).every((k) => Boolean(profiles[k])),
    profiles,
  );
  for (const [k, s] of Object.entries(stage)) {
    await core`INSERT INTO rro_state (profile_id, current_state) VALUES (${profiles[k]}::uuid, ${s}::rro_state_value)
               ON CONFLICT (profile_id) DO UPDATE SET current_state = EXCLUDED.current_state`;
  }

  // ── 1. Upload all 15 ──
  console.log('\n1. Upload 15 reports across 7 people, as each owner');
  for (const r of REPORTS) {
    const [bytes, mime] = await bytesFor(r);
    const pid = profiles[`${r.account}.${r.profile}`];
    const d = await call('POST', `/profiles/${pid}/reports`, r.account, {
      title: `${r.key} ${r.panel} ${RUN}`,
      fileName: `${r.key}.${mime.split('/')[1]}`,
      fileSize: bytes.byteLength,
      mimeType: mime,
      documentType: r.documentType,
      ...(r.reportedAt ? { reportedAt: r.reportedAt } : {}),
    });
    const id = d.body?.data?.report?.id;
    reportId[r.key] = id;
    const put = (
      await fetch(d.body?.data?.upload?.url, {
        method: 'PUT',
        headers: { 'Content-Type': mime },
        body: bytes,
      })
    ).status;
    const c = await call('POST', `/reports/${id}/complete`, r.account);
    check(
      `${r.key}: ${r.account}.${r.profile} ${r.format} (${mime}) declared, stored in S3, confirmed`,
      d.status === 201 && put === 200 && c.status === 200,
      { d: d.status, put, c: c.body },
    );
  }

  // ── 2. Wait for the reader ──
  console.log('\n2. Waiting for the reader (real Textract)…');
  const until = Date.now() + 240_000;
  const rows: Record<string, any> = {};
  while (Date.now() < until) {
    let pending = 0;
    for (const k of Object.keys(stage)) {
      const [acc] = k.split('.');
      const t = await call('GET', `/profiles/${profiles[k]}/reports?limit=100`, acc);
      for (const rep of t.body?.data ?? []) rows[rep.id] = rep;
    }
    for (const id of Object.values(reportId))
      if (['uploaded', 'reading', 'awaiting_upload'].includes(rows[id]?.processing_status))
        pending++;
    if (pending === 0) break;
    await Bun.sleep(4000);
  }

  // ── 3. Each report: right person, right stage, read the right way, right text ──
  console.log('\n3. Every report: right person, right stage, read correctly');
  const allSids = REPORTS.filter((r) => r.sid && r.sid !== '-').map((r) => r.sid.split(' ')[1]);
  for (const r of REPORTS) {
    const id = reportId[r.key];
    const rep = rows[id];
    const key = `${r.account}.${r.profile}`;
    const e = r.expect;
    check(`${r.key}: on ${key}`, rep?.profile_id === profiles[key], rep?.profile_id);
    check(
      `${r.key}: care stage at upload = ${stage[key]}`,
      rep?.rro_state_at_upload === stage[key],
      rep?.rro_state_at_upload,
    );
    check(`${r.key}: status ${e.status}`, rep?.processing_status === e.status, [
      rep?.processing_status,
      rep?.processing_error,
    ]);
    const row: any = {
      key: r.key,
      who: key,
      format: r.format,
      status: rep?.processing_status,
      method: rep?.read_method,
      pages: rep?.page_count,
      error: rep?.processing_error,
    };
    if (e.status === 'read') {
      check(
        `${r.key}: read by ${e.method}, ${e.pages} page(s)`,
        rep?.read_method === e.method && rep?.page_count === e.pages,
        [rep?.read_method, rep?.page_count],
      );
      const t = await call('GET', `/reports/${id}/text`, r.account);
      const text = (t.body?.data?.pages ?? [])
        .map((p: any) => `${p.text}\n${JSON.stringify(p.tables)}`)
        .join('\n');
      for (const f of e.find)
        check(`${r.key}: text contains "${f}"`, text.includes(f), text.slice(0, 300));
      const own = r.format === 'same_as_A1' ? '410001' : r.sid.split(' ')[1];
      const foreign = allSids.filter((s) => s !== own && text.includes(s));
      check(`${r.key}: no other report's sample ID in its text`, foreign.length === 0, foreign);
      const ocrPages = (t.body?.data?.pages ?? []).filter((p: any) => p.method === 'ocr');
      if (ocrPages.length) {
        const conf = ocrPages.map((p: any) => p.ocr_confidence);
        row.confidence = Math.min(...conf);
        row.tables = ocrPages.reduce((n: number, p: any) => n + p.tables.length, 0);
        check(
          `${r.key}: OCR found the results table`,
          row.tables > 0,
          ocrPages.map((p: any) => p.tables.length),
        );
      }
      row.found = `${e.find.filter((f: string) => text.includes(f)).length}/${e.find.length}`;
    }
    if (e.status === 'failed')
      check(
        `${r.key}: says retake`,
        /retake/.test(rep?.processing_error ?? ''),
        rep?.processing_error,
      );
    summary.push(row);
  }

  // ── 4. Same PDF, two accounts ──
  console.log('\n4. The same PDF uploaded by two accounts stays two reports');
  const pair =
    await ai`SELECT id, profile_id, file_key FROM documents WHERE id IN (${reportId.A1}::uuid, ${reportId.B1}::uuid)`;
  check('two separate rows', pair.length === 2 && pair[0].id !== pair[1].id);
  check('different people', pair[0].profile_id !== pair[1].profile_id);
  check(
    'different storage objects',
    pair[0].file_key !== pair[1].file_key,
    pair.map((p: any) => p.file_key),
  );

  // ── 5. Timelines: exactly their own ──
  console.log('\n5. Each person’s timeline holds exactly their own reports');
  for (const k of Object.keys(stage)) {
    const [acc, rel] = k.split('.');
    const want = REPORTS.filter((r) => r.account === acc && r.profile === rel)
      .map((r) => reportId[r.key])
      .sort();
    const t = await call('GET', `/profiles/${profiles[k]}/reports?limit=100`, acc);
    const got = (t.body?.data ?? []).map((d: any) => d.id).sort();
    check(
      `${k}: ${want.length} report(s), no one else's`,
      JSON.stringify(got) === JSON.stringify(want),
      { want: want.length, got: got.length },
    );
    const dates = (t.body?.data ?? []).map((d: any) => d.reported_at ?? d.created_at);
    check(
      `${k}: newest test first`,
      dates.every((d: string, i: number) => i === 0 || dates[i - 1] >= d),
      dates,
    );
  }

  // ── 6. Cross-account: every account against every other account's reports ──
  console.log('\n6. Every account tries every other account’s reports');
  let probes = 0;
  let leaks = 0;
  for (const r of REPORTS) {
    for (const acc of ['A', 'B', 'C'].filter((a) => a !== r.account)) {
      for (const path of [`/reports/${reportId[r.key]}`, `/reports/${reportId[r.key]}/text`]) {
        const x = await call('GET', path, acc);
        probes++;
        if (x.status !== 404) {
          leaks++;
          console.log(`     LEAK ${acc} → ${r.key} ${path}: ${x.status}`);
        }
      }
    }
  }
  check(`${probes} cross-account reads, all 404`, leaks === 0, leaks);
  let tl = 0;
  let tlLeaks = 0;
  for (const k of Object.keys(stage)) {
    for (const acc of ['A', 'B', 'C'].filter((a) => a !== k.split('.')[0])) {
      const x = await call('GET', `/profiles/${profiles[k]}/reports`, acc);
      tl++;
      if (x.status !== 404) tlLeaks++;
    }
  }
  check(`${tl} cross-account timeline reads, all 404`, tlLeaks === 0, tlLeaks);
  for (const [acc, key] of [
    ['B', 'A3'],
    ['C', 'A6'],
    ['A', 'B2'],
    ['C', 'B3'],
    ['A', 'C1'],
    ['B', 'C2'],
  ]) {
    const id = reportId[key];
    const p = await call('PATCH', `/reports/${id}`, acc, { title: 'taken' });
    const d = await call('DELETE', `/reports/${id}`, acc);
    const dl = await call('GET', `/reports/${id}/download`, acc);
    check(
      `${acc} cannot edit, delete or download ${key}`,
      p.status === 404 && d.status === 404 && dl.status === 404,
      [p.status, d.status, dl.status],
    );
    const up = await call('POST', `/profiles/${rows[id]?.profile_id}/reports`, acc, {
      title: 'x',
      fileName: 'x.pdf',
      fileSize: 10,
      mimeType: 'application/pdf',
      documentType: 'lab_report',
    });
    check(`${acc} cannot upload onto ${key}'s person`, up.status === 404, up.status);
  }
  const untouched = await call('GET', `/reports/${reportId.A3}`, 'A');
  check(
    'nothing was changed by the attempts',
    untouched.body?.data?.title === `A3 diabetes ${RUN}`,
    untouched.body?.data?.title,
  );

  // ── 7. The care stage is a snapshot ──
  console.log('\n7. Changing a person’s stage does not rewrite old reports');
  await core`UPDATE rro_state SET current_state = 'optimise' WHERE profile_id = ${profiles['A.father']}::uuid`;
  const again = await call('GET', `/reports/${reportId.A4}`, 'A');
  check(
    'father moved to optimise; his April report still says restore',
    again.body?.data?.rro_state_at_upload === 'restore',
    again.body?.data?.rro_state_at_upload,
  );

  // ── 8. Filters ──
  console.log('\n8. Timeline filters');
  let f = await call(
    'GET',
    `/profiles/${profiles['A.father']}/reports?from=2026-04-01&to=2026-06-30`,
    'A',
  );
  check(
    'father, April–June → A4 and A5',
    JSON.stringify(f.body?.data?.map((d: any) => d.id).sort()) ===
      JSON.stringify([reportId.A4, reportId.A5].sort()),
    f.body?.data?.map((d: any) => d.title),
  );
  f = await call('GET', `/profiles/${profiles['A.mother']}/reports?status=failed`, 'A');
  check(
    'mother, failed → the dark photo',
    f.body?.data?.length === 1 && f.body.data[0].id === reportId.A7,
    f.body?.data?.length,
  );
  f = await call('GET', `/profiles/${profiles['A.mother']}/reports?documentType=imaging`, 'A');
  check(
    'mother, imaging → the X-ray',
    f.body?.data?.length === 1 && f.body.data[0].id === reportId.A8,
    f.body?.data?.length,
  );
  f = await call('GET', `/profiles/${profiles['A.child']}/reports?documentType=prescription`, 'A');
  check(
    'child, prescription → the prescription',
    f.body?.data?.length === 1 && f.body.data[0].id === reportId.A10,
    f.body?.data?.length,
  );

  // ── 9. Download, retry, delete, access log ──
  console.log('\n9. Download, retry, delete, access log');
  const dl = await call('GET', `/reports/${reportId.A4}/download`, 'A');
  const got = new Uint8Array(await (await fetch(dl.body?.data?.url)).arrayBuffer());
  check(
    'father’s scanned PDF downloads byte-for-byte',
    got.byteLength === file('A4.pdf').byteLength,
    got.byteLength,
  );
  const rt = await call('POST', `/reports/${reportId.A7}/ocr/retry`, 'A');
  check('retry the dark photo → 202', rt.status === 202, rt.status);
  let st = '';
  for (let i = 0; i < 30 && st !== 'failed'; i++) {
    await Bun.sleep(3000);
    st = (await call('GET', `/reports/${reportId.A7}`, 'A')).body?.data?.processing_status;
  }
  check('still failed — same dark photo', st === 'failed', st);
  const del = await call('DELETE', `/reports/${reportId.A2}`, 'A');
  const gone = await call('GET', `/reports/${reportId.A2}`, 'A');
  const selfTl = await call('GET', `/profiles/${profiles['A.self']}/reports`, 'A');
  check(
    'delete A2 → 204, then 404, and it left Asha’s timeline',
    del.status === 204 && gone.status === 404 && selfTl.body?.data?.length === 1,
    [del.status, gone.status, selfTl.body?.data?.length],
  );
  const log = await call('GET', `/reports/${reportId.A4}/access-log`, 'A');
  check(
    'access log of father’s report shows the owner’s views and download',
    log.body?.data?.some((e: any) => e.action === 'reports.download' && e.is_you),
    log.body?.data?.length,
  );
  const leaked = await call('GET', `/reports/${reportId.A4}/access-log`, 'B');
  check('another account cannot read that access log', leaked.status === 404, leaked.status);

  // ── 10. Audit rows name the right person ──
  console.log('\n10. Audit trail');
  const ids = Object.values(reportId);
  const audit =
    await ai`SELECT d.id, d.profile_id AS owner, a.profile_id AS logged, a.success, a.actor_id
                        FROM phi_access_log a JOIN documents d ON d.id::text = a.resource_id
                        WHERE a.resource_type = 'report' AND d.id IN ${ai(ids)}`;
  check(
    `${audit.length} audit rows, every one names the report’s own person`,
    audit.length > 50 && audit.every((a: any) => a.owner === a.logged),
    audit.filter((a: any) => a.owner !== a.logged).length,
  );
  const refused = audit.filter((a: any) => !a.success);
  // The owner's only refusal is asking for the report they deleted.
  const wrong = refused.filter((a: any) => {
    const owner = REPORTS.find((r) => reportId[r.key] === a.id)?.account as string;
    return a.actor_id === ACC[owner] && a.id !== reportId.A2;
  });
  check(
    `${refused.length} refused attempts recorded, all by the wrong account`,
    refused.length >= probes && wrong.length === 0,
    wrong,
  );
} finally {
  const ids = Object.values(reportId).filter(Boolean);
  const keys = ids.length ? await ai`SELECT file_key FROM documents WHERE id IN ${ai(ids)}` : [];
  writeFileSync(`${DIR}/keys.txt`, keys.map((k: any) => k.file_key).join('\n'));
  writeFileSync(
    `${DIR}/summary.json`,
    JSON.stringify({ passed, failed, failures, summary }, null, 1),
  );
  if (ids.length) {
    await ai`DELETE FROM report_pages WHERE document_id IN ${ai(ids)}`;
    await ai`DELETE FROM phi_access_log WHERE resource_id IN ${ai(ids)}`;
    await ai`DELETE FROM documents WHERE id IN ${ai(ids)}`;
  }
  for (const [k, id] of Object.entries(profiles)) {
    if (!id) continue;
    await ai`DELETE FROM phi_access_log WHERE profile_id = ${id}::uuid`;
    if (!k.endsWith('.self'))
      await fetch(`${GW}/profiles/${id}`, { method: 'DELETE', headers: H[k.split('.')[0]] });
  }
  await core.end();
  await ai.end();
}
console.log('\nWhat was read:');
console.table(summary);
console.log(`\n=== HIERARCHICAL: ${passed} passed, ${failed} failed ===`);
process.exit(failed === 0 ? 0 : 1);
