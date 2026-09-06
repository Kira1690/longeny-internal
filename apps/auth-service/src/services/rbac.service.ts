import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '@longeny/errors';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import { credentials, permissions, role_permissions, roles, user_roles } from '../db/schema.js';
import { createAuditLog } from './audit.service.js';
import { ROLE_PRECEDENCE, resolveIdentity } from './identity.service.js';
import { invalidateAllUserTokens, revokeAllSessions } from './token.service.js';

export function initRbacService(_unused: unknown): void {
  // no-op — Drizzle db is a module-level singleton
}

/** How the role a request touches is weighed against the actor's own standing. */
interface ManageableRole {
  name: string;
  is_system: boolean;
}

const SUPER_ADMIN_RANK = ROLE_PRECEDENCE.indexOf('super_admin');

/** Lower is more privileged. Roles absent from the shared precedence list are
 *  unranked and rank below every named role. */
function rankOf(roleName: string): number {
  const index = ROLE_PRECEDENCE.indexOf(roleName);
  return index === -1 ? Number.POSITIVE_INFINITY : index;
}

function highestRank(roleNames: string[]): number {
  return roleNames.reduce((best, name) => Math.min(best, rankOf(name)), Number.POSITIVE_INFINITY);
}

/**
 * An actor may only hand out — or take away — privilege it already holds.
 * Without this, the shared `requireRole(ADMIN, SUPER_ADMIN)` guard on the route
 * let any admin PUT itself the super_admin role, or strip a super_admin of
 * theirs, in one call.
 */
function mayManageRole(actorRank: number, role: ManageableRole): boolean {
  const roleRank = rankOf(role.name);
  if (Number.isFinite(roleRank)) return actorRank <= roleRank;

  // A system role with no entry in the precedence list carries privilege of
  // unknown weight, so it is treated as the highest: super_admin only. Custom
  // (non-system) roles created through this API stay delegable to admins.
  return role.is_system ? actorRank <= SUPER_ADMIN_RANK : true;
}

/**
 * List all roles.
 */
export async function listRoles() {
  return db.select().from(roles).orderBy(asc(roles.name));
}

/**
 * Create a new role.
 */
export async function createRole(name: string, description?: string) {
  const [existing] = await db.select().from(roles).where(eq(roles.name, name)).limit(1);
  if (existing) {
    throw new ConflictError(`Role "${name}" already exists`);
  }

  const [role] = await db
    .insert(roles)
    .values({
      name,
      description,
      is_system: false,
    })
    .returning();

  return role;
}

/**
 * Get all permissions assigned to a role.
 */
export async function getRolePermissions(roleId: string) {
  const [role] = await db.select().from(roles).where(eq(roles.id, roleId)).limit(1);

  if (!role) {
    throw new NotFoundError('Role', roleId);
  }

  const perms = await db
    .select({
      id: permissions.id,
      name: permissions.name,
      resource: permissions.resource,
      action: permissions.action,
      description: permissions.description,
    })
    .from(role_permissions)
    .innerJoin(permissions, eq(role_permissions.permission_id, permissions.id))
    .where(eq(role_permissions.role_id, roleId));

  return {
    role: { id: role.id, name: role.name, description: role.description },
    permissions: perms,
  };
}

/**
 * Update permissions for a role by replacing all current permissions.
 */
export async function updateRolePermissions(roleId: string, permissionIds: string[]) {
  const [role] = await db.select().from(roles).where(eq(roles.id, roleId)).limit(1);
  if (!role) {
    throw new NotFoundError('Role', roleId);
  }

  // Validate all permission IDs exist
  const foundPerms = await db
    .select()
    .from(permissions)
    .where(inArray(permissions.id, permissionIds));

  if (foundPerms.length !== permissionIds.length) {
    const foundIds = new Set(foundPerms.map((p) => p.id));
    const missing = permissionIds.filter((id) => !foundIds.has(id));
    throw new BadRequestError(
      `Permissions not found: ${missing.join(', ')}`,
      'INVALID_PERMISSIONS',
    );
  }

  // Replace all role permissions in a transaction
  await db.transaction(async (tx) => {
    await tx.delete(role_permissions).where(eq(role_permissions.role_id, roleId));
    if (permissionIds.length > 0) {
      await tx
        .insert(role_permissions)
        .values(
          permissionIds.map((permissionId) => ({ role_id: roleId, permission_id: permissionId })),
        );
    }
  });

  return getRolePermissions(roleId);
}

/**
 * Get all roles assigned to a user.
 */
