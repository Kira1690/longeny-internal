import { Elysia, t } from 'elysia';
import { requireAuth } from '@longeny/middleware';
import type { RagController } from '../controllers/rag.controller.js';

export function createRagRoutes(controller: RagController): Elysia {
  return new Elysia({ prefix: '/ai' })
    .use(requireAuth())
    .post(
      '/patient/query',
      ({ body }) => controller.query({ body }),
      {
        body: t.Object({
          query: t.String({ minLength: 3 }),
          collection_name: t.Optional(t.String()),
          k: t.Optional(t.Number({ minimum: 1, maximum: 20 })),
        }),
      },
    );
}
