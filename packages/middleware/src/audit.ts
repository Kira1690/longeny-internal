import Elysia from 'elysia';
import { createLogger } from '@longeny/utils';
import { authStore } from './auth.js';

export interface AuditConfig {
  action: string;
  resourceType?: string;
  purpose?: string;
}

const auditLogger = createLogger('audit');

/**
 * Elysia plugin: log audit trail after request completes.
 * Includes userId, action, resource, IP, user-agent, result, and GDPR purpose field.
 */
export const auditLog = (config: AuditConfig) =>
  new Elysia({ name: `audit-log-${config.action}` })
    .use(authStore())
    .state('auditStartTime', 0)
    .onBeforeHandle(({ store }) => {
      store.auditStartTime = Date.now();
    })
    .onAfterResponse(({ request, set, store }) => {
      const duration = Date.now() - (store.auditStartTime || Date.now());
      const userId = store.userId;
      const status = typeof set.status === 'number' ? set.status : 200;
      const success = status >= 200 && status < 400;

      auditLogger.info({
        audit: true,
        action: config.action,
        resourceType: config.resourceType,
        purpose: config.purpose || 'service_operation',
        userId: userId || 'anonymous',
        method: request.method,
        path: new URL(request.url).pathname,
        statusCode: status,
        success,
        duration,
        ip:
          request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
          request.headers.get('X-Real-IP') ||
          'unknown',
        userAgent: request.headers.get('User-Agent') || 'unknown',
        correlationId: request.headers.get('X-Correlation-ID'),
      });
    });
