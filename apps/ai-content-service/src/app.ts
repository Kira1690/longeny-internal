import { Elysia } from 'elysia';
import { requestLogger, corsMiddleware, errorHandler } from '@longeny/middleware';
import { config } from './config/index.js';
import { createRoutes } from './routes/index.js';

export function createApp(): Elysia {
  const origins = config.CORS_ORIGIN.split(',').map((o: string) => o.trim());

  const app = new Elysia()
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
