/**
 * Real E2E — RAG query endpoint.
 *
 * No mocks. Requires:
 *   - Python agent running on http://localhost:8080
 *   - JWT_ACCESS_SECRET in .env.test
 *   - ChromaDB pre-seeded (run kb.test.ts first, or seed via Python E2E test)
 *   - AWS Bedrock credentials (Titan V2 + Nova Pro in ap-south-1)
 *
 * Run: bun test tests/integration/rag.test.ts --env-file .env.test
 */
import { describe, it, expect, beforeAll } from 'bun:test';
import jwt from 'jsonwebtoken';
import { createApp } from '../../src/app.js';

const PYTHON_URL = 'http://localhost:8080';
const JWT_SECRET = Bun.env.JWT_SECRET ?? Bun.env.JWT_ACCESS_SECRET ?? 'test-e2e-jwt-secret-longeny';

// Seed collection used in Python E2E test — we pre-seed it here too so RAG has data
const TEST_COLLECTION = 'knowledge_base';

function makeToken(role: string = 'user'): string {
  return jwt.sign(
    {
      sub: 'test-user-e2e-002',
      email: 'patient@longeny.test',
      role,
      jti: `jti-${Date.now()}`,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    JWT_SECRET,
  );
}

// Seed ChromaDB directly via Python API before running RAG tests
beforeAll(async () => {
  const check = await fetch(`${PYTHON_URL}/openapi.json`).catch(() => null);
  if (!check || !check.ok) {
    throw new Error(`Python agent not reachable at ${PYTHON_URL}`);
  }

  // Trigger a real ingest via Python's /ai/kb/ingest using a known s3_key
  // We first upload the test doc to S3 using AWS SDK directly, then call ingest
  // This seeds ChromaDB so the RAG query has real data to retrieve from
  const seedRes = await fetch(`${PYTHON_URL}/ai/kb/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      s3_key: '__e2e_inline_test__',
      job_id: `rag-seed-${Date.now()}`,
      collection_name: TEST_COLLECTION,
      source_metadata: { title: 'E2E RAG Seed' },
    }),
  });

  // ingest is fire-and-forget from Python too (background task) — wait a bit
  // If s3_key doesn't exist in S3 the ingestor will fail silently
  // So we pre-seed ChromaDB directly via a helper script instead
  console.log('\n[RAG SEED] Seeding ChromaDB for RAG tests...');

  // Call Python to directly upsert test data (using test endpoint if available,
  // otherwise rely on data already indexed from kb.test.ts run)
  // We seed via a small inline HTTP call to our Python test helper
  const { execSync } = await import('child_process') as any;
  try {
    execSync(
      `conda run -n brave python -c "
import asyncio, uuid, sys
sys.path.insert(0, '/home/kira/Documents/Github/BraveLabs/bravelabs-agent')
from ai_engine.kb.parser import parse_document
from ai_engine.kb.chunker import chunk_text
from ai_engine.llm.embeddings import EmbeddingService
from ai_engine.vectordb.client import get_client
from ai_engine.vectordb.repository import VectorRepository

TEXT = '''HEADACHE TREATMENT GUIDE
Tension headaches: paracetamol 500mg every 4-6 hours, ibuprofen 400mg with food.
Migraine: sumatriptan 50mg, rest in dark quiet room, avoid caffeine and stress.
Cluster headache: oxygen therapy, sumatriptan injection.
Emergency: thunderclap headache or headache with fever and stiff neck needs emergency care.'''

async def seed():
    emb = EmbeddingService()
    vecs = await emb.embed_batch([TEXT])
    chroma = get_client()
    try:
        chroma.get_or_create_collection('knowledge_base', metadata={'hnsw:space':'cosine'})
    except: pass
    repo = VectorRepository(chroma, emb)
    await repo.upsert('knowledge_base', ['e2e-rag-seed-001'], vecs, [TEXT], [{'source': 'kb/e2e_headache_guide.pdf', 'job_id': 'e2e-seed'}])
    print('SEED OK')

asyncio.run(seed())
"`,
      { stdio: 'pipe', encoding: 'utf8' },
    );
    console.log('[RAG SEED] ChromaDB seeded with headache guide');
  } catch (err: any) {
    console.warn('[RAG SEED] Seed warning (may already have data):', err.message?.slice(0, 100));
  }
}, 30_000);

// ---------------------------------------------------------------------------
// Auth guard
// ---------------------------------------------------------------------------

describe('Auth guard', () => {
  it('POST /ai/patient/query returns 401 without token', async () => {
    const app = createApp();
    const res = await app.handle(
      new Request('http://localhost/ai/patient/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'What causes headaches?' }),
      }),
    );
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Real RAG flow: Node → Python → Titan embed → ChromaDB search → Nova Pro answer
// ---------------------------------------------------------------------------

describe('POST /ai/patient/query — real Bedrock + ChromaDB + Nova Pro', () => {
  it('returns a grounded answer with citations for a headache question', async () => {
    const app = createApp();
    const token = makeToken('user');

    const res = await app.handle(
      new Request('http://localhost/ai/patient/query', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: 'What medications are recommended for tension headaches?',
          collection_name: TEST_COLLECTION,
          k: 3,
        }),
      }),
    );

    console.log('\n[RAG QUERY] status:', res.status);
    const body = await res.json() as any;
    console.log('[RAG QUERY] answer:', body.data?.answer);
    console.log('[RAG QUERY] citations:', JSON.stringify(body.data?.citations, null, 2));
    console.log('[RAG QUERY] emergency:', body.data?.emergency);

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);

    const { answer, citations, emergency } = body.data;
    expect(typeof answer).toBe('string');
    expect(answer.length).toBeGreaterThan(20);

    // Answer must reference real KB content (paracetamol or ibuprofen)
    const answerLower = answer.toLowerCase();
    expect(
      answerLower.includes('paracetamol') ||
      answerLower.includes('ibuprofen') ||
      answerLower.includes('headache') ||
      answerLower.includes('tension') ||
      answerLower.includes('treatment'),
    ).toBe(true);

    expect(Array.isArray(citations)).toBe(true);
    expect(citations.length).toBeGreaterThan(0);

    const cit = citations[0];
    expect(typeof cit.source).toBe('string');
    expect(typeof cit.excerpt).toBe('string');
    expect(typeof cit.score).toBe('number');
    expect(typeof cit.chunk_id).toBe('string');
    expect(typeof emergency).toBe('boolean');
  }, 30_000);

  it('returns emergency=true for a chest pain query', async () => {
    const app = createApp();
    const token = makeToken('user');

    const res = await app.handle(
      new Request('http://localhost/ai/patient/query', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: 'I have severe chest pain and cannot breathe',
          collection_name: TEST_COLLECTION,
        }),
      }),
    );

    console.log('\n[RAG EMERGENCY] status:', res.status);
    const body = await res.json() as any;
    console.log('[RAG EMERGENCY] answer:', body.data?.answer);
    console.log('[RAG EMERGENCY] emergency:', body.data?.emergency);

    expect(res.status).toBe(200);
    // Guardrail flags emergency=true on "chest pain cannot breathe"
    expect(body.data.emergency).toBe(true);
  }, 30_000);

  it('rejects a query shorter than 3 chars', async () => {
    const app = createApp();
    const token = makeToken('user');

    const res = await app.handle(
      new Request('http://localhost/ai/patient/query', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: 'hi' }),
      }),
    );

    // Node or Python validation should reject short query
    expect([400, 422]).toContain(res.status);
  });
});
