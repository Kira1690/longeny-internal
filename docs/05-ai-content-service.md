# AI Content Service — Developer Reference

Service: `ai-content-service` (Node/Elysia)  
Port: `3004`  
Swagger: `http://localhost:3004/docs`  
Health: `http://localhost:3004/health`

---

## Role

This service is the authenticated gateway to all AI features. It validates JWTs, handles file uploads to S3, manages Redis job state, and proxies requests to the Python AI engine (`bravelabs-agent` on port 8080).

All AI computation happens in Python. This service owns: auth, S3, Redis job status, and response shaping.

---

## Dependencies

All AI endpoints require:
1. **Bearer token** — JWT signed with `JWT_ACCESS_SECRET`
2. **Python agent running** — `bravelabs-agent` on `http://localhost:8080`

---

## Endpoints

### Health

```
GET /health
```

No auth required.

```json
{ "success": true, "data": { "status": "healthy" } }
```

---

### Onboarding

#### Start session

```
POST /ai/onboarding/start
Authorization: Bearer <token>
```

Proxies to Python `POST /ai/onboarding/session`.

**Response 200:**
```json
{
  "success": true,
  "data": {
    "session_id": "ba7b9f37-...",
    "first_question": "Hi, I'm Aria! May I know your name..."
  }
}
```

#### Submit answer + receive SSE stream

```
POST /ai/onboarding/step
Authorization: Bearer <token>
Content-Type: application/json

{
  "session_id": "ba7b9f37-...",
  "answer": "My name is Rahul, asking for myself, I am 35"
}
```

Returns `text/event-stream`. Node saves the answer to Python then pipes the SSE stream from Python back to the client.

SSE events: `token`, `message_done`, `tool_call`, `tool_result`, `tool_error`, `final_payload`, `error`

#### Get final payload

```
GET /ai/onboarding/session/:id
Authorization: Bearer <token>
```

**Response 200** (session complete):
```json
{
  "success": true,
  "data": {
    "session_id": "...",
    "is_complete": true,
    "final_payload": {
      "name": "Rahul",
      "for_whom": "self",
      "age_group": "adult",
      "symptoms": [{ "name": "headache", "severity": "moderate", "duration": "3 days" }],
      "conditions": [],
      "urgency_flag": false
    }
  }
}
```

**Response 404** (not yet complete — do more `/step` calls):
```json
{
  "success": false,
  "error": { "code": "NOT_FOUND", "message": "Session not found or not yet complete" }
}
```

---

### Knowledge Base

#### Upload document

```
POST /ai/kb/upload
Authorization: Bearer <token>   (role: provider or admin)
Content-Type: multipart/form-data

file:             <binary>      required  PDF, text, markdown, max 50MB
title:            string        optional
description:      string        optional
collection_name:  string        optional  default: "knowledge_base"
```

Flow:
1. Node validates file type and size
2. Node uploads bytes to S3 at `longeny-uploads/kb/{timestamp}-{filename}`
3. Node generates job_id, writes Redis `kb:status:{job_id} = queued`
4. Node calls Python `POST /ai/kb/ingest` (fire and forget)
5. Returns immediately

**Response 200:**
```json
{
  "success": true,
  "data": {
    "job_id": "550e8400-...",
    "status": "queued",
    "s3_key": "kb/1714000000-headache_guide.pdf"
  }
}
```

**Errors:**
- `401` — missing/invalid token
- `403` — user does not have `provider` or `admin` role
- `400` — unsupported file type or file exceeds 50MB

#### Poll job status

```
GET /ai/kb/status/:jobId
Authorization: Bearer <token>
```

Reads from Redis. No Python call.

**Response 200:**
```json
{
  "success": true,
  "data": {
    "status": "completed",
    "chunks_indexed": 12,
    "completed_at": "2026-04-24T10:30:00.000Z"
  }
}
```

Status values: `queued` → `processing` → `completed` | `failed`

**Response 404** — job not in Redis (never queued or TTL expired):
```json
{
  "success": false,
  "error": { "code": "NOT_FOUND", "message": "Job not found or expired" }
}
```

---

### Patient RAG Query

```
POST /ai/patient/query
Authorization: Bearer <token>
Content-Type: application/json

{
  "query": "What medications are recommended for tension headaches?",
  "collection_name": "knowledge_base",   // optional
  "k": 5                                 // optional, 1-20
}
```

Proxies to Python `POST /ai/rag/query`. Python embeds the query, searches ChromaDB, and generates a grounded answer via Nova Pro.

**Response 200:**
```json
{
  "success": true,
  "data": {
    "answer": "For tension headaches, paracetamol 500mg every 4-6 hours is recommended...",
    "citations": [
      {
        "source": "kb/1714000000-headache_guide.pdf",
        "excerpt": "Tension headaches are the most common type...",
        "score": 0.91,
        "chunk_id": "job-abc123-chunk-2"
      }
    ],
    "emergency": false
  }
}
```

**Response 200 (emergency)**:
```json
{
  "success": true,
  "data": {
    "answer": "This sounds like a medical emergency...",
    "citations": [],
    "emergency": true
  }
}
```

**Errors:**
- `400` — query rejected by guardrail (injection or off-topic)
- `422` — query too short (min 3 chars)

---

## Error Response Shape

All errors follow:
```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message"
  },
  "meta": {
    "timestamp": "ISO-8601",
    "requestId": "correlation-id"
  }
}
```

| HTTP | Code | When |
|------|------|------|
| 400 | `INVALID_FILE_TYPE` | Unsupported MIME type on upload |
| 400 | `FILE_TOO_LARGE` | File exceeds 50MB |
| 401 | `UNAUTHORIZED` | Missing or invalid JWT |
| 403 | `FORBIDDEN` | Insufficient role |
| 404 | `NOT_FOUND` | Job/session not found |
| 500 | `INTERNAL_ERROR` | Unexpected server error |

---

## Environment Variables

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `JWT_ACCESS_SECRET` | Yes | — | JWT signing secret (must match auth-service) |
| `AI_AGENT_URL` | Yes | — | Python agent URL (`http://localhost:8080`) |
| `S3_UPLOADS_BUCKET` | Yes | — | S3 bucket for KB uploads (`longeny-uploads`) |
| `AWS_ACCESS_KEY_ID` | Yes | — | AWS credentials |
| `AWS_SECRET_ACCESS_KEY` | Yes | — | AWS credentials |
| `AWS_REGION` | Yes | — | AWS region (`ap-south-1`) |
| `REDIS_HOST` | No | `localhost` | Redis host |
| `REDIS_PORT` | No | `6379` | Redis port |
| `AI_CONTENT_SERVICE_PORT` | No | `3004` | Service port |

---

## Running Locally

```bash
cd longeny-internal/apps/ai-content-service
bun run dev
```

For integration tests (needs Python agent + Bedrock + Redis + S3):

```bash
bun test tests/integration/ --env-file .env.test
```

Test results: 12 tests, 0 failures. Tests cover auth guards, real S3 upload, real Bedrock embed, real ChromaDB query, real Redis status polling.

---

## Integration Test Files

| File | What it tests |
|------|--------------|
| `tests/integration/onboarding.test.ts` | Auth guard, real Nova Pro session start, finalize before complete → 404 |
| `tests/integration/kb.test.ts` | Auth guard, real S3 upload + Python ingest + Redis poll until `completed` |
| `tests/integration/rag.test.ts` | Auth guard, real Bedrock + ChromaDB + Nova Pro answer with citations, emergency detection, short query rejection |
