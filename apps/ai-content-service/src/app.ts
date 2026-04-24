import { Elysia } from 'elysia';
import { swagger } from '@elysiajs/swagger';
import { requestLogger, corsMiddleware, errorHandler } from '@longeny/middleware';
import { config } from './config/index.js';
import { createRoutes } from './routes/index.js';

export function createApp(): Elysia {
  const origins = config.CORS_ORIGIN.split(',').map((o: string) => o.trim());

  const app = new Elysia()
    .use(swagger({
      path: '/docs',
      documentation: {
        info: { title: 'Longeny AI Content Service', version: '1.0.0' },
        tags: [
          { name: 'onboarding', description: 'Patient onboarding via Aria AI agent' },
          { name: 'knowledge-base', description: 'KB document upload and ingestion' },
          { name: 'rag', description: 'Patient RAG queries against knowledge base' },
        ],
      },
    }))
    .use(errorHandler())
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
