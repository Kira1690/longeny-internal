import { createLogger } from '@longeny/utils';
import Elysia from 'elysia';
import { requestCtx } from './request-context.js';

/** One audited request, as handed to the sink and written to the log. */
export interface AuditEntry {
  action: string;
  resourceType?: string;
  purpose: string;
  /** Authenticated account, or 'anonymous' when the request never authenticated. */
  actorId: string;
  actorRole?: string;
  /** Subject of care whose data was touched, when the route names one. */
  profileId?: string;
  /** Resource id from the route params, when the route names one. */
  resourceId?: string;
  method: string;
  path: string;
  statusCode: number;
  /** False for denials — the rows that matter most in an access review. */
  success: boolean;
  durationMs: number;
  ip: string;
  userAgent: string;
  correlationId?: string;
  occurredAt: Date;
}

export interface AuditConfig {
  action: string;
  resourceType?: string;
  purpose?: string;
  /**
   * Durable writer. Without one the entry only reaches stdout, which is not an
   * audit trail: a health-data access review needs rows that can be queried and
   * retained. Services that touch health data must pass a sink.
   *
   * Failures are logged and swallowed — an audit write must never take down the
   * request it is recording.
   */
  sink?: (entry: AuditEntry) => void | Promise<void>;
  /**
   * Route param holding the resource id, when it is not `id`. Naming it also
   * stops that id being mistaken for a profile id.
   */
  resourceParam?: string;
  /**
   * False when the handler writes its own success row before answering — a
   * download link must not leave without its audit row — so only failures are
   * recorded here.
   */
  recordSuccess?: boolean;
}

const auditLogger = createLogger('audit');

/**
 * Elysia plugin: record an audit trail entry after the request completes,
 * including denials (401/403/404), which are what an access review looks for.
 */
export const auditLog = (config: AuditConfig) =>
  new Elysia({ name: `audit-log-${config.action}` })
    .onBeforeHandle({ as: 'scoped' }, ({ request }) => {
      requestCtx(request).auditStartTime = Date.now();
    })
    .onAfterResponse({ as: 'scoped' }, async (ctx) => {
      const { request, set } = ctx;
      const state = requestCtx(request);
      const params = (ctx as { params?: Record<string, string> }).params ?? {};
      const status = typeof set.status === 'number' ? set.status : 200;
      const success = status >= 200 && status < 400;
      if (success && config.recordSuccess === false) return;
      const resourceId = config.resourceParam ? params[config.resourceParam] : params.id;

      const entry: AuditEntry = {
        action: config.action,
        resourceType: config.resourceType,
        purpose: config.purpose || 'service_operation',
        actorId: state.userId || 'anonymous',
        actorRole: state.userRole || undefined,
        // Collection routes carry no id param; without this fallback their rows
        // land with a null profile_id, which is the column an access review filters on.
        profileId:
          state.auditProfileId ||
          params.profileId ||
          (config.resourceParam ? undefined : params.id) ||
          state.activeProfileId ||
          undefined,
        resourceId: resourceId ?? undefined,
        method: request.method,
        path: new URL(request.url).pathname,
        statusCode: status,
        success,
        durationMs: Date.now() - (state.auditStartTime || Date.now()),
        ip:
          request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
          request.headers.get('X-Real-IP') ||
          'unknown',
        userAgent: request.headers.get('User-Agent') || 'unknown',
        correlationId:
          state.correlationId || (request.headers.get('X-Correlation-ID') ?? undefined),
        occurredAt: new Date(),
      };

      auditLogger.info({ audit: true, ...entry });

      if (config.sink) {
        try {
          await config.sink(entry);
        } catch (error) {
          auditLogger.error({ error, action: config.action }, 'Audit sink write failed');
        }
      }
    });
