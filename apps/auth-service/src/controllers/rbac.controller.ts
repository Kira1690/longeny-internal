import {
  listRoles,
  createRole,
  getRolePermissions,
  updateRolePermissions,
  getUserRoles,
  assignUserRoles,
} from '../services/rbac.service.js';
import { createAuditLog } from '../services/audit.service.js';

function getIp(request: Request): string {
  return (
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
    request.headers.get('X-Real-IP') ||
    'unknown'
  );
}

export async function handleListRoles() {
  const roles = await listRoles();

  return {
    success: true,
    data: roles,
    meta: { timestamp: new Date().toISOString() },
  };
}

export async function handleCreateRole({ body, request, store, set }: any) {
  const adminId = store.userId as string;
  const ip = getIp(request);

  const role = await createRole(body.name, body.description);

  await createAuditLog({
    credentialId: adminId,
    eventType: 'rbac.role.created',
    ipAddress: ip,
    action: 'create_role',
    result: 'success',
    purpose: 'rbac_management',
    resourceType: 'role',
    resourceId: role.id,
    metadata: { roleName: body.name },
  });

  set.status = 201;
  return {
    success: true,
    data: role,
    meta: { timestamp: new Date().toISOString() },
  };
}

export async function handleGetRolePermissions({ params }: any) {
  const roleId = params.id;
  const data = await getRolePermissions(roleId);

  return {
    success: true,
    data,
    meta: { timestamp: new Date().toISOString() },
  };
}

export async function handleUpdateRolePermissions({ params, body, request, store }: any) {
  const roleId = params.id;
  const adminId = store.userId as string;
  const ip = getIp(request);

  const data = await updateRolePermissions(roleId, body.permissionIds);

  await createAuditLog({
    credentialId: adminId,
    eventType: 'rbac.role.permissions.updated',
    ipAddress: ip,
    action: 'update_role_permissions',
    result: 'success',
    purpose: 'rbac_management',
    resourceType: 'role',
    resourceId: roleId,
    metadata: { permissionIds: body.permissionIds },
  });

  return {
    success: true,
    data,
    meta: { timestamp: new Date().toISOString() },
  };
}

export async function handleGetUserRoles({ params }: any) {
  const userId = params.userId;
  const roles = await getUserRoles(userId);

  return {
    success: true,
    data: roles,
    meta: { timestamp: new Date().toISOString() },
  };
}

export async function handleAssignUserRoles({ params, body, request, store }: any) {
  const userId = params.userId;
  const adminId = store.userId as string;
  const ip = getIp(request);

  const roles = await assignUserRoles(userId, body.roleIds, adminId);

  await createAuditLog({
    credentialId: adminId,
    eventType: 'rbac.user.roles.assigned',
    ipAddress: ip,
    action: 'assign_user_roles',
    result: 'success',
    purpose: 'rbac_management',
    resourceType: 'credential',
    resourceId: userId,
    metadata: { roleIds: body.roleIds, targetUserId: userId },
  });

  return {
    success: true,
    data: roles,
    meta: { timestamp: new Date().toISOString() },
  };
}
