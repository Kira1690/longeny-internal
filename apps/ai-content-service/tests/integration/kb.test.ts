/**
 * Real E2E — KB upload + status endpoints.
 *
 * No mocks. Requires:
 *   - Python agent running on http://localhost:8080
 *   - JWT_ACCESS_SECRET in .env.test
 *   - S3 bucket longeny-uploads in ap-south-1
 *   - Redis on localhost:6379
 *   - AWS Bedrock credentials (Titan V2 embeddings)
 *
 * Run: bun test tests/integration/kb.test.ts --env-file .env.test
 */
import { describe, it, expect, beforeAll } from 'bun:test';
import jwt from 'jsonwebtoken';
import { createApp } from '../../src/app.js';

const PYTHON_URL = 'http://localhost:8080';
const JWT_SECRET = Bun.env.JWT_SECRET ?? Bun.env.JWT_ACCESS_SECRET ?? 'test-e2e-jwt-secret-longeny';

function makeToken(role: string = 'provider'): string {
  return jwt.sign(
    {
      sub: 'test-provider-e2e-001',
      email: 'provider@longeny.test',
      role,
      jti: `jti-${Date.now()}`,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    JWT_SECRET,
  );
}

const HEADACHE_TEXT = `LONGENY MEDICAL KNOWLEDGE BASE - HEADACHE GUIDE

TENSION HEADACHE
Tension headaches are the most common type of headache.
Symptoms: dull aching pain on both sides of the head, pressure around the forehead.
Treatment: paracetamol 500mg every 4-6 hours, ibuprofen 400mg with food.

MIGRAINE
Migraines cause intense throbbing pain, usually one-sided.
Treatment: triptans (sumatriptan 50mg), anti-nausea medication.

EMERGENCY SIGNS
Seek emergency care for thunderclap headache, fever with stiff neck, or after head injury.
`;

beforeAll(async () => {
  const res = await fetch(`${PYTHON_URL}/openapi.json`).catch(() => null);
  if (!res || !res.ok) {
    throw new Error(`Python agent not reachable at ${PYTHON_URL}`);
  }
});

// ---------------------------------------------------------------------------
// Auth guard
// ---------------------------------------------------------------------------

describe('Auth guard', () => {
  it('POST /ai/kb/upload returns 401 without token', async () => {
    const app = createApp();
    const form = new FormData();
    form.append('file', new Blob([HEADACHE_TEXT], { type: 'text/plain' }), 'headache.txt');
    const res = await app.handle(
      new Request('http://localhost/ai/kb/upload', { method: 'POST', body: form }),
    );
    expect(res.status).toBe(401);
  });

  it('GET /ai/kb/status/:jobId returns 401 without token', async () => {
    const app = createApp();
    const res = await app.handle(new Request('http://localhost/ai/kb/status/some-job-id'));
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Real KB upload: Node → S3 → Python → Bedrock embed → ChromaDB
// ---------------------------------------------------------------------------

describe('POST /ai/kb/upload — real S3 + Python ingestion', () => {
  it('uploads file to S3, triggers Python ingest, returns job_id', async () => {
    const app = createApp();
    // provider role required for KB upload
    const token = makeToken('provider');

    const form = new FormData();
    form.append(
      'file',
      new Blob([HEADACHE_TEXT], { type: 'text/plain' }),
      'headache_guide_e2e.txt',
    );
    form.append('title', 'Headache Guide E2E Test');
    form.append('description', 'Real E2E test document');

    const res = await app.handle(
      new Request('http://localhost/ai/kb/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      }),
    );

    console.log('\n[KB UPLOAD] status:', res.status);
    const body = await res.json() as any;
    console.log('[KB UPLOAD] body:', JSON.stringify(body, null, 2));

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(typeof body.data.job_id).toBe('string');
    expect(body.data.job_id.length).toBeGreaterThan(0);
    expect(body.data.status).toBe('queued');

    // Poll Redis-backed status endpoint until completed or timeout (30s)
    const jobId = body.data.job_id;
    const token2 = makeToken('user');
    let finalStatus = 'queued';
    const deadline = Date.now() + 30_000;

    while (Date.now() < deadline) {
      await Bun.sleep(2000);
      const statusRes = await app.handle(
        new Request(`http://localhost/ai/kb/status/${jobId}`, {
          headers: { Authorization: `Bearer ${token2}` },
        }),
      );
      const statusBody = await statusRes.json() as any;
      console.log(`[KB STATUS] job=${jobId} status=${statusBody.data?.status}`);
      finalStatus = statusBody.data?.status ?? 'unknown';
      if (finalStatus === 'completed' || finalStatus === 'failed') break;
    }

    console.log(`[KB UPLOAD] Final ingestion status: ${finalStatus}`);
    expect(finalStatus).toBe('completed');
  }, 45_000); // 45s timeout for Bedrock embed + ChromaDB write
});

// ---------------------------------------------------------------------------
// GET /ai/kb/status/:jobId — real Redis read
// ---------------------------------------------------------------------------

describe('GET /ai/kb/status/:jobId — real Redis', () => {
  it('returns 404 or status for unknown job', async () => {
    const app = createApp();
    const token = makeToken('user');
    const res = await app.handle(
      new Request('http://localhost/ai/kb/status/nonexistent-job-xyz', {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
    console.log('\n[KB STATUS unknown] status:', res.status);
    const body = await res.json() as any;
    console.log('[KB STATUS unknown] body:', JSON.stringify(body, null, 2));
    // Unknown job not in Redis → controller throws AppError(404, 'NOT_FOUND')
    expect(res.status).toBe(404);
    expect(body.success).toBe(false);
    expect(body.error.message).toBe('Job not found or expired');
  });
});
