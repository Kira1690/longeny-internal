import { requireAuth, requireRole } from '@longeny/middleware';
import { UserRole } from '@longeny/types';
import { notificationPreferencesSchema, registerPushTokenSchema } from '@longeny/validators';
import { Elysia } from 'elysia';
import type { NotificationController } from '../controllers/notification.controller.js';
import { type OpenApiFragment, bodyDoc, documented, errorDoc, okDoc } from './swagger-helpers.js';

const bearer = { security: [{ BearerAuth: [] }] };

const NOTIFICATION_TYPES = ['email', 'sms', 'push', 'in_app'];
const NOTIFICATION_CATEGORIES = [
  'booking',
  'payment',
  'system',
  'marketing',
  'reminder',
  'document',
  'provider',
  'progress',
];

const NOTIFICATION_SHAPE: OpenApiFragment = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    user_id: { type: 'string', format: 'uuid' },
    booking_id: { type: 'string', format: 'uuid', nullable: true },
    type: { type: 'string', enum: NOTIFICATION_TYPES },
    category: { type: 'string', enum: NOTIFICATION_CATEGORIES },
    title: { type: 'string' },
    body: { type: 'string' },
    body_html: { type: 'string', nullable: true },
    data: { type: 'object', nullable: true, additionalProperties: true },
    priority: { type: 'integer' },
    read_at: { type: 'string', format: 'date-time', nullable: true },
    created_at: { type: 'string', format: 'date-time' },
  },
};

const PREFERENCES_SHAPE: OpenApiFragment = {
  type: 'object',
  properties: {
    user_id: { type: 'string', format: 'uuid' },
    channels: {
      type: 'object',
      properties: {
        email: { type: 'boolean' },
        sms: { type: 'boolean' },
        push: { type: 'boolean' },
        inApp: { type: 'boolean' },
      },
    },
    reminders: {
      type: 'object',
      properties: {
        twentyFourHour: { type: 'boolean' },
        oneHour: { type: 'boolean' },
        fifteenMin: { type: 'boolean' },
      },
    },
    categories: { type: 'object', additionalProperties: { type: 'boolean' }, nullable: true },
    updated_at: { type: 'string', format: 'date-time' },
  },
};

const TEMPLATE_SHAPE: OpenApiFragment = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    name: { type: 'string' },
    subject: { type: 'string', nullable: true },
    body: { type: 'string' },
    body_html: { type: 'string', nullable: true },
    type: { type: 'string', enum: NOTIFICATION_TYPES },
    category: { type: 'string', enum: NOTIFICATION_CATEGORIES },
    variables: { type: 'object', nullable: true, additionalProperties: true },
    is_active: { type: 'boolean' },
    updated_at: { type: 'string', format: 'date-time' },
  },
};

const paginationParams: OpenApiFragment[] = [
  {
    name: 'page',
    in: 'query',
    required: false,
    schema: { type: 'integer', minimum: 1, default: 1 },
  },
  {
    name: 'limit',
    in: 'query',
    required: false,
    schema: { type: 'integer', minimum: 1, default: 20 },
  },
];

const unauthorized = errorDoc(
  'Missing, malformed, expired or revoked access token',
  'UNAUTHORIZED',
);

const notAdmin = errorDoc('Caller is not admin or super_admin', 'FORBIDDEN');

const notYours = errorDoc(
  'No such notification, or it belongs to another user — the two are deliberately indistinguishable, so never infer that an id is real from this response',
  'NOT_FOUND',
);

/**
 * Admin send/broadcast/template-update carry no route validator, so their
 * shapes are documented from the service signature rather than wrapped with
 * `documented()` — adding a validator here would change what the routes accept.
 */
const sendNotificationBody: OpenApiFragment = {
  required: true,
  content: {
    'application/json': {
      schema: {
        type: 'object',
        required: ['userId', 'type', 'category', 'title', 'body'],
        properties: {
          userId: { type: 'string', format: 'uuid', description: 'Recipient' },
          bookingId: { type: 'string', format: 'uuid', nullable: true },
          type: { type: 'string', enum: NOTIFICATION_TYPES },
          category: { type: 'string', enum: NOTIFICATION_CATEGORIES },
          title: { type: 'string' },
          body: { type: 'string' },
          bodyHtml: { type: 'string' },
          data: { type: 'object', additionalProperties: true },
          priority: { type: 'integer', description: 'Higher is more urgent' },
          templateId: { type: 'string', format: 'uuid' },
        },
      },
    },
  },
};

