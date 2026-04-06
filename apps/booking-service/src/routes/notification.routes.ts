import { Elysia } from 'elysia';
import { requireAuth, requireRole } from '@longeny/middleware';
import type { NotificationController } from '../controllers/notification.controller.js';

export function createNotificationRoutes(controller: NotificationController): Elysia {
  const authRequired = requireAuth();
  const adminRequired = requireRole('admin');

  // Admin-only section
  const adminRoutes = new Elysia()
    .use(authRequired)
    .use(adminRequired)
    .post('/send', controller.sendNotification)
    .post('/broadcast', controller.broadcastNotification)
    .get('/templates', controller.listTemplates)
    .put('/templates/:id', controller.updateTemplate);

  // Auth-required section (all users)
  const authRoutes = new Elysia()
    .use(authRequired)
    .get('/', controller.listNotifications)
    .post('/push-token', controller.registerPushToken)
    .delete('/push-token/:deviceId', controller.removePushToken)
    .get('/unread-count', controller.getUnreadCount)
    .get('/preferences', controller.getPreferences)
    .put('/preferences', controller.updatePreferences)
    .patch('/read-all', controller.markAllAsRead)
    .patch('/:id/read', controller.markAsRead)
    .delete('/:id', controller.deleteNotification);

  return new Elysia({ prefix: '/notifications' })
    .use(adminRoutes)
    .use(authRoutes);
}
