import { requireAuth, requireRole } from '@longeny/middleware';
import { UserRole } from '@longeny/types';
import Elysia from 'elysia';
import { config } from '../config/index.js';
import {
  handleAssignUserRoles,
  handleCreateRole,
  handleGetRolePermissions,
  handleGetUserRoles,
  handleListRoles,
  handleUpdateRolePermissions,
} from '../controllers/rbac.controller.js';
import { type OpenApiFragment, errorDoc, okDoc } from './swagger-helpers.js';

const bearer = { security: [{ BearerAuth: [] }] };
const TAGS = ['RBAC'];

const ROLE_SHAPE: OpenApiFragment = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    name: { type: 'string', example: 'provider' },
    description: { type: 'string', nullable: true },
    is_system: {
      type: 'boolean',
      description: 'System roles are seeded and can only be managed by super_admin',
    },
    created_at: { type: 'string', format: 'date-time' },
  },
};

const PERMISSION_SHAPE: OpenApiFragment = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    name: { type: 'string', example: 'payments:refund' },
    description: { type: 'string', nullable: true },
  },
};

const unauthorized = errorDoc(
  'Missing, malformed, expired or revoked access token',
  'UNAUTHORIZED',
);

const notAdmin = errorDoc('Caller is not admin or super_admin', 'FORBIDDEN');

/**
 * Reading the RBAC model and assigning roles is admin work. `assignUserRoles`
 * then decides in the service layer which roles *this* admin may hand out — the
 * route guard alone cannot, because the answer depends on the actor's own roles
 * as stored, not as claimed by their token.
 */
const rbacAdminRoutes = new Elysia({ prefix: '/auth' })
  .use(requireAuth(config.JWT_ACCESS_SECRET))
  .use(requireRole(UserRole.ADMIN, UserRole.SUPER_ADMIN))

  .get('/roles', handleListRoles, {
    detail: {
      tags: TAGS,
      summary: 'List every role in the system (admin only)',
      description:
        'The role catalogue an admin screen picks from. `is_system` matters: a system role can ' +
        'only be granted or revoked by a super_admin, so filter or disable those in the UI when ' +
        'the current user is a plain admin.',
      ...bearer,
      responses: {
        200: okDoc('All roles', { type: 'array', items: ROLE_SHAPE }),
        401: unauthorized,
        403: notAdmin,
      },
    },
  })

  .post('/roles', handleCreateRole, {
    detail: {
      tags: TAGS,
      summary: 'Create a custom role (admin only)',
      description:
        'Creates a non-system role with no permissions attached; grant them afterwards with ' +
        '`PUT /auth/roles/{id}/permissions` (super_admin only). Role names are unique — reusing ' +
        'one answers 409.\n\n' +
        'There is no route-level body validation here: a body without `name` reaches the ' +
        'database and surfaces as a 500 rather than a 400.',
      ...bearer,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['name'],
              properties: {
                name: { type: 'string', example: 'nutrition_coach' },
                description: { type: 'string' },
              },
            },
          },
        },
      },
      responses: {
        201: okDoc('Role created', ROLE_SHAPE),
        401: unauthorized,
        403: notAdmin,
        409: errorDoc('A role with that name already exists', 'CONFLICT'),
      },
    },
  })

  .get('/roles/:id/permissions', handleGetRolePermissions, {
    detail: {
      tags: TAGS,
      summary: 'List the permissions attached to a role (admin only)',
      ...bearer,
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' },
          description: 'Role id',
        },
      ],
      responses: {
        200: okDoc('The role and its permissions', {
          type: 'object',
          properties: {
            role: ROLE_SHAPE,
            permissions: { type: 'array', items: PERMISSION_SHAPE },
          },
        }),
        401: unauthorized,
        403: notAdmin,
        404: errorDoc('No such role', 'NOT_FOUND'),
      },
    },
  })

  .get('/users/:userId/roles', handleGetUserRoles, {
    detail: {
      tags: TAGS,
      summary: 'List the roles a user holds (admin only)',
      description:
        'A user can hold several roles at once — a physician who is also a patient keeps both. ' +
        'Read this before rendering a role editor so you send back the full intended set.',
      ...bearer,
      parameters: [
        {
          name: 'userId',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' },
          description: 'Credential id of the user',
        },
      ],
      responses: {
        200: okDoc('Roles held by that user', { type: 'array', items: ROLE_SHAPE }),
        401: unauthorized,
        403: notAdmin,
      },
    },
  })

  .put('/users/:userId/roles', handleAssignUserRoles, {
    detail: {
      tags: TAGS,
      summary: 'Replace a user’s roles (admin only, rank-limited)',
      description:
        '**This replaces the whole set** — send every role the user should end up with, not just ' +
        'the new one. An empty `roleIds` array strips them all.\n\n' +
        '**Newly guarded.** Three rules are enforced in the service, against the database rather ' +
        'than against what the caller’s token claims, so a token issued before a demotion cannot ' +
        'be used to escalate:\n' +
        '1. **No self-service.** An actor cannot change its own roles at all — answered 403, ' +
        'even for a no-op.\n' +
        '2. **No granting above your rank.** An admin cannot hand out `super_admin`, and cannot ' +
        'grant a system role that has no rank of its own. This is checked on the roles being ' +
        '*removed* as well as the ones being added, so stripping a super_admin is refused for ' +
        'the same reason.\n' +
        '3. **Refusals are recorded.** Every denial writes an audit row naming actor, target and ' +
        'reason — visible through `GET /auth/audit-log`.\n\n' +
        '**Side effect on success: the target user is signed out everywhere.** All their ' +
        'sessions are revoked and every access token issued before the change is invalidated, so ' +
        'a demotion bites immediately instead of lasting until their token expires. If you are ' +
        'looking at that user in a live UI, expect their next request to answer ' +
        '`401 TOKEN_REVOKED`.\n\n' +
        'There is no route-level body validation: a body without `roleIds` surfaces as a 500.',
      ...bearer,
      parameters: [
        {
          name: 'userId',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' },
          description: 'Credential id of the user whose roles are being replaced',
        },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['roleIds'],
              properties: {
                roleIds: {
                  type: 'array',
                  items: { type: 'string', format: 'uuid' },
                  description: 'The complete set of roles the user should hold afterwards',
                },
              },
            },
          },
        },
      },
      responses: {
        200: okDoc('Roles after the change; the target’s tokens are now revoked', {
          type: 'array',
          items: ROLE_SHAPE,
        }),
        400: errorDoc('One or more role ids do not exist', 'INVALID_ROLES'),
        401: unauthorized,
        403: errorDoc(
          'Caller is not admin/super_admin, is trying to change its own roles, or is granting or revoking a role ranked above its own',
          'FORBIDDEN',
        ),
        404: errorDoc('No such user', 'NOT_FOUND'),
      },
    },
  });

