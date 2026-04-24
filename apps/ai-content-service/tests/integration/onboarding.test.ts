/**
 * Real E2E — onboarding endpoints.
 *
 * No mocks. Requires:
 *   - Python agent running on http://localhost:8080
 *   - JWT_ACCESS_SECRET in .env.test
 *   - AWS Bedrock credentials (Nova Pro in ap-south-1)
 *
 * Run: bun test tests/integration/onboarding.test.ts --env-file .env.test
 */
import { describe, it, expect, beforeAll } from 'bun:test';
import jwt from 'jsonwebtoken';
import { createApp } from '../../src/app.js';

const PYTHON_URL = 'http://localhost:8080';
const JWT_SECRET = Bun.env.JWT_SECRET ?? Bun.env.JWT_ACCESS_SECRET ?? 'test-e2e-jwt-secret-longeny';

function makeToken(role: string = 'user'): string {
  return jwt.sign(
    {
      sub: 'test-user-e2e-001',
      email: 'e2e@longeny.test',
      role,
      jti: `jti-${Date.now()}`,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    JWT_SECRET,
  );
}

// Verify Python agent is reachable before running any test
beforeAll(async () => {
  const res = await fetch(`${PYTHON_URL}/openapi.json`).catch(() => null);
  if (!res || !res.ok) {
    throw new Error(`Python agent not reachable at ${PYTHON_URL}. Start it with: conda activate brave && uvicorn ai_engine.api.main:app --port 8000`);
  }
});

// ---------------------------------------------------------------------------
// Auth guard (no token → 401)
// ---------------------------------------------------------------------------

describe('Auth guard', () => {
  it('POST /ai/onboarding/start returns 401 without token', async () => {
    const app = createApp();
    const res = await app.handle(
      new Request('http://localhost/ai/onboarding/start', { method: 'POST' }),
    );
    expect(res.status).toBe(401);
  });

  it('GET /ai/onboarding/session/:id returns 401 without token', async () => {
    const app = createApp();
    const res = await app.handle(
      new Request('http://localhost/ai/onboarding/session/nonexistent'),
    );
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Real onboarding flow: Node → Python → Nova Pro
// ---------------------------------------------------------------------------

describe('POST /ai/onboarding/start — real Python call', () => {
  it('creates a session and returns first_question from Nova Pro', async () => {
    const app = createApp();
    const token = makeToken('user');

    const res = await app.handle(
      new Request('http://localhost/ai/onboarding/start', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }),
    );

    console.log('\n[ONBOARDING START] status:', res.status);
    const body = await res.json() as any;
    console.log('[ONBOARDING START] body:', JSON.stringify(body, null, 2));

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(typeof body.data.session_id).toBe('string');
    expect(body.data.session_id.length).toBeGreaterThan(0);
    expect(typeof body.data.first_question).toBe('string');
    expect(body.data.first_question.length).toBeGreaterThan(5);
  });
});

describe('GET /ai/onboarding/session/:id — real Python call', () => {
  it('returns finalize response for a created session', async () => {
    const app = createApp();
    const token = makeToken('user');

    // First create a session
    const startRes = await app.handle(
      new Request('http://localhost/ai/onboarding/start', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
    const startBody = await startRes.json() as any;
    const sessionId = startBody.data?.session_id;
    expect(typeof sessionId).toBe('string');

    // Now get/finalize it
    const res = await app.handle(
      new Request(`http://localhost/ai/onboarding/session/${sessionId}`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );

    console.log('\n[ONBOARDING SESSION] status:', res.status);
    const body = await res.json() as any;
    console.log('[ONBOARDING SESSION] body:', JSON.stringify(body, null, 2));

    // Session just created, not yet complete — Python returns 404 (not finalized)
    // Controller throws AppError(404, 'NOT_FOUND') with message 'Session not found or not yet complete'
    expect(res.status).toBe(404);
    expect(body.success).toBe(false);
    expect(body.error.message).toBe('Session not found or not yet complete');
  });
});