const broadcastBody: OpenApiFragment = {
  required: true,
  content: {
    'application/json': {
      schema: {
        type: 'object',
        required: ['type', 'category', 'title', 'body'],
        properties: {
          type: { type: 'string', enum: NOTIFICATION_TYPES },
          category: { type: 'string', enum: NOTIFICATION_CATEGORIES },
          title: { type: 'string' },
          body: { type: 'string' },
          bodyHtml: { type: 'string' },
          data: { type: 'object', additionalProperties: true },
          priority: { type: 'integer' },
          userIds: {
            type: 'array',
            items: { type: 'string', format: 'uuid' },
            description: 'Restrict the broadcast to these users. Omit to reach everyone.',
          },
          templateId: { type: 'string', format: 'uuid' },
        },
      },
    },
  },
};

const templateUpdateBody: OpenApiFragment = {
  required: true,
  description: 'Partial update — send only the fields that change',
  content: {
    'application/json': {
      schema: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          subject: { type: 'string' },
          body: { type: 'string' },
          bodyHtml: { type: 'string' },
          category: { type: 'string', enum: NOTIFICATION_CATEGORIES },
          type: { type: 'string', enum: NOTIFICATION_TYPES },
          variables: { type: 'object', additionalProperties: true },
          isActive: { type: 'boolean' },
        },
      },
    },
  },
};

