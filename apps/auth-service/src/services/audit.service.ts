import { sha256 } from '@longeny/utils';
import { db } from '../db/index.js';
import { audit_logs } from '../db/schema.js';
import { eq, desc } from 'drizzle-orm';

export function initAuditService(_unused: unknown): void {
  // no-op — Drizzle db is a module-level singleton
}

export interface CreateAuditLogParams {
  credentialId?: string;
  eventType: string;
  userRole?: string;
  userEmail?: string;
  ipAddress?: string;
  userAgent?: string;
  resourceType?: string;
  resourceId?: string;
  resourceOwnerId?: string;
  action: string;
  result: 'success' | 'failure' | 'denied';
  purpose?: string;
  metadata?: Record<string, unknown>;
  correlationId?: string;
}

/**
 * Create an immutable audit log entry with SHA-256 hash chain.
 */
export async function createAuditLog(params: CreateAuditLogParams): Promise<void> {
  // Get the last audit log entry for the hash chain
  const [lastEntry] = await db
    .select({ hash: audit_logs.hash })
    .from(audit_logs)
    .orderBy(desc(audit_logs.created_at))
    .limit(1);

  const previousHash = lastEntry?.hash ?? null;

  const hashInput = [
    params.credentialId ?? '',
    params.eventType,
    params.action,
    params.result,
    params.ipAddress ?? '',
    params.userAgent ?? '',
    previousHash ?? '',
    new Date().toISOString(),
  ].join('|');

  const hash = sha256(hashInput);

  await db.insert(audit_logs).values({
    credential_id: params.credentialId,
    event_type: params.eventType,
    user_role: params.userRole,
    user_email: params.userEmail,
    ip_address: params.ipAddress,
    user_agent: params.userAgent,
    resource_type: params.resourceType,
    resource_id: params.resourceId,
    resource_owner_id: params.resourceOwnerId,
    action: params.action,
    result: params.result,
    purpose: params.purpose ?? 'authentication',
    previous_hash: previousHash,
    hash,
    metadata: params.metadata as any,
    correlation_id: params.correlationId,
    service_name: 'auth-service',
  });
}

export interface QueryAuditLogsParams {
  page: number;
  limit: number;
  eventType?: string;
  credentialId?: string;
  startDate?: string;
  endDate?: string;
}

/**
 * Query audit logs with pagination and filtering.
 */
export async function queryAuditLogs(params: QueryAuditLogsParams) {
  const { page, limit, eventType, credentialId, startDate, endDate } = params;
  const skip = (page - 1) * limit;

  // Build where conditions
  const conditions: any[] = [];
  if (eventType) conditions.push(eq(audit_logs.event_type, eventType));
  if (credentialId) conditions.push(eq(audit_logs.credential_id!, credentialId));

  const { and: drizzleAnd, gte, lte } = await import('drizzle-orm');
  if (startDate) conditions.push(gte(audit_logs.created_at, new Date(startDate)));
  if (endDate) conditions.push(lte(audit_logs.created_at, new Date(endDate)));

  const whereClause = conditions.length > 0 ? drizzleAnd(...conditions) : undefined;

  const logs = await db
    .select()
    .from(audit_logs)
    .where(whereClause)
    .orderBy(desc(audit_logs.created_at))
    .limit(limit)
    .offset(skip);

  const [{ count }] = await db
    .select({ count: db.$count(audit_logs, whereClause) })
    .from(audit_logs);

  const total = Number(count);

  return {
    logs,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

/**
 * Anonymize audit logs for a credential (GDPR erasure).
 */
export async function anonymizeAuditLogs(credentialId: string): Promise<number> {
  const result = await db
    .update(audit_logs)
    .set({
      user_email: '[ANONYMIZED]',
      ip_address: '[ANONYMIZED]',
      user_agent: '[ANONYMIZED]',
      metadata: {},
    })
    .where(eq(audit_logs.credential_id!, credentialId))
    .returning({ id: audit_logs.id });

  return result.length;
}
