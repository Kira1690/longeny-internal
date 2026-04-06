import Elysia from 'elysia';
import { requireAuth, requireRole } from '@longeny/middleware';
import {
  handleListRoles,
  handleCreateRole,
  handleGetRolePermissions,
  handleUpdateRolePermissions,
  handleGetUserRoles,
  handleAssignUserRoles,
} from '../controllers/rbac.controller.js';
import { config } from '../config/index.js';

const rbacRoutes = new Elysia({ prefix: '/auth' })
  .use(requireAuth(config.JWT_ACCESS_SECRET))
  .use(requireRole('admin'))
  .get('/roles', handleListRoles)
  .post('/roles', handleCreateRole)
  .get('/roles/:id/permissions', handleGetRolePermissions)
  .put('/roles/:id/permissions', handleUpdateRolePermissions)
  .get('/users/:userId/roles', handleGetUserRoles)
  .put('/users/:userId/roles', handleAssignUserRoles);

export default rbacRoutes;