export function createNotificationRoutes(controller: NotificationController) {
  const authRequired = requireAuth();
  const adminRequired = requireRole(UserRole.ADMIN, UserRole.SUPER_ADMIN);

  // Admin-only section
  const adminRoutes = new Elysia()
    .use(authRequired)
    .use(adminRequired)

    .post('/send', controller.sendNotification, {
      detail: {
        tags: ['Notification Admin'],
        summary: 'Send one notification to one user (admin only)',
        description:
          'Delivers through the channel named by `type`. The recipient’s own preferences are ' +
          'honoured: a notification the user has muted is still recorded but not delivered, and ' +
          'the call still answers 200 — a 200 means "accepted", not "delivered".\n\n' +
          'Admin/super_admin role only. There is no permission check beyond the role, and no ' +
          'route-level body validation: a malformed body surfaces as a 500 from the insert ' +
          'rather than a 400.',
        ...bearer,
        requestBody: sendNotificationBody,
        responses: {
          200: okDoc('Notification recorded (and delivered unless muted)', NOTIFICATION_SHAPE),
          401: unauthorized,
          403: notAdmin,
        },
      },
    })

    .post('/broadcast', controller.broadcastNotification, {
      detail: {
        tags: ['Notification Admin'],
        summary: 'Send the same notification to many users (admin only)',
        description:
          'Fan-out send. Pass `userIds` to target a list, or omit it to reach every user. Per-user ' +
          'preferences are applied individually, so `failed` counts recipients the send did not ' +
          'reach — it is not an error for the call as a whole.',
        ...bearer,
        requestBody: broadcastBody,
        responses: {
          200: okDoc(
            'Broadcast finished, with per-recipient counts',
            {
              type: 'object',
              properties: {
                sent: { type: 'integer' },
                failed: { type: 'integer' },
              },
            },
            { sent: 128, failed: 3 },
          ),
          401: unauthorized,
          403: notAdmin,
        },
      },
    })

    .get('/templates', controller.listTemplates, {
      detail: {
        tags: ['Notification Admin'],
        summary: 'List notification templates (admin only)',
        description:
          'Reusable message bodies referenced by `templateId` on send and broadcast. Paginated.',
        ...bearer,
        parameters: paginationParams,
        responses: {
          200: {
            description: 'Page of templates',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    data: { type: 'array', items: TEMPLATE_SHAPE },
                    pagination: {
                      type: 'object',
                      properties: {
                        page: { type: 'integer' },
                        limit: { type: 'integer' },
                        total: { type: 'integer' },
                        totalPages: { type: 'integer' },
                      },
                    },
                  },
                },
              },
            },
          },
          401: unauthorized,
          403: notAdmin,
        },
      },
    })

    .put('/templates/:id', controller.updateTemplate, {
      detail: {
        tags: ['Notification Admin'],
        summary: 'Update a notification template (admin only)',
        ...bearer,
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
            description: 'Template id',
          },
        ],
        requestBody: templateUpdateBody,
        responses: {
          200: okDoc('Template after the update', TEMPLATE_SHAPE),
          401: unauthorized,
          403: notAdmin,
          404: errorDoc('No such template', 'NOT_FOUND'),
        },
      },
    });

  // Auth-required section (all users)
  const authRoutes = new Elysia()
    .use(authRequired)

    .get('/', controller.listNotifications, {
      detail: {
        tags: ['Notifications'],
        summary: 'List the caller’s notifications',
        description:
          'Always scoped to the authenticated user, newest first, paginated. Read state is the ' +
          '`read_at` field — null means unread.',
        ...bearer,
        parameters: paginationParams,
        responses: {
          200: {
            description: 'Page of notifications',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    data: { type: 'array', items: NOTIFICATION_SHAPE },
                    pagination: {
                      type: 'object',
                      properties: {
                        page: { type: 'integer' },
                        limit: { type: 'integer' },
                        total: { type: 'integer' },
                        totalPages: { type: 'integer' },
                      },
                    },
                  },
                },
              },
            },
          },
          401: unauthorized,
        },
      },
    })

    .post('/push-token', controller.registerPushToken, {
      body: documented(registerPushTokenSchema),
      detail: {
        tags: ['Notifications'],
        summary: 'Register or refresh this device’s push token',
        description:
          'Upserts on `deviceId`, so calling it again with a rotated token replaces the old one ' +
          'rather than creating a duplicate, and reactivates a device that was removed. Answers ' +
          '**200**, not 201, on both create and update.',
        ...bearer,
        requestBody: bodyDoc(registerPushTokenSchema),
        responses: {
          200: okDoc('Push token stored for this device', {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              user_id: { type: 'string', format: 'uuid' },
              device_id: { type: 'string' },
              platform: { type: 'string', enum: ['ios', 'android', 'web'] },
              is_active: { type: 'boolean' },
              updated_at: { type: 'string', format: 'date-time' },
            },
          }),
          400: errorDoc('Request body failed validation', 'VALIDATION_ERROR'),
          401: unauthorized,
        },
      },
    })

    .delete('/push-token/:deviceId', controller.removePushToken, {
      detail: {
        tags: ['Notifications'],
        summary: 'Stop push delivery to one device',
        description:
          'Idempotent: removing a device that was never registered still answers 200, so a ' +
          'logout flow can call it unconditionally.',
        ...bearer,
        parameters: [
          {
            name: 'deviceId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'The `deviceId` used when the token was registered',
          },
        ],
        responses: {
          200: okDoc('Push token removed', { type: 'null' }),
          401: unauthorized,
        },
      },
    })

    .get('/unread-count', controller.getUnreadCount, {
      detail: {
        tags: ['Notifications'],
        summary: 'Number of unread notifications',
        description: 'Cheap enough for a badge, but it is still a request per call — poll gently.',
        ...bearer,
        responses: {
          200: okDoc(
            'Unread count',
            { type: 'object', properties: { count: { type: 'integer' } } },
            { count: 4 },
          ),
          401: unauthorized,
        },
      },
    })

    .get('/preferences', controller.getPreferences, {
      detail: {
        tags: ['Notifications'],
        summary: 'Get notification preferences',
        description:
          'Preferences are created with defaults on first read, so this never answers 404 for a ' +
          'user who has not set any.',
        ...bearer,
        responses: {
          200: okDoc('Current preferences', PREFERENCES_SHAPE),
          401: unauthorized,
        },
      },
    })

    .put('/preferences', controller.updatePreferences, {
      body: documented(notificationPreferencesSchema),
      detail: {
        tags: ['Notifications'],
        summary: 'Update notification preferences',
        description:
          'Replaces the preference blocks you send. `channels` and `reminders` are both required ' +
          'by the validator — send the full block, not a single toggle. `user_id` and ' +
          '`updated_at` in the body are ignored; the record always belongs to the authenticated ' +
          'user.',
        ...bearer,
        requestBody: bodyDoc(notificationPreferencesSchema),
        responses: {
          200: okDoc('Preferences after the update', PREFERENCES_SHAPE),
          400: errorDoc('Request body failed validation', 'VALIDATION_ERROR'),
          401: unauthorized,
        },
      },
    })

    .patch('/read-all', controller.markAllAsRead, {
      detail: {
        tags: ['Notifications'],
        summary: 'Mark every unread notification read',
        ...bearer,
        responses: {
          200: okDoc(
            'How many were marked',
            { type: 'object', properties: { markedAsRead: { type: 'integer' } } },
            { markedAsRead: 4 },
          ),
          401: unauthorized,
        },
      },
    })

    .patch('/:id/read', controller.markAsRead, {
      detail: {
        tags: ['Notifications'],
        summary: 'Mark one notification read',
        ...bearer,
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
            description: 'Notification id (must belong to the caller)',
          },
        ],
        responses: {
          200: okDoc('Notification with `read_at` set', NOTIFICATION_SHAPE),
          401: unauthorized,
          404: notYours,
        },
      },
    })

    .delete('/:id', controller.deleteNotification, {
      detail: {
        tags: ['Notifications'],
        summary: 'Delete one notification',
        ...bearer,
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
            description: 'Notification id (must belong to the caller)',
          },
        ],
        responses: {
          200: okDoc('Notification deleted', { type: 'null' }),
          401: unauthorized,
          404: notYours,
        },
      },
    });

  return new Elysia({ prefix: '/notifications' }).use(adminRoutes).use(authRoutes);
}
