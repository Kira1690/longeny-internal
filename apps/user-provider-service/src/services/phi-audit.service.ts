import type { AuditEntry } from '@longeny/middleware';
import { createLogger } from '@longeny/utils';
import { db } from '../db/index.js';
import { phi_access_log } from '../db/schema.js';

const logger = createLogger('phi-audit');

/** Only a well-formed UUID belongs in the profile_id column. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Durable sink for `auditLog()`. Writes one append-only row per request that
 * touched health data — successful reads and writes, and denials.
 *
 * Never throws: a failed audit write is logged and swallowed by the middleware,
 * because losing the request is worse than losing the row, but the failure is
 * visible in the service log.
 */
export async function writePhiAccessLog(entry: AuditEntry): Promise<void> {
  const profileId = entry.profileId && UUID_RE.test(entry.profileId) ? entry.profileId : null;

  await db.insert(phi_access_log).values({
    actor_id: entry.actorId,
    actor_role: entry.actorRole ?? null,
    profile_id: profileId,
    action: entry.action,
    resource_type: entry.resourceType ?? null,
    resource_id: entry.resourceId ?? null,
    purpose: entry.purpose,
    method: entry.method,
    path: entry.path,
    status_code: entry.statusCode,
    success: entry.success,
    duration_ms: entry.durationMs,
    ip: entry.ip,
    user_agent: entry.userAgent,
    correlation_id: entry.correlationId ?? null,
    occurred_at: entry.occurredAt,
  });

  if (!entry.success) {
    logger.warn(
      { actorId: entry.actorId, profileId, path: entry.path, statusCode: entry.statusCode },
      'Denied health-data access recorded',
    );
  }
}
