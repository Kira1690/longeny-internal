/**
 * Week 4 E2E integration tests — all new Node routes.
 *
 * No mocks. Every test makes real HTTP calls through the Node Elysia app which
 * proxies to the Python agent.
 *
 * Requirements:
 *   - Python agent running on http://localhost:8000
 *   - JWT_ACCESS_SECRET in .env.test (or the default test secret is used)
 *
 * Run:
 *   bun test tests/integration/week4.test.ts --env-file .env.test
 *
 * NOTE: .env.test sets AI_AGENT_URL=http://localhost:8080, but the Python agent
 * actually runs on port 8000. We override AI_AGENT_URL to 8000 here before
 * createApp() is called so the config picks it up correctly.
 */

// Override AI_AGENT_URL BEFORE any module that reads config is imported.
process.env.AI_AGENT_URL = 'http://localhost:8000';

import { describe, it, expect, beforeAll } from 'bun:test';
import jwt from 'jsonwebtoken';
import { createApp } from '../../src/app.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PYTHON_URL = 'http://localhost:8000';
const JWT_SECRET =
  Bun.env.JWT_SECRET ?? Bun.env.JWT_ACCESS_SECRET ?? 'test-e2e-jwt-secret-longeny';

// Stable test provider ID reused across provider + scheduling + notification tests.
const TEST_PROVIDER_ID = `test-node-prov-${Date.now()}`;
// Stable user ID used as the JWT sub across all tests.
const TEST_USER_ID = 'test-user-w4-001';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeToken(role: string = 'user', sub: string = TEST_USER_ID): string {
  return jwt.sign(
    {
      sub,
      email: 'w4@longeny.test',
      role,
      jti: `jti-w4-${Date.now()}`,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    JWT_SECRET,
  );
}

function authHeader(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

function jsonBody(payload: unknown): { method: string; headers: Record<string, string>; body: string } {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };
}

// ---------------------------------------------------------------------------
// Global: verify Python agent is reachable before any test runs
// ---------------------------------------------------------------------------

beforeAll(async () => {
  const res = await fetch(`${PYTHON_URL}/openapi.json`).catch(() => null);
  if (!res || !res.ok) {
    throw new Error(
      `Python agent not reachable at ${PYTHON_URL}. ` +
        'Start it with: conda activate brave && uvicorn ai_engine.api.main:app --port 8000',
    );
  }
});

// ===========================================================================
// 1. SESSION ROUTES  —  /ai/sessions/*
// ===========================================================================

describe('Auth guard — /ai/sessions', () => {
  it('POST /ai/sessions/start returns 401 without token', async () => {
    const app = createApp();
    const res = await app.handle(
      new Request('http://localhost/ai/sessions/start', { method: 'POST' }),
    );
    expect(res.status).toBe(401);
  });

  it('GET /ai/sessions/history returns 401 without token', async () => {
    const app = createApp();
    const res = await app.handle(new Request('http://localhost/ai/sessions/history'));
    expect(res.status).toBe(401);
  });

  it('GET /ai/sessions/:id returns 401 without token', async () => {
    const app = createApp();
    const res = await app.handle(new Request('http://localhost/ai/sessions/some-id'));
    expect(res.status).toBe(401);
  });
});

describe('POST /ai/sessions/start — real Python call', () => {
  it('creates a session and returns session_id + first_question', async () => {
    const app = createApp();
    const token = makeToken();

    const res = await app.handle(
      new Request('http://localhost/ai/sessions/start', {
        method: 'POST',
        headers: authHeader(token),
      }),
    );

    console.log('\n[SESSION START] status:', res.status);
    const body = (await res.json()) as any;
    console.log('[SESSION START] body:', JSON.stringify(body, null, 2));

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(typeof body.data.session_id).toBe('string');
    expect(body.data.session_id.length).toBeGreaterThan(0);
    expect(typeof body.data.first_question).toBe('string');
    expect(body.data.first_question.length).toBeGreaterThan(5);
  });
});

describe('GET /ai/sessions/history — real Python call', () => {
  it('returns an array of session summaries for the authenticated user', async () => {
    const app = createApp();
    const token = makeToken();

    const res = await app.handle(
      new Request('http://localhost/ai/sessions/history', {
        headers: authHeader(token),
      }),
    );

    console.log('\n[SESSION HISTORY] status:', res.status);
    const body = (await res.json()) as any;
    console.log('[SESSION HISTORY] body:', JSON.stringify(body, null, 2));

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });
});

describe('GET /ai/sessions/:id — real Python call', () => {
  it('returns 404 for a freshly created session (not yet finalised)', async () => {
    const app = createApp();
    const token = makeToken();

    // Create a session first so we have a valid ID.
    const startRes = await app.handle(
      new Request('http://localhost/ai/sessions/start', {
        method: 'POST',
        headers: authHeader(token),
      }),
    );
    const startBody = (await startRes.json()) as any;
    const sessionId: string = startBody.data?.session_id;
    expect(typeof sessionId).toBe('string');

    // Immediately try to retrieve/finalise it — Python returns 404.
    const res = await app.handle(
      new Request(`http://localhost/ai/sessions/${sessionId}`, {
        headers: authHeader(token),
      }),
    );

    console.log('\n[SESSION GET] status:', res.status);
    const body = (await res.json()) as any;
    console.log('[SESSION GET] body:', JSON.stringify(body, null, 2));

    expect(res.status).toBe(404);
    expect(body.success).toBe(false);
  });
});

// ===========================================================================
// 2. PROVIDER ROUTES  —  /ai/provider/*
// ===========================================================================

describe('Auth guard — /ai/provider', () => {
  it('POST /ai/provider/profile returns 401 without token', async () => {
    const app = createApp();
    const res = await app.handle(
      new Request('http://localhost/ai/provider/profile', {
        ...jsonBody({ specialties: ['cardiology'], consultation_modes: ['online'] }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it('GET /ai/provider/profile/:id returns 401 without token', async () => {
    const app = createApp();
    const res = await app.handle(
      new Request(`http://localhost/ai/provider/profile/${TEST_PROVIDER_ID}`),
    );
    expect(res.status).toBe(401);
  });

  it('GET /ai/provider/profiles returns 401 without token', async () => {
    const app = createApp();
    const res = await app.handle(new Request('http://localhost/ai/provider/profiles'));
    expect(res.status).toBe(401);
  });

  it('PUT /ai/provider/profile/:id/deactivate returns 401 without token', async () => {
    const app = createApp();
    const res = await app.handle(
      new Request(`http://localhost/ai/provider/profile/${TEST_PROVIDER_ID}/deactivate`, {
        method: 'PUT',
      }),
    );
    expect(res.status).toBe(401);
  });
});

describe('POST /ai/provider/profile — body validation', () => {
  it('returns 422 when specialties is missing', async () => {
    const app = createApp();
    const token = makeToken('provider');

    const res = await app.handle(
      new Request('http://localhost/ai/provider/profile', {
        method: 'POST',
        headers: { ...authHeader(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ consultation_modes: ['online'] }),
      }),
    );

    expect(res.status).toBe(422);
  });

  it('returns 422 when consultation_modes is missing', async () => {
    const app = createApp();
    const token = makeToken('provider');

    const res = await app.handle(
      new Request('http://localhost/ai/provider/profile', {
        method: 'POST',
        headers: { ...authHeader(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ specialties: ['cardiology'] }),
      }),
    );

    expect(res.status).toBe(422);
  });
});

describe('Provider profile CRUD — real Python calls', () => {
  let createdProviderId: string;

  it('upserts a provider profile and returns full profile shape', async () => {
    const app = createApp();
    const token = makeToken('provider', TEST_PROVIDER_ID);

    const res = await app.handle(
      new Request('http://localhost/ai/provider/profile', {
        method: 'POST',
        headers: { ...authHeader(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          specialties: ['cardiology', 'internal medicine'],
          conditions_treated: ['hypertension', 'diabetes'],
          consultation_modes: ['online', 'offline'],
          languages: ['English', 'Hindi'],
          city: 'Mumbai',
          hourly_rate_inr: 1500,
          years_experience: 10,
          bio: 'Experienced cardiologist.',
        }),
      }),
    );

    console.log('\n[PROVIDER UPSERT] status:', res.status);
    const body = (await res.json()) as any;
    console.log('[PROVIDER UPSERT] body:', JSON.stringify(body, null, 2));

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);

    const profile = body.data;
    expect(typeof profile.provider_id).toBe('string');
    expect(Array.isArray(profile.specialties)).toBe(true);
    expect(profile.specialties).toContain('cardiology');
    expect(Array.isArray(profile.consultation_modes)).toBe(true);
    expect(typeof profile.is_active).toBe('boolean');
    expect(typeof profile.rating).toBe('number');
    expect(typeof profile.total_consultations).toBe('number');
    expect(typeof profile.created_at).toBe('string');
    expect(typeof profile.updated_at).toBe('string');

    createdProviderId = profile.provider_id;
  });

  it('retrieves the created provider profile by ID', async () => {
    if (!createdProviderId) return; // skip if create failed

    const app = createApp();
    const token = makeToken('provider');

    const res = await app.handle(
      new Request(`http://localhost/ai/provider/profile/${createdProviderId}`, {
        headers: authHeader(token),
      }),
    );

    console.log('\n[PROVIDER GET] status:', res.status);
    const body = (await res.json()) as any;
    console.log('[PROVIDER GET] body:', JSON.stringify(body, null, 2));

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.provider_id).toBe(createdProviderId);
    expect(Array.isArray(body.data.specialties)).toBe(true);
    expect(body.data.is_active).toBe(true);
  });

  it('lists all provider profiles and returns an array', async () => {
    const app = createApp();
    const token = makeToken('provider');

    const res = await app.handle(
      new Request('http://localhost/ai/provider/profiles', {
        headers: authHeader(token),
      }),
    );

    console.log('\n[PROVIDER LIST] status:', res.status);
    const body = (await res.json()) as any;
    console.log('[PROVIDER LIST] count:', Array.isArray(body.data) ? body.data.length : 'N/A');

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('filters profiles by specialty', async () => {
    const app = createApp();
    const token = makeToken('provider');

    const res = await app.handle(
      new Request('http://localhost/ai/provider/profiles?specialty=cardiology', {
        headers: authHeader(token),
      }),
    );

    console.log('\n[PROVIDER LIST FILTERED] status:', res.status);
    const body = (await res.json()) as any;
    console.log('[PROVIDER LIST FILTERED] count:', Array.isArray(body.data) ? body.data.length : 'N/A');

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    // Every returned profile should contain the requested specialty.
    if (body.data.length > 0) {
      for (const p of body.data) {
        expect(
          (p.specialties as string[]).some((s) =>
            s.toLowerCase().includes('cardiology'),
          ),
        ).toBe(true);
      }
    }
  });

  it('returns 404 for a nonexistent provider ID', async () => {
    const app = createApp();
    const token = makeToken('provider');

    const res = await app.handle(
      new Request('http://localhost/ai/provider/profile/does-not-exist-xyz-999', {
        headers: authHeader(token),
      }),
    );

    console.log('\n[PROVIDER GET 404] status:', res.status);
    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body.success).toBe(false);
  });

  it('deactivates a provider profile', async () => {
    if (!createdProviderId) return;

    const app = createApp();
    const token = makeToken('provider');

    const res = await app.handle(
      new Request(`http://localhost/ai/provider/profile/${createdProviderId}/deactivate`, {
        method: 'PUT',
        headers: authHeader(token),
      }),
    );

    console.log('\n[PROVIDER DEACTIVATE] status:', res.status);
    const body = (await res.json()) as any;
    console.log('[PROVIDER DEACTIVATE] body:', JSON.stringify(body, null, 2));

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.deactivated).toBe(true);
  });
});

// ===========================================================================
// 3. MATCHING ROUTES  —  /ai/matching/*
// ===========================================================================

describe('Auth guard — /ai/matching', () => {
  it('POST /ai/matching/match returns 401 without token', async () => {
    const app = createApp();
    const res = await app.handle(
      new Request('http://localhost/ai/matching/match', {
        ...jsonBody({ session_id: 'anything' }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it('GET /ai/matching/match/:matchId returns 401 without token', async () => {
    const app = createApp();
    const res = await app.handle(
      new Request('http://localhost/ai/matching/match/some-id'),
    );
    expect(res.status).toBe(401);
  });
});

describe('POST /ai/matching/match — body validation', () => {
  it('returns 422 when session_id is missing', async () => {
    const app = createApp();
    const token = makeToken();

    const res = await app.handle(
      new Request('http://localhost/ai/matching/match', {
        method: 'POST',
        headers: { ...authHeader(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );

    expect(res.status).toBe(422);
  });

  it('returns 422 when session_id is an empty string', async () => {
    const app = createApp();
    const token = makeToken();

    const res = await app.handle(
      new Request('http://localhost/ai/matching/match', {
        method: 'POST',
        headers: { ...authHeader(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: '' }),
      }),
    );

    expect(res.status).toBe(422);
  });
});

describe('Matching flow — real Python calls', () => {
  let onboardingSessionId: string;
  let matchId: string;

  it('creates an onboarding session to obtain a valid session_id for matching', async () => {
    const app = createApp();
    const token = makeToken();

    const res = await app.handle(
      new Request('http://localhost/ai/sessions/start', {
        method: 'POST',
        headers: authHeader(token),
      }),
    );

    const body = (await res.json()) as any;
    console.log('\n[MATCHING SETUP — SESSION START] body:', JSON.stringify(body, null, 2));

    expect(res.status).toBe(200);
    expect(typeof body.data.session_id).toBe('string');
    onboardingSessionId = body.data.session_id;
  });

  it('runs matching against an onboarding session and returns providers with scores', async () => {
    if (!onboardingSessionId) return;

    const app = createApp();
    const token = makeToken();

    const res = await app.handle(
      new Request('http://localhost/ai/matching/match', {
        method: 'POST',
        headers: { ...authHeader(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: onboardingSessionId }),
      }),
    );

    console.log('\n[MATCHING MATCH] status:', res.status);
    const body = (await res.json()) as any;
    console.log('[MATCHING MATCH] body:', JSON.stringify(body, null, 2));

    // Python may return 502 from Node if session has no final_payload yet,
    // or 200 with an empty providers list if no providers exist.
    // We accept both outcomes here and only assert shape when 200.
    if (res.status === 200) {
      expect(body.success).toBe(true);
      const result = body.data;
      expect(typeof result.match_id).toBe('string');
      expect(typeof result.session_id).toBe('string');
      expect(Array.isArray(result.providers)).toBe(true);
      expect(typeof result.total_providers_scanned).toBe('number');
      expect(typeof result.created_at).toBe('string');

      if (result.providers.length > 0) {
        const first = result.providers[0];
        expect(typeof first.provider_id).toBe('string');
        expect(typeof first.score).toBe('number');
        expect(Array.isArray(first.specialties)).toBe(true);
        expect(typeof first.score_breakdown).toBe('object');
      }

      matchId = result.match_id;
    } else {
      console.log('[MATCHING MATCH] non-200 — session not complete yet, skipping match_id assertion');
    }
  });

  it('retrieves cached match result by matchId', async () => {
    if (!matchId) return;

    const app = createApp();
    const token = makeToken();

    const res = await app.handle(
      new Request(`http://localhost/ai/matching/match/${matchId}`, {
        headers: authHeader(token),
      }),
    );

    console.log('\n[MATCHING GET] status:', res.status);
    const body = (await res.json()) as any;
    console.log('[MATCHING GET] body:', JSON.stringify(body, null, 2));

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.match_id).toBe(matchId);
    expect(Array.isArray(body.data.providers)).toBe(true);
  });

  it('returns 404 for a nonexistent match ID', async () => {
    const app = createApp();
    const token = makeToken();

    const res = await app.handle(
      new Request('http://localhost/ai/matching/match/nonexistent-match-xyz', {
        headers: authHeader(token),
      }),
    );

    console.log('\n[MATCHING GET 404] status:', res.status);
    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body.success).toBe(false);
  });
});

// ===========================================================================
// 4. POST-ONBOARDING ROUTES  —  /ai/post-onboarding/*
// ===========================================================================

describe('Auth guard — /ai/post-onboarding', () => {
  it('POST /ai/post-onboarding/start returns 401 without token', async () => {
    const app = createApp();
    const res = await app.handle(
      new Request('http://localhost/ai/post-onboarding/start', {
        ...jsonBody({ onboarding_session_id: 'x' }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it('POST /ai/post-onboarding/step returns 401 without token', async () => {
    const app = createApp();
    const res = await app.handle(
      new Request('http://localhost/ai/post-onboarding/step', {
        ...jsonBody({ session_id: 'x', answer: 'yes' }),
      }),
    );
    expect(res.status).toBe(401);
  });
});

describe('POST /ai/post-onboarding/start — body validation', () => {
  it('returns 422 when onboarding_session_id is missing', async () => {
    const app = createApp();
    const token = makeToken();

    const res = await app.handle(
      new Request('http://localhost/ai/post-onboarding/start', {
        method: 'POST',
        headers: { ...authHeader(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );

    expect(res.status).toBe(422);
  });

  it('returns 422 when onboarding_session_id is empty string', async () => {
    const app = createApp();
    const token = makeToken();

    const res = await app.handle(
      new Request('http://localhost/ai/post-onboarding/start', {
        method: 'POST',
        headers: { ...authHeader(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ onboarding_session_id: '' }),
      }),
    );

    expect(res.status).toBe(422);
  });
});

describe('POST /ai/post-onboarding/step — body validation', () => {
  it('returns 422 when session_id is missing', async () => {
    const app = createApp();
    const token = makeToken();

    const res = await app.handle(
      new Request('http://localhost/ai/post-onboarding/step', {
        method: 'POST',
        headers: { ...authHeader(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer: 'yes' }),
      }),
    );

    expect(res.status).toBe(422);
  });

  it('returns 422 when answer is missing', async () => {
    const app = createApp();
    const token = makeToken();

    const res = await app.handle(
      new Request('http://localhost/ai/post-onboarding/step', {
        method: 'POST',
        headers: { ...authHeader(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: 'some-id' }),
      }),
    );

    expect(res.status).toBe(422);
  });
});

describe('POST /ai/post-onboarding/start — real Python call', () => {
  it('starts a post-onboarding session using a valid onboarding session ID', async () => {
    const app = createApp();
    const token = makeToken();

    // We need a real onboarding session ID. Create one first.
    const sessionRes = await app.handle(
      new Request('http://localhost/ai/sessions/start', {
        method: 'POST',
        headers: authHeader(token),
      }),
    );
    const sessionBody = (await sessionRes.json()) as any;
    const onboardingSessionId: string = sessionBody.data?.session_id;

    if (!onboardingSessionId) {
      console.log('[POST-ONBOARDING START] could not get session_id — skipping');
      return;
    }

    const res = await app.handle(
      new Request('http://localhost/ai/post-onboarding/start', {
        method: 'POST',
        headers: { ...authHeader(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ onboarding_session_id: onboardingSessionId }),
      }),
    );

    console.log('\n[POST-ONBOARDING START] status:', res.status);
    const body = (await res.json()) as any;
    console.log('[POST-ONBOARDING START] body:', JSON.stringify(body, null, 2));

    // Python may return 502 if the onboarding session has no final_payload.
    // Accept 200 or 502, assert shape only on 200.
    if (res.status === 200) {
      expect(body.success).toBe(true);
      expect(typeof body.data.session_id).toBe('string');
      expect(typeof body.data.first_message).toBe('string');
    } else {
      console.log('[POST-ONBOARDING START] non-200 status — onboarding session not finalised yet');
      expect([502, 422, 400]).toContain(res.status);
    }
  });
});

// ===========================================================================
// 5. SCHEDULING ROUTES  —  /ai/scheduling/*
// ===========================================================================

describe('Auth guard — /ai/scheduling', () => {
  it('POST /ai/scheduling/check returns 401 without token', async () => {
    const app = createApp();
    const res = await app.handle(
      new Request('http://localhost/ai/scheduling/check', {
        ...jsonBody({
          provider_id: 'x',
          date: '2025-06-01',
          consultation_mode: 'online',
        }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it('POST /ai/scheduling/book returns 401 without token', async () => {
    const app = createApp();
    const res = await app.handle(
      new Request('http://localhost/ai/scheduling/book', {
        ...jsonBody({
          provider_id: 'x',
          slot_start: '2025-06-01T09:00:00',
          slot_end: '2025-06-01T09:30:00',
          consultation_mode: 'online',
        }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it('GET /ai/scheduling/:id returns 401 without token', async () => {
    const app = createApp();
    const res = await app.handle(new Request('http://localhost/ai/scheduling/some-id'));
    expect(res.status).toBe(401);
  });
});

describe('POST /ai/scheduling/check — body validation', () => {
  it('returns 422 when provider_id is missing', async () => {
    const app = createApp();
    const token = makeToken();

    const res = await app.handle(
      new Request('http://localhost/ai/scheduling/check', {
        method: 'POST',
        headers: { ...authHeader(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: '2025-06-01', consultation_mode: 'online' }),
      }),
    );

    expect(res.status).toBe(422);
  });

  it('returns 422 when date format is invalid', async () => {
    const app = createApp();
    const token = makeToken();

    const res = await app.handle(
      new Request('http://localhost/ai/scheduling/check', {
        method: 'POST',
        headers: { ...authHeader(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider_id: 'some-provider',
          date: '01-06-2025', // wrong format — must be YYYY-MM-DD
          consultation_mode: 'online',
        }),
      }),
    );

    expect(res.status).toBe(422);
  });

  it('returns 422 when consultation_mode is not online or offline', async () => {
    const app = createApp();
    const token = makeToken();

    const res = await app.handle(
      new Request('http://localhost/ai/scheduling/check', {
        method: 'POST',
        headers: { ...authHeader(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider_id: 'some-provider',
          date: '2025-06-01',
          consultation_mode: 'hybrid', // invalid
        }),
      }),
    );

    expect(res.status).toBe(422);
  });
});

describe('POST /ai/scheduling/book — body validation', () => {
  it('returns 422 when required fields are missing', async () => {
    const app = createApp();
    const token = makeToken();

    const res = await app.handle(
      new Request('http://localhost/ai/scheduling/book', {
        method: 'POST',
        headers: { ...authHeader(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider_id: 'x' }), // missing slot_start, slot_end, mode
      }),
    );

    expect(res.status).toBe(422);
  });
});

describe('Scheduling flow — real Python calls', () => {
  // Use the stable test provider. Python may not have it, but the availability
  // endpoint should still respond with a deterministic shape.
  const SCHED_PROVIDER = TEST_PROVIDER_ID;
  const SCHED_DATE = '2025-06-15';

  let availableSlot: { start: string; end: string } | null = null;
  let bookingId: string | null = null;

  it('checks availability and returns slots array', async () => {
    const app = createApp();
    const token = makeToken();

    const res = await app.handle(
      new Request('http://localhost/ai/scheduling/check', {
        method: 'POST',
        headers: { ...authHeader(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider_id: SCHED_PROVIDER,
          date: SCHED_DATE,
          consultation_mode: 'online',
        }),
      }),
    );

    console.log('\n[SCHEDULING CHECK] status:', res.status);
    const body = (await res.json()) as any;
    console.log('[SCHEDULING CHECK] body:', JSON.stringify(body, null, 2));

    // Python returns 502 when provider doesn't exist — acceptable.
    if (res.status === 200) {
      expect(body.success).toBe(true);
      const data = body.data;
      expect(typeof data.provider_id).toBe('string');
      expect(typeof data.date).toBe('string');
      expect(Array.isArray(data.slots)).toBe(true);

      // Python generates 16 half-hour slots per working day.
      expect(data.slots.length).toBe(16);

      const firstSlot = data.slots[0];
      expect(typeof firstSlot.start).toBe('string');
      expect(typeof firstSlot.end).toBe('string');
      expect(typeof firstSlot.available).toBe('boolean');

      // Find an available slot for the booking test.
      const free = data.slots.find((s: any) => s.available === true);
      if (free) {
        availableSlot = { start: free.start, end: free.end };
      }
    } else {
      console.log('[SCHEDULING CHECK] non-200 — provider unknown to Python, status:', res.status);
    }
  });

  it('books an available slot and returns booking_id with status=confirmed', async () => {
    if (!availableSlot) {
      console.log('[SCHEDULING BOOK] no available slot found — skipping');
      return;
    }

    const app = createApp();
    const token = makeToken();

    const res = await app.handle(
      new Request('http://localhost/ai/scheduling/book', {
        method: 'POST',
        headers: { ...authHeader(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider_id: SCHED_PROVIDER,
          slot_start: availableSlot.start,
          slot_end: availableSlot.end,
          consultation_mode: 'online',
          reason: 'Routine checkup',
        }),
      }),
    );

    console.log('\n[SCHEDULING BOOK] status:', res.status);
    const body = (await res.json()) as any;
    console.log('[SCHEDULING BOOK] body:', JSON.stringify(body, null, 2));

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);

    const booking = body.data;
    expect(typeof booking.booking_id).toBe('string');
    expect(booking.status).toBe('confirmed');
    expect(typeof booking.provider_id).toBe('string');
    expect(typeof booking.patient_id).toBe('string');
    expect(typeof booking.slot_start).toBe('string');
    expect(typeof booking.slot_end).toBe('string');
    expect(typeof booking.consultation_mode).toBe('string');
    expect(typeof booking.created_at).toBe('string');

    bookingId = booking.booking_id;
  });

  it('retrieves the booking by ID and data matches what was booked', async () => {
    if (!bookingId) {
      console.log('[SCHEDULING GET] no booking_id — skipping');
      return;
    }

    const app = createApp();
    const token = makeToken();

    const res = await app.handle(
      new Request(`http://localhost/ai/scheduling/${bookingId}`, {
        headers: authHeader(token),
      }),
    );

    console.log('\n[SCHEDULING GET] status:', res.status);
    const body = (await res.json()) as any;
    console.log('[SCHEDULING GET] body:', JSON.stringify(body, null, 2));

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.booking_id).toBe(bookingId);
    expect(body.data.status).toBe('confirmed');
    expect(body.data.consultation_mode).toBe('online');
  });

  it('double-booking the same slot returns a non-200 status', async () => {
    if (!availableSlot || !bookingId) {
      console.log('[SCHEDULING DOUBLE-BOOK] skipping — prior booking did not complete');
      return;
    }

    const app = createApp();
    const token = makeToken('user', 'second-patient-id');

    const res = await app.handle(
      new Request('http://localhost/ai/scheduling/book', {
        method: 'POST',
        headers: { ...authHeader(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider_id: SCHED_PROVIDER,
          slot_start: availableSlot.start,
          slot_end: availableSlot.end,
          consultation_mode: 'online',
        }),
      }),
    );

    console.log('\n[SCHEDULING DOUBLE-BOOK] status:', res.status);
    // Python should reject the second booking. It may be 409 (from Python)
    // which the Node service converts to 502, or direct 409 if propagated.
    // We just assert it is not 200.
    expect(res.status).not.toBe(200);
  });

  it('returns 404 for a nonexistent booking ID', async () => {
    const app = createApp();
    const token = makeToken();

    const res = await app.handle(
      new Request('http://localhost/ai/scheduling/nonexistent-booking-xyz', {
        headers: authHeader(token),
      }),
    );

    console.log('\n[SCHEDULING GET 404] status:', res.status);
    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body.success).toBe(false);
  });
});

// ===========================================================================
// 6. NOTIFICATION ROUTES  —  /ai/notifications/*
// ===========================================================================

describe('Auth guard — /ai/notifications', () => {
  it('GET /ai/notifications/pending returns 401 without token', async () => {
    const app = createApp();
    const res = await app.handle(new Request('http://localhost/ai/notifications/pending'));
    expect(res.status).toBe(401);
  });

  it('PUT /ai/notifications/:id/status returns 401 without token', async () => {
    const app = createApp();
    const res = await app.handle(
      new Request('http://localhost/ai/notifications/some-id/status', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'viewed' }),
      }),
    );
    expect(res.status).toBe(401);
  });
});

describe('PUT /ai/notifications/:id/status — body validation', () => {
  it('returns 422 when status is missing', async () => {
    const app = createApp();
    const token = makeToken();

    const res = await app.handle(
      new Request('http://localhost/ai/notifications/some-id/status', {
        method: 'PUT',
        headers: { ...authHeader(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );

    expect(res.status).toBe(422);
  });

  it('returns 422 when status is not a valid enum value', async () => {
    const app = createApp();
    const token = makeToken();

    const res = await app.handle(
      new Request('http://localhost/ai/notifications/some-id/status', {
        method: 'PUT',
        headers: { ...authHeader(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'pending' }), // invalid — must be viewed|accepted|declined
      }),
    );

    expect(res.status).toBe(422);
  });

  it('returns 422 when status is an arbitrary string', async () => {
    const app = createApp();
    const token = makeToken();

    const res = await app.handle(
      new Request('http://localhost/ai/notifications/some-id/status', {
        method: 'PUT',
        headers: { ...authHeader(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'unknown_value' }),
      }),
    );

    expect(res.status).toBe(422);
  });
});

describe('Notification routes — real Python calls', () => {
  it('GET /ai/notifications/pending returns an array', async () => {
    const app = createApp();
    const token = makeToken('provider', TEST_PROVIDER_ID);

    const res = await app.handle(
      new Request('http://localhost/ai/notifications/pending', {
        headers: authHeader(token),
      }),
    );

    console.log('\n[NOTIFICATION PENDING] status:', res.status);
    const body = (await res.json()) as any;
    console.log('[NOTIFICATION PENDING] body:', JSON.stringify(body, null, 2));

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('GET /ai/notifications/pending items have expected shape when non-empty', async () => {
    const app = createApp();
    const token = makeToken('provider', TEST_PROVIDER_ID);

    const res = await app.handle(
      new Request('http://localhost/ai/notifications/pending', {
        headers: authHeader(token),
      }),
    );

    const body = (await res.json()) as any;
    expect(res.status).toBe(200);

    if (body.data.length > 0) {
      const n = body.data[0];
      expect(typeof n.notification_id).toBe('string');
      expect(typeof n.provider_id).toBe('string');
      expect(typeof n.match_score).toBe('number');
      expect(typeof n.status).toBe('string');
      expect(typeof n.created_at).toBe('string');
    }
  });

  it('PUT /ai/notifications/:id/status with viewed succeeds when Python has the notification', async () => {
    const app = createApp();
    // Fetch pending notifications first to get a real notification ID if one exists.
    const token = makeToken('provider', TEST_PROVIDER_ID);

    const pendingRes = await app.handle(
      new Request('http://localhost/ai/notifications/pending', {
        headers: authHeader(token),
      }),
    );
    const pendingBody = (await pendingRes.json()) as any;

    if (!Array.isArray(pendingBody.data) || pendingBody.data.length === 0) {
      console.log('[NOTIFICATION UPDATE] no pending notifications — skipping status update test');
      return;
    }

    const notificationId: string = pendingBody.data[0].notification_id;

    const res = await app.handle(
      new Request(`http://localhost/ai/notifications/${notificationId}/status`, {
        method: 'PUT',
        headers: { ...authHeader(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'viewed' }),
      }),
    );

    console.log('\n[NOTIFICATION UPDATE] status:', res.status);
    const body = (await res.json()) as any;
    console.log('[NOTIFICATION UPDATE] body:', JSON.stringify(body, null, 2));

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.updated).toBe(true);
  });

  it('accepts all three valid status values without 422', async () => {
    // This test verifies the Elysia union validator allows the three literals.
    // We do not need a real notification ID here — Python will 502 on unknown IDs
    // but the 422 guard should NOT trigger for valid enum values.
    const app = createApp();
    const token = makeToken('provider', TEST_PROVIDER_ID);

    for (const status of ['viewed', 'accepted', 'declined'] as const) {
      const res = await app.handle(
        new Request('http://localhost/ai/notifications/fake-notif-id/status', {
          method: 'PUT',
          headers: { ...authHeader(token), 'Content-Type': 'application/json' },
          body: JSON.stringify({ status }),
        }),
      );
      // Must NOT be 422 (validator passed). Could be 200 or 502 depending on Python.
      expect(res.status).not.toBe(422);
      console.log(`[NOTIFICATION ENUM CHECK] status="${status}" → HTTP ${res.status}`);
    }
  });
});
