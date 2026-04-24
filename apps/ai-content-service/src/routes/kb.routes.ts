import { Elysia, t } from 'elysia';
import { requireAuth, requireRole } from '@longeny/middleware';
import type { KbController } from '../controllers/kb.controller.js';

export function createKbRoutes(controller: KbController): Elysia {
  return new Elysia({ prefix: '/ai/kb' })
    .use(requireAuth())
    .post(
      '/upload',
      ({ body, store }) => controller.upload({ body, store } as any),
      {
        body: t.Object({
          file: t.File({ maxSize: '50m' }),
          title: t.Optional(t.String()),
          description: t.Optional(t.String()),
          collection_name: t.Optional(t.String()),
        }),
      },
    )
    .get('/status/:jobId', ({ params }) => controller.getStatus({ params }));
}
