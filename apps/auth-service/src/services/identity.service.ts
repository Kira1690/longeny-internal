import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { permissions, role_permissions, roles, user_roles } from '../db/schema.js';

/**
 * Every role a credential holds, plus the union of the permissions those roles
 * grant. Resolving roles and permissions lived inline in register, login,
 * refresh and OAuth — four copies that had already drifted (each took only the
 * first role row, so a user with two roles silently lost one).
 */
export interface ResolvedIdentity {
  /** Every role name held by the credential, highest privilege first. */
  roles: string[];
  /** Highest-privilege role — what legacy single-role consumers read. */
  primaryRole: string;
  /** Union of permissions across all roles, de-duplicated. */
  permissions: string[];
}

/** Highest privilege first. Roles outside this list sort last, alphabetically. */
export const ROLE_PRECEDENCE = ['super_admin', 'admin', 'provider', 'user'];

function byPrecedence(a: string, b: string): number {
  const ai = ROLE_PRECEDENCE.indexOf(a);
  const bi = ROLE_PRECEDENCE.indexOf(b);
  if (ai === -1 && bi === -1) return a.localeCompare(b);
  if (ai === -1) return 1;
  if (bi === -1) return -1;
  return ai - bi;
}

export async function resolveIdentity(credentialId: string): Promise<ResolvedIdentity> {
  const rows = await db
    .select({ roleName: roles.name, permissionName: permissions.name })
    .from(user_roles)
    .innerJoin(roles, eq(user_roles.role_id, roles.id))
    .leftJoin(role_permissions, eq(role_permissions.role_id, roles.id))
    .leftJoin(permissions, eq(role_permissions.permission_id, permissions.id))
    .where(eq(user_roles.credential_id, credentialId));

  const roleSet = new Set<string>();
  const permissionSet = new Set<string>();

  for (const row of rows) {
    roleSet.add(row.roleName);
    if (row.permissionName) permissionSet.add(row.permissionName);
  }

  const roleNames = [...roleSet].sort(byPrecedence);

  return {
    roles: roleNames,
    primaryRole: roleNames[0] ?? 'user',
    permissions: [...permissionSet].sort(),
  };
}
