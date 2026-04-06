import { db } from '../db/index.js';
import { sql, eq, and, isNull, lt, inArray } from 'drizzle-orm';
import {
  notifications,
  notification_templates,
  notification_preferences,
  push_tokens,
  scheduled_notifications,
} from '../db/schema.js';
import { NotFoundError } from '@longeny/errors';
import { createLogger } from '@longeny/utils';
import type { BookingConfig } from '@longeny/config';

const logger = createLogger('booking-service:notification');

const MAX_RETRIES = 3;

interface SendNotificationInput {
  userId: string;
  bookingId?: string;
  type: 'email' | 'sms' | 'push' | 'in_app';
  category: 'booking' | 'payment' | 'system' | 'marketing' | 'reminder' | 'document' | 'provider' | 'progress';
  title: string;
  body: string;
  bodyHtml?: string;
  data?: Record<string, unknown>;
  priority?: number;
  templateId?: string;
}

export class NotificationService {
  constructor(
    _prismaUnused: unknown,
    private config: BookingConfig,
  ) {}

  async sendNotification(input: SendNotificationInput) {
    const preferences = await this.getOrCreatePreferences(input.userId);
    const isAllowed = this.checkPreferences(preferences, input.category, input.type);

    if (!isAllowed) {
      logger.debug({ userId: input.userId, type: input.type, category: input.category }, 'Notification blocked by user preferences');
      const [notification] = await db.insert(notifications).values({
        user_id: input.userId,
        booking_id: input.bookingId || null,
        type: input.type,
        category: input.category,
        title: input.title,
        body: input.body,
        body_html: input.bodyHtml || null,
        data: input.data || null,
        template_id: input.templateId || null,
        status: 'read',
        priority: input.priority || 5,
      }).returning();
      return notification;
    }

    if (this.isQuietHours(preferences)) {
      logger.debug({ userId: input.userId }, 'Notification deferred due to quiet hours');
    }

    const [notification] = await db.insert(notifications).values({
      user_id: input.userId,
      booking_id: input.bookingId || null,
      type: input.type,
      category: input.category,
      title: input.title,
      body: input.body,
      body_html: input.bodyHtml || null,
      data: input.data || null,
      template_id: input.templateId || null,
      status: 'pending',
      priority: input.priority || 5,
    }).returning();

    try {
      await this.dispatch(notification);

      await db
        .update(notifications)
        .set({ status: 'sent', sent_at: new Date() })
        .where(eq(notifications.id, notification.id));

      logger.info({ notificationId: notification.id, userId: input.userId, type: input.type }, 'Notification sent');
    } catch (error) {
      await db
        .update(notifications)
        .set({
          status: 'failed',
          error_message: error instanceof Error ? error.message : 'Unknown error',
          retry_count: 1,
        })
        .where(eq(notifications.id, notification.id));
      logger.error({ notificationId: notification.id, error }, 'Notification dispatch failed');
    }

    return notification;
  }

  async createInAppNotification(input: Omit<SendNotificationInput, 'type'>) {
    const [notification] = await db.insert(notifications).values({
      user_id: input.userId,
      booking_id: input.bookingId || null,
      type: 'in_app',
      category: input.category,
      title: input.title,
      body: input.body,
      body_html: input.bodyHtml || null,
      data: input.data || null,
      template_id: input.templateId || null,
      status: 'delivered',
      priority: input.priority || 5,
      delivered_at: new Date(),
    }).returning();

    return notification;
  }

  async listNotifications(userId: string, options: { page: number; limit: number }) {
    const [rows, [{ count }]] = await Promise.all([
      db
        .select()
        .from(notifications)
        .where(eq(notifications.user_id, userId))
        .orderBy(sql`${notifications.created_at} DESC`)
        .limit(options.limit)
        .offset((options.page - 1) * options.limit),
      db.select({ count: sql<number>`COUNT(*)::int` }).from(notifications).where(eq(notifications.user_id, userId)),
    ]);

    return { notifications: rows, total: count };
  }

  async getUnreadCount(userId: string): Promise<number> {
    const [{ count }] = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(notifications)
      .where(
        and(
          eq(notifications.user_id, userId),
          isNull(notifications.read_at),
          eq(notifications.type, 'in_app'),
          inArray(notifications.status, ['delivered', 'sent']),
        ),
      );
    return count;
  }

