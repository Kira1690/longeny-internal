import type { NotificationService } from '../services/notification.service.js';
import { parsePaginationParams, buildPaginationMeta } from '@longeny/utils';

export class NotificationController {
  constructor(private notificationService: NotificationService) {}

  // GET /notifications
  listNotifications = async ({ store, query }: any) => {
    const { page, limit } = parsePaginationParams(query);

    const { notifications, total } = await this.notificationService.listNotifications(store.userId, {
      page,
      limit,
    });

    return {
      success: true,
      data: notifications,
      pagination: buildPaginationMeta(total, page, limit),
      meta: { timestamp: new Date().toISOString() },
    };
  };

  // GET /notifications/unread-count
  getUnreadCount = async ({ store }: any) => {
    const count = await this.notificationService.getUnreadCount(store.userId);

    return {
      success: true,
      data: { count },
      meta: { timestamp: new Date().toISOString() },
    };
  };

  // PATCH /notifications/:id/read
  markAsRead = async ({ params, store }: any) => {
    const notification = await this.notificationService.markAsRead(params.id, store.userId);

    return {
      success: true,
      data: notification,
      meta: { timestamp: new Date().toISOString() },
    };
  };

  // PATCH /notifications/read-all
  markAllAsRead = async ({ store }: any) => {
    const count = await this.notificationService.markAllAsRead(store.userId);

    return {
      success: true,
      data: { markedAsRead: count },
      message: `${count} notifications marked as read`,
      meta: { timestamp: new Date().toISOString() },
    };
  };

  // DELETE /notifications/:id
  deleteNotification = async ({ params, store }: any) => {
    await this.notificationService.deleteNotification(params.id, store.userId);

    return {
      success: true,
      data: null,
      message: 'Notification deleted',
      meta: { timestamp: new Date().toISOString() },
    };
  };

  // POST /notifications/push-token
  registerPushToken = async ({ store, body }: any) => {
    const token = await this.notificationService.registerPushToken(store.userId, {
      token: body.token,
      platform: body.platform,
      deviceId: body.deviceId,
    });

    return {
      success: true,
      data: token,
      message: 'Push token registered',
      meta: { timestamp: new Date().toISOString() },
    };
  };

  // DELETE /notifications/push-token/:deviceId
  removePushToken = async ({ store, params }: any) => {
    await this.notificationService.removePushToken(store.userId, params.deviceId);

    return {
      success: true,
      data: null,
      message: 'Push token removed',
      meta: { timestamp: new Date().toISOString() },
    };
  };

  // POST /notifications/send (admin only)
  sendNotification = async ({ body }: any) => {
    const notification = await this.notificationService.sendNotification({
      userId: body.userId,
      bookingId: body.bookingId,
      type: body.type,
      category: body.category,
      title: body.title,
      body: body.body,
      bodyHtml: body.bodyHtml,
      data: body.data,
      priority: body.priority,
      templateId: body.templateId,
    });

    return {
      success: true,
      data: notification,
      message: 'Notification sent',
      meta: { timestamp: new Date().toISOString() },
    };
  };

  // POST /notifications/broadcast (admin only)
  broadcastNotification = async ({ body }: any) => {
    const result = await this.notificationService.broadcastNotification({
      type: body.type,
      category: body.category,
      title: body.title,
      body: body.body,
      bodyHtml: body.bodyHtml,
      data: body.data,
      priority: body.priority,
      userIds: body.userIds,
      templateId: body.templateId,
    });

    return {
      success: true,
      data: result,
      message: 'Broadcast sent',
      meta: { timestamp: new Date().toISOString() },
    };
  };

  // GET /notifications/templates (admin only)
  listTemplates = async ({ query }: any) => {
    const { page, limit } = parsePaginationParams(query);

    const { templates, total } = await this.notificationService.listTemplates({ page, limit });

    return {
      success: true,
      data: templates,
      pagination: buildPaginationMeta(total, page, limit),
      meta: { timestamp: new Date().toISOString() },
    };
  };

  // PUT /notifications/templates/:id (admin only)
  updateTemplate = async ({ params, body }: any) => {
    const template = await this.notificationService.updateTemplate(params.id, body);

    return {
      success: true,
      data: template,
      message: 'Template updated',
      meta: { timestamp: new Date().toISOString() },
    };
  };

  // GET /notifications/preferences
  getPreferences = async ({ store }: any) => {
    const preferences = await this.notificationService.getPreferences(store.userId);

    return {
      success: true,
      data: preferences,
      meta: { timestamp: new Date().toISOString() },
    };
  };

  // PUT /notifications/preferences
  updatePreferences = async ({ store, body }: any) => {
    delete body.user_id;
    delete body.updated_at;

    const preferences = await this.notificationService.updatePreferences(store.userId, body);

    return {
      success: true,
      data: preferences,
      message: 'Notification preferences updated',
      meta: { timestamp: new Date().toISOString() },
    };
  };
}
