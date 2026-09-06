import { requireAuth, requireRole } from '@longeny/middleware';
import { Elysia, t } from 'elysia';
import type { KbController } from '../controllers/kb.controller.js';

export function createKbRoutes(controller: KbController) {
  return new Elysia({ prefix: '/ai/kb', detail: { tags: ['knowledge-base'] } })
    .use(requireAuth())
    .post('/upload', ({ body, store }) => controller.upload({ body, store } as any), {
      body: t.Object({
        file: t.File({ maxSize: '50m' }),
        title: t.Optional(t.String()),
        description: t.Optional(t.String()),
        collection_name: t.Optional(t.String()),
      }),
      detail: {
        summary: 'Upload document to knowledge base',
        description:
          'Uploads a medical document for ingestion into ChromaDB. Supports PDF, DOCX, TXT (max 50MB). Returns a job ID for tracking ingestion status.',
      },
    })
    .get('/status/:jobId', ({ params }) => controller.getStatus({ params }), {
      detail: {
        summary: 'Get ingestion job status',
        description:
          'Returns the processing status of a KB ingestion job: pending, processing, completed, or failed.',
      },
    });
}