/**
 * Rewriting a role's permissions changes what every holder of that role may do,
 * the admin role included — so an admin allowed here could grant themselves any
 * permission in the system without ever touching a role assignment. Kept to
 * super_admin.
 */
const rbacSuperAdminRoutes = new Elysia({ prefix: '/auth' })
  .use(requireAuth(config.JWT_ACCESS_SECRET))
  .use(requireRole(UserRole.SUPER_ADMIN))

  .put('/roles/:id/permissions', handleUpdateRolePermissions, {
    detail: {
      tags: TAGS,
      summary: 'Replace a role’s permissions (super_admin only)',
      description:
        '**This replaces the whole set** — send every permission the role should end up with. ' +
        'An empty array leaves the role able to do nothing.\n\n' +
        '**Newly guarded: super_admin only.** A plain `admin` is refused with 403, unlike every ' +
        'other RBAC route on this page. The reason is escalation: rewriting the permissions of ' +
        'the `admin` role would let an admin grant themselves anything in the system — including ' +
        '`payments:refund` — without ever touching a role assignment.\n\n' +
        'Effect is not immediate for people already signed in: permissions are baked into access ' +
        'tokens at login, so a **granted** permission appears only after the holder’s next login ' +
        'or `POST /auth/refresh`. Removals are not force-revoked here either — unlike a role ' +
        'change, this call does **not** revoke anybody’s tokens.\n\n' +
        'There is no route-level body validation: a body without `permissionIds` surfaces as a ' +
        '500.',
      ...bearer,
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' },
          description: 'Role id whose permission set is being replaced',
        },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['permissionIds'],
              properties: {
                permissionIds: {
                  type: 'array',
                  items: { type: 'string', format: 'uuid' },
                  description: 'The complete set of permissions the role should hold afterwards',
                },
              },
            },
          },
        },
      },
      responses: {
        200: okDoc('The role and its new permission set', {
          type: 'object',
          properties: {
            role: ROLE_SHAPE,
            permissions: { type: 'array', items: PERMISSION_SHAPE },
          },
        }),
        400: errorDoc('One or more permission ids do not exist', 'INVALID_PERMISSIONS'),
        401: unauthorized,
        403: errorDoc('Caller is not super_admin', 'FORBIDDEN'),
        404: errorDoc('No such role', 'NOT_FOUND'),
      },
    },
  });

const rbacRoutes = new Elysia().use(rbacAdminRoutes).use(rbacSuperAdminRoutes);

export default rbacRoutes;