export async function getUserRoles(userId: string) {
  const userRoleRows = await db
    .select({
      roleId: roles.id,
      name: roles.name,
      description: roles.description,
      assignedAt: user_roles.assigned_at,
      assignedBy: user_roles.assigned_by,
    })
    .from(user_roles)
    .innerJoin(roles, eq(user_roles.role_id, roles.id))
    .where(eq(user_roles.credential_id, userId));

  const result = await Promise.all(
    userRoleRows.map(async (ur) => {
      const perms = await db
        .select({
          id: permissions.id,
          name: permissions.name,
          resource: permissions.resource,
          action: permissions.action,
        })
        .from(role_permissions)
        .innerJoin(permissions, eq(role_permissions.permission_id, permissions.id))
        .where(eq(role_permissions.role_id, ur.roleId));

      return {
        roleId: ur.roleId,
        name: ur.name,
        description: ur.description,
        assignedAt: ur.assignedAt,
        assignedBy: ur.assignedBy,
        permissions: perms,
      };
    }),
  );

  return result;
}

/** The role rows a credential currently holds, with the fields the privilege
 *  comparison needs. */
async function heldRoles(credentialId: string): Promise<ManageableRole[]> {
  return db
    .select({ name: roles.name, is_system: roles.is_system })
    .from(user_roles)
    .innerJoin(roles, eq(user_roles.role_id, roles.id))
    .where(eq(user_roles.credential_id, credentialId));
}

/** Refusals are as interesting to an investigator as successful escalations, so
 *  each one leaves a row naming the actor, the target and the reason. */
async function denyRoleChange(
  actorId: string,
  actorRoles: string[],
  targetUserId: string,
  reason: string,
): Promise<never> {
  await createAuditLog({
    credentialId: actorId,
    eventType: 'rbac.user.roles.denied',
    userRole: actorRoles[0],
    action: 'assign_user_roles',
    result: 'denied',
    purpose: 'rbac_management',
    resourceType: 'credential',
    resourceId: targetUserId,
    metadata: { targetUserId, reason },
  });

  throw new ForbiddenError('Insufficient privileges to change these roles');
}

/**
 * Assign roles to a user, replacing any existing role assignments.
 *
 * Privilege rules, all enforced here rather than at the route because they need
 * the database: no actor changes its own roles, and no actor grants or revokes a
 * role ranked above its own — which is what makes super_admin a super_admin-only
 * grant.
 */
export async function assignUserRoles(userId: string, roleIds: string[], assignedBy: string) {
  const [credential] = await db
    .select()
    .from(credentials)
    .where(eq(credentials.id, userId))
    .limit(1);
  if (!credential) {
    throw new NotFoundError('User', userId);
  }

  const foundRoles = await db.select().from(roles).where(inArray(roles.id, roleIds));

  if (foundRoles.length !== roleIds.length) {
    const foundIds = new Set(foundRoles.map((r) => r.id));
    const missing = roleIds.filter((id) => !foundIds.has(id));
    throw new BadRequestError(`Roles not found: ${missing.join(', ')}`, 'INVALID_ROLES');
  }

  // The actor's standing is read from the database, never from the request:
  // an access token issued before a demotion still carries the old role.
  const actor = await resolveIdentity(assignedBy);
  const actorRank = highestRank(actor.roles);
  const rolesBefore = await heldRoles(userId);

  if (userId === assignedBy) {
    await denyRoleChange(assignedBy, actor.roles, userId, 'self_role_change');
  }

  // Revoking is checked alongside granting: stripping a super_admin is an
  // escalation move too, it just runs in the other direction.
  for (const role of [...rolesBefore, ...foundRoles]) {
    if (!mayManageRole(actorRank, role)) {
      await denyRoleChange(assignedBy, actor.roles, userId, `role_above_actor:${role.name}`);
    }
  }

  await db.transaction(async (tx) => {
    await tx.delete(user_roles).where(eq(user_roles.credential_id, userId));
    if (roleIds.length > 0) {
      await tx.insert(user_roles).values(
        roleIds.map((roleId) => ({
          credential_id: userId,
          role_id: roleId,
          assigned_by: assignedBy,
        })),
      );
    }
  });

  // A demotion has to bite now. Sessions and every access token issued before
  // this moment are dropped, the same way logout-all does it — otherwise the
  // demoted user keeps the old privileges until their access token expires.
  await revokeAllSessions(userId);
  await invalidateAllUserTokens(userId);

  await createAuditLog({
    credentialId: assignedBy,
    eventType: 'rbac.user.roles.changed',
    userRole: actor.primaryRole,
    action: 'assign_user_roles',
    result: 'success',
    purpose: 'rbac_management',
    resourceType: 'credential',
    resourceId: userId,
    resourceOwnerId: userId,
    metadata: {
      targetUserId: userId,
      rolesBefore: rolesBefore.map((r) => r.name),
      rolesAfter: foundRoles.map((r) => r.name),
    },
  });

  return getUserRoles(userId);
}
