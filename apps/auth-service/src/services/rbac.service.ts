import { NotFoundError, ConflictError, BadRequestError } from '@longeny/errors';
import { db } from '../db/index.js';
import { roles, permissions, role_permissions, user_roles, credentials } from '../db/schema.js';
import { eq, inArray, and, asc } from 'drizzle-orm';

export function initRbacService(_unused: unknown): void {
  // no-op — Drizzle db is a module-level singleton
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

  const [role] = await db.insert(roles).values({
    name,
    description,
    is_system: false,
  }).returning();

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
    throw new BadRequestError(`Permissions not found: ${missing.join(', ')}`, 'INVALID_PERMISSIONS');
  }

  // Replace all role permissions in a transaction
  await db.transaction(async (tx) => {
    await tx.delete(role_permissions).where(eq(role_permissions.role_id, roleId));
    if (permissionIds.length > 0) {
      await tx.insert(role_permissions).values(
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

/**
 * Assign roles to a user, replacing any existing role assignments.
 */
export async function assignUserRoles(userId: string, roleIds: string[], assignedBy: string) {
  const [credential] = await db.select().from(credentials).where(eq(credentials.id, userId)).limit(1);
  if (!credential) {
    throw new NotFoundError('User', userId);
  }

  const foundRoles = await db
    .select()
    .from(roles)
    .where(inArray(roles.id, roleIds));

  if (foundRoles.length !== roleIds.length) {
    const foundIds = new Set(foundRoles.map((r) => r.id));
    const missing = roleIds.filter((id) => !foundIds.has(id));
    throw new BadRequestError(`Roles not found: ${missing.join(', ')}`, 'INVALID_ROLES');
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

  return getUserRoles(userId);
}
