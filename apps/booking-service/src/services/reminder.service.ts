import { db } from '../db/index.js';
import { sql, eq, and, lte } from 'drizzle-orm';
import { booking_reminders, bookings } from '../db/schema.js';
import { createLogger } from '@longeny/utils';
import type { EventPublisher } from '@longeny/events';
import { publishBookingReminderDue } from '../events/publishers.js';
import type { NotificationService } from './notification.service.js';

const logger = createLogger('booking-service:reminder');

const POLL_INTERVAL_MS = 30_000;
const LOOKAHEAD_MS = 60_000;

export class ReminderService {
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private isProcessing = false;

  constructor(
    _prismaUnused: unknown,
    private publisher: EventPublisher,
    private notificationService: NotificationService,
  ) {}

  start(): void {
    if (this.pollTimer) {
      logger.warn('Reminder polling already started');
      return;
    }

    logger.info({ intervalMs: POLL_INTERVAL_MS }, 'Starting reminder polling');

    this.processDueReminders().catch((error) => {
      logger.error({ error }, 'Initial reminder processing failed');
    });

    this.pollTimer = setInterval(() => {
      this.processDueReminders().catch((error) => {
        logger.error({ error }, 'Reminder processing failed');
      });
    }, POLL_INTERVAL_MS);
  }

  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
      logger.info('Reminder polling stopped');
    }
  }

  async processDueReminders(): Promise<number> {
    if (this.isProcessing) return 0;

    this.isProcessing = true;

    try {
      const now = new Date();
      const lookahead = new Date(now.getTime() + LOOKAHEAD_MS);

      const dueReminders = await db
        .select()
        .from(booking_reminders)
        .where(
          and(
            eq(booking_reminders.status, 'pending'),
            lte(booking_reminders.scheduled_at, lookahead),
          ),
        )
        .orderBy(booking_reminders.scheduled_at)
        .limit(100);

      if (dueReminders.length === 0) return 0;

      logger.info({ count: dueReminders.length }, 'Processing due reminders');

      let processed = 0;

      for (const reminder of dueReminders) {
        try {
          const [booking] = await db
            .select()
            .from(bookings)
            .where(eq(bookings.id, reminder.booking_id))
            .limit(1);

          if (!booking || ['cancelled', 'completed', 'no_show'].includes(booking.status)) {
            await db
              .update(booking_reminders)
              .set({ status: 'cancelled' })
              .where(eq(booking_reminders.id, reminder.id));
            continue;
          }

          await this.notificationService.createInAppNotification({
            userId: reminder.user_id,
            bookingId: reminder.booking_id,
            category: 'reminder',
            title: 'Booking Reminder',
            body: reminder.message || `Your session is coming up at ${booking.start_time.toISOString()}`,
            data: {
              bookingId: reminder.booking_id,
              reminderType: reminder.reminder_type,
              startTime: booking.start_time.toISOString(),
            },
          });

          if (reminder.reminder_type === '24h' || reminder.reminder_type === '1h') {
            await this.notificationService.sendNotification({
              userId: reminder.user_id,
              bookingId: reminder.booking_id,
              type: 'email',
              category: 'reminder',
              title: 'Booking Reminder',
              body: reminder.message || `Your session is coming up at ${booking.start_time.toISOString()}`,
            });
          }

          await publishBookingReminderDue(this.publisher, {
            reminderId: reminder.id,
            bookingId: reminder.booking_id,
            userId: reminder.user_id,
            providerId: booking.provider_id,
            reminderType: reminder.reminder_type,
            startTime: booking.start_time.toISOString(),
          });

          await db
            .update(booking_reminders)
            .set({ status: 'sent', sent_at: new Date() })
            .where(eq(booking_reminders.id, reminder.id));

          processed++;
        } catch (error) {
          logger.error({ reminderId: reminder.id, bookingId: reminder.booking_id, error }, 'Failed to process reminder');

          await db
            .update(booking_reminders)
            .set({
              status: 'failed',
              error_message: error instanceof Error ? error.message : 'Unknown error',
            })
            .where(eq(booking_reminders.id, reminder.id));
        }
      }

      logger.info({ processed, total: dueReminders.length }, 'Reminder processing complete');
      return processed;
    } finally {
      this.isProcessing = false;
    }
  }

  async scheduleReminders(bookingId: string, userId: string, startTime: Date): Promise<void> {
    const now = new Date();

    const reminderOffsets = [
      { type: '24h' as const, minutes: 24 * 60 },
      { type: '1h' as const, minutes: 60 },
      { type: '15min' as const, minutes: 15 },
    ];

    const remindersData = reminderOffsets
      .map((r) => {
        const scheduledAt = new Date(startTime.getTime() - r.minutes * 60 * 1000);
        if (scheduledAt <= now) return null;
        return {
          booking_id: bookingId,
          user_id: userId,
          reminder_type: r.type,
          scheduled_at: scheduledAt,
          status: 'pending' as const,
          message: `Your session is in ${r.minutes >= 60 ? `${r.minutes / 60} hours` : `${r.minutes} minutes`}`,
        };
      })
      .filter(Boolean) as any[];

    if (remindersData.length > 0) {
      await db.insert(booking_reminders).values(remindersData);
      logger.info({ bookingId, count: remindersData.length }, 'Reminders scheduled');
    }
  }

  async cancelReminders(bookingId: string): Promise<void> {
    await db
      .update(booking_reminders)
      .set({ status: 'cancelled' })
      .where(and(eq(booking_reminders.booking_id, bookingId), eq(booking_reminders.status, 'pending')));
  }
}
