import { swagger } from '@elysiajs/swagger';
import { corsMiddleware, errorHandler, requestContext, requestLogger } from '@longeny/middleware';
import { Elysia } from 'elysia';
import { config } from './config/index.js';
import { createRoutes } from './routes/index.js';

export function createApp() {
  const origins = config.CORS_ORIGIN.split(',').map((o: string) => o.trim());

  const app = new Elysia()
    .use(
      swagger({
        path: '/docs',
        documentation: {
          info: { title: 'Longeny AI Content Service', version: '1.0.0' },
          tags: [
            { name: 'onboarding', description: 'Patient onboarding via Aria AI agent' },
            { name: 'sessions', description: 'Onboarding session history and tracking' },
            {
              name: 'post-onboarding',
              description: 'Health tips and consultation prep after onboarding',
            },
            { name: 'provider-profiles', description: 'Provider AI profile management' },
            { name: 'matching', description: 'Patient-provider matching algorithm' },
            { name: 'scheduling', description: 'Appointment availability and booking' },
            { name: 'notifications', description: 'Provider notification management' },
            { name: 'knowledge-base', description: 'KB document upload and ingestion' },
            { name: 'rag', description: 'Patient RAG queries against knowledge base' },
            {
              name: 'intake',
              description: 'RRO intake — the answers a classification derives from',
            },
            { name: 'rro-ai', description: 'RRO classifier and pre-consult summary' },
            {
              name: 'benchmarks',
              description: 'Report readings judged against reference ranges',
            },
          ],
        },
      }),
    )
    .use(errorHandler())
    .use(requestContext())
    .use(requestLogger('ai-content-service'))
    .use(corsMiddleware(origins))
    .get('/health', () => ({
      success: true,
      data: {
        status: 'healthy',
        service: 'ai-content-service',
        version: '0.0.1',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
      },
    }))
    .use(createRoutes());

  return app;
}