  async markAsRead(notificationId: string, userId: string) {
    const [notification] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.id, notificationId))
      .limit(1);

    if (!notification) throw new NotFoundError('Notification', notificationId);
    if (notification.user_id !== userId) throw new NotFoundError('Notification', notificationId);

    const [updated] = await db
      .update(notifications)
      .set({ read_at: new Date(), status: 'read' })
      .where(eq(notifications.id, notificationId))
      .returning();

    return updated;
  }

  async markAllAsRead(userId: string): Promise<number> {
    const result = await db
      .update(notifications)
      .set({ read_at: new Date(), status: 'read' })
      .where(and(eq(notifications.user_id, userId), isNull(notifications.read_at)));

    return (result as any).rowCount ?? 0;
  }

  async deleteNotification(notificationId: string, userId: string): Promise<void> {
    const [notification] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.id, notificationId))
      .limit(1);

    if (!notification) throw new NotFoundError('Notification', notificationId);
    if (notification.user_id !== userId) throw new NotFoundError('Notification', notificationId);

    await db.delete(notifications).where(eq(notifications.id, notificationId));
  }

  async getPreferences(userId: string) {
    return this.getOrCreatePreferences(userId);
  }

  async updatePreferences(userId: string, data: Record<string, unknown>) {
    const [existing] = await db
      .select()
      .from(notification_preferences)
      .where(eq(notification_preferences.user_id, userId))
      .limit(1);

    if (existing) {
      const [updated] = await db
        .update(notification_preferences)
        .set({ ...data as any, updated_at: new Date() })
        .where(eq(notification_preferences.user_id, userId))
        .returning();
      return updated;
    } else {
      const [created] = await db
        .insert(notification_preferences)
        .values({ user_id: userId, ...data as any })
        .returning();
      return created;
    }
  }

  async registerPushToken(userId: string, input: { token: string; platform: string; deviceId: string }) {
    const [existing] = await db
      .select()
      .from(push_tokens)
      .where(and(eq(push_tokens.user_id, userId), eq(push_tokens.device_id, input.deviceId)))
      .limit(1);

    let result;
    if (existing) {
      [result] = await db
        .update(push_tokens)
        .set({ token: input.token, platform: input.platform as any, is_active: true, updated_at: new Date() })
        .where(eq(push_tokens.id, existing.id))
        .returning();
    } else {
      [result] = await db
        .insert(push_tokens)
        .values({
          user_id: userId,
          token: input.token,
          platform: input.platform as any,
          device_id: input.deviceId,
          is_active: true,
        })
        .returning();
    }

    logger.info({ userId, deviceId: input.deviceId }, 'Push token registered');
    return result;
  }

  async removePushToken(userId: string, deviceId: string): Promise<void> {
    await db
      .update(push_tokens)
      .set({ is_active: false, updated_at: new Date() })
      .where(and(eq(push_tokens.user_id, userId), eq(push_tokens.device_id, deviceId)));

    logger.info({ userId, deviceId }, 'Push token removed');
  }

  async broadcastNotification(input: {
    type: 'email' | 'sms' | 'push' | 'in_app';
    category: 'booking' | 'payment' | 'system' | 'marketing' | 'reminder' | 'document' | 'provider' | 'progress';
    title: string;
    body: string;
    bodyHtml?: string;
    data?: Record<string, unknown>;
    priority?: number;
    userIds?: string[];
    templateId?: string;
  }): Promise<{ sent: number; failed: number }> {
    let userIds = input.userIds;

    if (!userIds || userIds.length === 0) {
      const prefs = await db
        .select({ user_id: notification_preferences.user_id })
        .from(notification_preferences)
        .limit(10000);
      userIds = prefs.map((p) => p.user_id);
    }

    let sent = 0;
    let failed = 0;

    for (const userId of userIds) {
      try {
        await this.sendNotification({
          userId,
          type: input.type,
          category: input.category,
          title: input.title,
          body: input.body,
          bodyHtml: input.bodyHtml,
          data: input.data,
          priority: input.priority,
          templateId: input.templateId,
        });
        sent++;
      } catch (error) {
        failed++;
        logger.error({ userId, error }, 'Failed to send broadcast notification to user');
      }
    }

    logger.info({ sent, failed, total: userIds.length }, 'Broadcast notification completed');
    return { sent, failed };
  }

  async listTemplates(options: { page: number; limit: number }) {
    const [templates, [{ count }]] = await Promise.all([
      db
        .select()
        .from(notification_templates)
        .orderBy(sql`${notification_templates.created_at} DESC`)
        .limit(options.limit)
        .offset((options.page - 1) * options.limit),
      db.select({ count: sql<number>`COUNT(*)::int` }).from(notification_templates),
    ]);

    return { templates, total: count };
  }

  async updateTemplate(templateId: string, data: {
    name?: string;
    subject?: string;
    body?: string;
    bodyHtml?: string;
    category?: string;
    type?: string;
    variables?: Record<string, unknown>;
    isActive?: boolean;
  }) {
    const [template] = await db
      .select()
      .from(notification_templates)
      .where(eq(notification_templates.id, templateId))
      .limit(1);

    if (!template) throw new NotFoundError('NotificationTemplate', templateId);

    const updateData: Record<string, unknown> = { updated_at: new Date() };
    if (data.name !== undefined) updateData.name = data.name;
    if (data.subject !== undefined) updateData.subject = data.subject;
    if (data.body !== undefined) updateData.body_template = data.body;
    if (data.bodyHtml !== undefined) updateData.body_html_template = data.bodyHtml;
    if (data.category !== undefined) updateData.category = data.category;
    if (data.type !== undefined) updateData.type = data.type;
    if (data.variables !== undefined) updateData.variables = data.variables;
    if (data.isActive !== undefined) updateData.status = data.isActive ? 'active' : 'deprecated';

    const [updated] = await db
      .update(notification_templates)
      .set(updateData as any)
      .where(eq(notification_templates.id, templateId))
      .returning();

    logger.info({ templateId }, 'Notification template updated');
    return updated;
  }

  async retryFailedNotifications(): Promise<number> {
    const failed = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.status, 'failed'),
          lt(notifications.retry_count, MAX_RETRIES),
        ),
      )
      .orderBy(notifications.created_at)
      .limit(50);

    let retried = 0;

    for (const notification of failed) {
      try {
        await this.dispatch(notification);
        await db
          .update(notifications)
          .set({ status: 'sent', sent_at: new Date(), error_message: null })
          .where(eq(notifications.id, notification.id));
        retried++;
      } catch (error) {
        const newRetryCount = notification.retry_count + 1;
        await db
          .update(notifications)
          .set({
            retry_count: newRetryCount,
            error_message: error instanceof Error ? error.message : 'Unknown error',
            status: newRetryCount >= MAX_RETRIES ? 'failed' : 'pending',
          })
          .where(eq(notifications.id, notification.id));
      }
    }

    if (retried > 0) {
      logger.info({ retried, total: failed.length }, 'Retried failed notifications');
    }

    return retried;
  }

  async getUserNotificationsForExport(userId: string) {
    return db
      .select()
      .from(notifications)
      .where(eq(notifications.user_id, userId))
      .orderBy(sql`${notifications.created_at} DESC`);
  }

  async deleteUserNotifications(userId: string): Promise<void> {
    await db.delete(scheduled_notifications).where(eq(scheduled_notifications.user_id, userId));
    await db.delete(notifications).where(eq(notifications.user_id, userId));
    await db.delete(notification_preferences).where(eq(notification_preferences.user_id, userId));
    await db.delete(push_tokens).where(eq(push_tokens.user_id, userId));

    logger.info({ userId }, 'User notifications deleted for GDPR');
  }

  private async getOrCreatePreferences(userId: string) {
    const [prefs] = await db
      .select()
      .from(notification_preferences)
      .where(eq(notification_preferences.user_id, userId))
      .limit(1);

    if (prefs) return prefs;

    const [created] = await db
      .insert(notification_preferences)
      .values({ user_id: userId })
      .returning();

    return created;
  }

  private checkPreferences(prefs: any, category: string, type: string): boolean {
    const key = `${category}_${type}`;
    if (key in prefs) return Boolean(prefs[key]);
    if (type === 'in_app') return true;
    if (category === 'system') return true;
    return false;
  }

  private isQuietHours(prefs: any): boolean {
    if (!prefs.quiet_hours_start || !prefs.quiet_hours_end) return false;

    const now = new Date();
    const currentTime = `${now.getUTCHours().toString().padStart(2, '0')}:${now.getUTCMinutes().toString().padStart(2, '0')}`;

    if (prefs.quiet_hours_start <= prefs.quiet_hours_end) {
      return currentTime >= prefs.quiet_hours_start && currentTime <= prefs.quiet_hours_end;
    }

    return currentTime >= prefs.quiet_hours_start || currentTime <= prefs.quiet_hours_end;
  }

  private async dispatch(notification: any): Promise<void> {
    switch (notification.type) {
      case 'email':
        await this.dispatchEmail(notification);
        break;
      case 'sms':
        await this.dispatchSms(notification);
        break;
      case 'push':
        await this.dispatchPush(notification);
        break;
      case 'in_app':
        break;
      default:
        logger.warn({ type: notification.type }, 'Unknown notification type');
    }
  }

  private async dispatchEmail(notification: any): Promise<void> {
    logger.info(
      { notificationId: notification.id, userId: notification.user_id, smtpHost: this.config.SMTP_HOST },
      'Email dispatch stub: would send email',
    );
  }

  private async dispatchSms(notification: any): Promise<void> {
    logger.info(
      { notificationId: notification.id, userId: notification.user_id },
      'SMS dispatch stub: would send SMS',
    );
  }

  private async dispatchPush(notification: any): Promise<void> {
    const tokens = await db
      .select()
      .from(push_tokens)
      .where(and(eq(push_tokens.user_id, notification.user_id), eq(push_tokens.is_active, true)));

    if (tokens.length === 0) {
      logger.debug({ userId: notification.user_id }, 'No active push tokens found');
      return;
    }

    logger.info(
      { notificationId: notification.id, userId: notification.user_id, tokenCount: tokens.length },
      'Push dispatch stub: would send push notification',
    );
  }
}
