import { db } from '../db/index.js';
import { sql, eq, and, or, lt, gt, gte, lte, inArray, ne } from 'drizzle-orm';
import { bookings, booking_reminders, calendar_sync } from '../db/schema.js';
import type Redis from 'ioredis';
import { NotFoundError, ConflictError, BadRequestError, ForbiddenError } from '@longeny/errors';
import { createLogger, createServiceClient, fromISO } from '@longeny/utils';
import type { BookingConfig } from '@longeny/config';
import { publishBookingCreated, publishBookingConfirmed, publishBookingCancelled, publishBookingCompleted } from '../events/publishers.js';
import type { EventPublisher } from '@longeny/events';

const logger = createLogger('booking-service:booking');

const BOOKING_BUFFER_MINUTES = 10;
const LOCK_TTL_SECONDS = 5;

interface SlotInfo {
  startTime: string;
  endTime: string;
  durationMinutes: number;
}

interface AvailabilityRule {
  day_of_week: string;
  start_time: string;
  end_time: string;
  slot_duration_minutes: number;
  is_available: boolean;
}

interface AvailabilityOverride {
  date: string;
  start_time: string | null;
  end_time: string | null;
  is_blocked: boolean;
  reason: string | null;
}

interface CreateBookingInput {
  userId: string;
  providerId: string;
  programId?: string;
  sessionType: 'consultation' | 'followup' | 'assessment' | 'program_session' | 'custom';
  startTime: string;
  endTime: string;
  notes?: string;
  timezone: string;
}

export class BookingService {
  constructor(
    _prismaUnused: unknown,
    private redis: Redis,
    private publisher: EventPublisher,
    private config: BookingConfig,
  ) {}

  // ─── Slot Availability ───────────────────────────────────────

  async getAvailableSlots(providerId: string, date: string, timezone: string): Promise<SlotInfo[]> {
    const targetDate = fromISO(`${date}T00:00:00Z`);
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const dayOfWeek = dayNames[targetDate.getUTCDay()];

    const rules = await this.fetchProviderAvailabilityRules(providerId, dayOfWeek!);
    if (rules.length === 0) return [];

    const overrides = await this.fetchProviderOverrides(providerId, date);

    const dayStart = new Date(`${date}T00:00:00Z`);
    const dayEnd = new Date(`${date}T23:59:59Z`);

    const existingBookings = await db
      .select({ start_time: bookings.start_time, end_time: bookings.end_time })
      .from(bookings)
      .where(
        and(
          eq(bookings.provider_id, providerId),
          gte(bookings.start_time, dayStart),
          lte(bookings.end_time, dayEnd),
          inArray(bookings.status, ['pending', 'confirmed', 'in_progress']),
        ),
      );

    const calendarBlocks = await this.fetchCalendarBlocks(providerId, date);

    const allSlots: SlotInfo[] = [];

    for (const rule of rules) {
      if (!rule.is_available) continue;

      const slotDuration = rule.slot_duration_minutes || 60;
      const [startH, startM] = rule.start_time.split(':').map(Number);
      const [endH, endM] = rule.end_time.split(':').map(Number);

      const ruleStartMinutes = startH! * 60 + startM!;
      const ruleEndMinutes = endH! * 60 + endM!;

      let cursor = ruleStartMinutes;
      while (cursor + slotDuration <= ruleEndMinutes) {
        const slotStartH = Math.floor(cursor / 60).toString().padStart(2, '0');
        const slotStartM = (cursor % 60).toString().padStart(2, '0');
        const slotEndCursor = cursor + slotDuration;
        const slotEndH = Math.floor(slotEndCursor / 60).toString().padStart(2, '0');
        const slotEndM = (slotEndCursor % 60).toString().padStart(2, '0');

        allSlots.push({
          startTime: `${date}T${slotStartH}:${slotStartM}:00Z`,
          endTime: `${date}T${slotEndH}:${slotEndM}:00Z`,
          durationMinutes: slotDuration,
        });

        cursor += slotDuration;
      }
    }

    const availableSlots = allSlots.filter((slot) => {
      const slotStart = new Date(slot.startTime).getTime();
      const slotEnd = new Date(slot.endTime).getTime();

      for (const override of overrides) {
        if (override.is_blocked) {
          if (override.start_time && override.end_time) {
            const blockStart = new Date(`${date}T${override.start_time}:00Z`).getTime();
            const blockEnd = new Date(`${date}T${override.end_time}:00Z`).getTime();
            if (slotStart < blockEnd && slotEnd > blockStart) return false;
          } else {
            return false;
          }
        }
      }

      for (const booking of existingBookings) {
        const bookingStart = booking.start_time.getTime() - BOOKING_BUFFER_MINUTES * 60 * 1000;
        const bookingEnd = booking.end_time.getTime() + BOOKING_BUFFER_MINUTES * 60 * 1000;
        if (slotStart < bookingEnd && slotEnd > bookingStart) return false;
      }

      for (const block of calendarBlocks) {
        const blockStart = new Date(block.start).getTime();
        const blockEnd = new Date(block.end).getTime();
        if (slotStart < blockEnd && slotEnd > blockStart) return false;
      }

      return true;
    });

    return availableSlots;
  }

  // ─── Create Booking ──────────────────────────────────────────

  async createBooking(input: CreateBookingInput) {
    const { userId, providerId, startTime, endTime, timezone } = input;
    const date = startTime.slice(0, 10);
    const lockKey = `booking:lock:${providerId}:${date}`;

    const lockValue = crypto.randomUUID();
    const acquired = await this.redis.set(lockKey, lockValue, 'EX', LOCK_TTL_SECONDS, 'NX');

    if (!acquired) {
      throw new ConflictError('Another booking is being processed for this time slot. Please retry.');
    }

    try {
      const startDate = fromISO(startTime);
      const endDate = fromISO(endTime);
      const durationMinutes = Math.round((endDate.getTime() - startDate.getTime()) / 60000);

      const [conflicting] = await db
        .select()
        .from(bookings)
        .where(
          and(
            eq(bookings.provider_id, providerId),
            inArray(bookings.status, ['pending', 'confirmed', 'in_progress']),
            lt(bookings.start_time, endDate),
            gt(bookings.end_time, startDate),
          ),
        )
        .limit(1);

      if (conflicting) {
        throw new ConflictError('This time slot is no longer available');
      }

      const providerInfo = await this.fetchProviderInfo(providerId);
      const price = providerInfo?.sessionPrice ?? 0;

      const [booking] = await db
        .insert(bookings)
        .values({
          user_id: userId,
          provider_id: providerId,
          program_id: input.programId || null,
          session_type: input.sessionType as any,
          status: 'pending',
          title: `${input.sessionType.replace(/_/g, ' ')} session`,
          start_time: startDate,
          end_time: endDate,
          duration_minutes: durationMinutes,
          timezone,
          notes: input.notes || null,
          is_virtual: true,
          price: price.toString(),
          currency: 'USD',
        })
        .returning();

      const reminderOffsets = [
        { type: '24h' as const, minutes: 24 * 60 },
        { type: '1h' as const, minutes: 60 },
        { type: '15min' as const, minutes: 15 },
      ];

      const now = new Date();
      const remindersData = reminderOffsets
        .map((r) => {
          const scheduledAt = new Date(startDate.getTime() - r.minutes * 60 * 1000);
          if (scheduledAt <= now) return null;
          return {
            booking_id: booking.id,
            user_id: userId,
            reminder_type: r.type,
            scheduled_at: scheduledAt,
            status: 'pending' as const,
            message: `Reminder: Your ${input.sessionType.replace(/_/g, ' ')} session is in ${r.minutes >= 60 ? `${r.minutes / 60}h` : `${r.minutes}min`}`,
          };
        })
        .filter(Boolean) as any[];

      if (remindersData.length > 0) {
        await db.insert(booking_reminders).values(remindersData);
      }

      await publishBookingCreated(this.publisher, {
        bookingId: booking.id,
        userId,
        providerId,
        sessionType: input.sessionType,
        startTime,
        endTime,
        price: Number(booking.price),
        currency: booking.currency,
      });

      logger.info({ bookingId: booking.id, userId, providerId }, 'Booking created');
      return booking;
    } finally {
      const currentValue = await this.redis.get(lockKey);
      if (currentValue === lockValue) {
        await this.redis.del(lockKey);
      }
    }
  }

  // ─── Get Booking ─────────────────────────────────────────────

  async getBooking(bookingId: string, userId: string) {
    const [booking] = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .limit(1);

    if (!booking) throw new NotFoundError('Booking', bookingId);

    if (booking.user_id !== userId && booking.provider_id !== userId) {
      throw new ForbiddenError('You do not have access to this booking');
    }

    const reminders = await db
      .select()
      .from(booking_reminders)
      .where(eq(booking_reminders.booking_id, bookingId));

    return { ...booking, reminders };
  }

  // ─── List User Bookings ──────────────────────────────────────

  async listUserBookings(userId: string, options: {
    status?: string;
    timeframe?: 'upcoming' | 'past';
    page: number;
    limit: number;
  }) {
    const now = new Date();
    const conditions: any[] = [eq(bookings.user_id, userId)];

    if (options.status) {
      conditions.push(sql`${bookings.status}::text = ${options.status}`);
    }

    if (options.timeframe === 'upcoming') {
      conditions.push(gte(bookings.start_time, now));
      conditions.push(inArray(bookings.status, ['pending', 'confirmed']));
    } else if (options.timeframe === 'past') {
      conditions.push(lt(bookings.start_time, now));
    }

    const whereClause = and(...conditions);
    const orderCol = options.timeframe === 'past' ? sql`${bookings.start_time} DESC` : bookings.start_time;

    const [rows, [{ count }]] = await Promise.all([
      db
        .select()
        .from(bookings)
        .where(whereClause)
        .orderBy(orderCol)
        .limit(options.limit)
        .offset((options.page - 1) * options.limit),
      db.select({ count: sql<number>`COUNT(*)::int` }).from(bookings).where(whereClause),
    ]);

    return { bookings: rows, total: count };
  }

  // ─── List Provider Bookings ──────────────────────────────────

  async listProviderBookings(providerId: string, options: {
    status?: string;
    date?: string;
    page: number;
    limit: number;
  }) {
    const conditions: any[] = [eq(bookings.provider_id, providerId)];

    if (options.status) {
      conditions.push(sql`${bookings.status}::text = ${options.status}`);
    }

    if (options.date) {
      const dayStart = new Date(`${options.date}T00:00:00Z`);
      const dayEnd = new Date(`${options.date}T23:59:59Z`);
      conditions.push(gte(bookings.start_time, dayStart));
      conditions.push(lte(bookings.end_time, dayEnd));
    }

    const whereClause = and(...conditions);

    const [rows, [{ count }]] = await Promise.all([
      db
        .select()
        .from(bookings)
        .where(whereClause)
        .orderBy(bookings.start_time)
        .limit(options.limit)
        .offset((options.page - 1) * options.limit),
      db.select({ count: sql<number>`COUNT(*)::int` }).from(bookings).where(whereClause),
    ]);

    return { bookings: rows, total: count };
  }

  // ─── Update Booking ─────────────────────────────────────────

  async updateBooking(bookingId: string, userId: string, data: {
    notes?: string;
    sessionType?: string;
    title?: string;
  }) {
    const [booking] = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .limit(1);

    if (!booking) throw new NotFoundError('Booking', bookingId);

    if (booking.user_id !== userId && booking.provider_id !== userId) {
      throw new ForbiddenError('You do not have permission to update this booking');
    }

    if (['cancelled', 'completed', 'no_show'].includes(booking.status)) {
      throw new BadRequestError(`Cannot update booking with status '${booking.status}'`);
    }

    const updateData: Record<string, unknown> = { updated_at: new Date() };
    if (data.notes !== undefined) updateData.notes = data.notes;
    if (data.sessionType !== undefined) updateData.session_type = data.sessionType;
    if (data.title !== undefined) updateData.title = data.title;

    const [updated] = await db
      .update(bookings)
      .set(updateData as any)
      .where(eq(bookings.id, bookingId))
      .returning();

    logger.info({ bookingId, userId }, 'Booking updated');
    return updated;
  }

  // ─── List Provider Upcoming Bookings ───────────────────────

  async listProviderUpcomingBookings(providerId: string, options: { page: number; limit: number }) {
    const now = new Date();
    const whereClause = and(
      eq(bookings.provider_id, providerId),
      gte(bookings.start_time, now),
      inArray(bookings.status, ['pending', 'confirmed']),
    );

    const [rows, [{ count }]] = await Promise.all([
      db
        .select()
        .from(bookings)
        .where(whereClause)
        .orderBy(bookings.start_time)
        .limit(options.limit)
        .offset((options.page - 1) * options.limit),
      db.select({ count: sql<number>`COUNT(*)::int` }).from(bookings).where(whereClause),
    ]);

    return { bookings: rows, total: count };
  }

  // ─── Confirm Booking ─────────────────────────────────────────

  async confirmBooking(bookingId: string, providerId: string) {
    const [booking] = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .limit(1);

    if (!booking) throw new NotFoundError('Booking', bookingId);

    if (booking.provider_id !== providerId) {
      throw new ForbiddenError('Only the assigned provider can confirm this booking');
    }

    if (booking.status !== 'pending') {
      throw new BadRequestError(`Cannot confirm booking with status '${booking.status}'`);
    }

    const [updated] = await db
      .update(bookings)
      .set({ status: 'confirmed', updated_at: new Date() })
      .where(eq(bookings.id, bookingId))
      .returning();

    await publishBookingConfirmed(this.publisher, {
      bookingId: updated.id,
      userId: updated.user_id,
      providerId: updated.provider_id,
      startTime: updated.start_time.toISOString(),
      endTime: updated.end_time.toISOString(),
    });

    logger.info({ bookingId, providerId }, 'Booking confirmed');
    return updated;
  }

  // ─── Cancel Booking ──────────────────────────────────────────

  async cancelBooking(bookingId: string, userId: string, _userRole: string, reason?: string) {
    const [booking] = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .limit(1);

    if (!booking) throw new NotFoundError('Booking', bookingId);

    let cancelledBy: 'user' | 'provider' | 'system';
    if (booking.provider_id === userId) {
      cancelledBy = 'provider';
    } else if (booking.user_id === userId) {
      cancelledBy = 'user';
    } else {
      throw new ForbiddenError('You do not have permission to cancel this booking');
    }

    if (!['pending', 'confirmed'].includes(booking.status)) {
      throw new BadRequestError(`Cannot cancel booking with status '${booking.status}'`);
    }

    const hoursUntilStart = (booking.start_time.getTime() - Date.now()) / (1000 * 60 * 60);
    const isLateCancellation = cancelledBy === 'user' && hoursUntilStart < 24;

    const [updated] = await db
      .update(bookings)
      .set({
        status: 'cancelled',
        cancelled_by: cancelledBy,
        cancellation_reason: reason || (isLateCancellation ? 'Late cancellation (within 24h)' : null),
        cancelled_at: new Date(),
        updated_at: new Date(),
      })
      .where(eq(bookings.id, bookingId))
      .returning();

    await db
      .update(booking_reminders)
      .set({ status: 'cancelled' })
      .where(
        and(
          eq(booking_reminders.booking_id, bookingId),
          eq(booking_reminders.status, 'pending'),
        ),
      );

    await publishBookingCancelled(this.publisher, {
      bookingId: updated.id,
      userId: updated.user_id,
      providerId: updated.provider_id,
      cancelledBy,
      reason: reason || null,
      isLateCancellation,
    });

    logger.info({ bookingId, cancelledBy, reason }, 'Booking cancelled');
    return updated;
  }

  // ─── Reschedule Booking ──────────────────────────────────────

  async rescheduleBooking(bookingId: string, userId: string, newStartTime: string, newEndTime: string, reason?: string) {
    const [booking] = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .limit(1);

    if (!booking) throw new NotFoundError('Booking', bookingId);

    if (booking.user_id !== userId && booking.provider_id !== userId) {
      throw new ForbiddenError('You do not have permission to reschedule this booking');
    }

    if (!['pending', 'confirmed'].includes(booking.status)) {
      throw new BadRequestError(`Cannot reschedule booking with status '${booking.status}'`);
    }

    const newStart = fromISO(newStartTime);
    const newEnd = fromISO(newEndTime);
    const durationMinutes = Math.round((newEnd.getTime() - newStart.getTime()) / 60000);

    const [conflicting] = await db
      .select()
      .from(bookings)
      .where(
        and(
          eq(bookings.provider_id, booking.provider_id),
          ne(bookings.id, bookingId),
          inArray(bookings.status, ['pending', 'confirmed', 'in_progress']),
          lt(bookings.start_time, newEnd),
          gt(bookings.end_time, newStart),
        ),
      )
      .limit(1);

    if (conflicting) throw new ConflictError('The new time slot is not available');

    await db
      .update(booking_reminders)
      .set({ status: 'cancelled' })
      .where(
        and(
          eq(booking_reminders.booking_id, bookingId),
          eq(booking_reminders.status, 'pending'),
        ),
      );

    const [updated] = await db
      .update(bookings)
      .set({
        start_time: newStart,
        end_time: newEnd,
        duration_minutes: durationMinutes,
        status: 'pending',
        notes: reason
          ? `${booking.notes ? booking.notes + '\n' : ''}Rescheduled: ${reason}`
          : booking.notes,
        updated_at: new Date(),
      })
      .where(eq(bookings.id, bookingId))
      .returning();

    const now = new Date();
    const reminderOffsets = [
      { type: '24h' as const, minutes: 24 * 60 },
      { type: '1h' as const, minutes: 60 },
      { type: '15min' as const, minutes: 15 },
    ];

    const remindersData = reminderOffsets
      .map((r) => {
        const scheduledAt = new Date(newStart.getTime() - r.minutes * 60 * 1000);
        if (scheduledAt <= now) return null;
        return {
          booking_id: bookingId,
          user_id: booking.user_id,
          reminder_type: r.type,
          scheduled_at: scheduledAt,
          status: 'pending' as const,
          message: `Reminder: Your rescheduled session is in ${r.minutes >= 60 ? `${r.minutes / 60}h` : `${r.minutes}min`}`,
        };
      })
      .filter(Boolean) as any[];

    if (remindersData.length > 0) {
      await db.insert(booking_reminders).values(remindersData);
    }

    logger.info({ bookingId, newStartTime, newEndTime }, 'Booking rescheduled');
    return updated;
  }

  // ─── Complete Booking ────────────────────────────────────────

  async completeBooking(bookingId: string, providerId: string) {
    const [booking] = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .limit(1);

    if (!booking) throw new NotFoundError('Booking', bookingId);

    if (booking.provider_id !== providerId) {
      throw new ForbiddenError('Only the assigned provider can complete this booking');
    }

    if (!['confirmed', 'in_progress'].includes(booking.status)) {
      throw new BadRequestError(`Cannot complete booking with status '${booking.status}'`);
    }

    const [updated] = await db
      .update(bookings)
      .set({ status: 'completed', completed_at: new Date(), updated_at: new Date() })
      .where(eq(bookings.id, bookingId))
      .returning();

    await db
      .update(booking_reminders)
      .set({ status: 'cancelled' })
      .where(
        and(
          eq(booking_reminders.booking_id, bookingId),
          eq(booking_reminders.status, 'pending'),
        ),
      );

    await publishBookingCompleted(this.publisher, {
      bookingId: updated.id,
      userId: updated.user_id,
      providerId: updated.provider_id,
      completedAt: updated.completed_at!.toISOString(),
    });

    logger.info({ bookingId, providerId }, 'Booking completed');
    return updated;
  }

  // ─── No-Show ─────────────────────────────────────────────────

  async markNoShow(bookingId: string, providerId: string) {
    const [booking] = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .limit(1);

    if (!booking) throw new NotFoundError('Booking', bookingId);

    if (booking.provider_id !== providerId) {
      throw new ForbiddenError('Only the assigned provider can mark no-show');
    }

    if (!['confirmed', 'in_progress'].includes(booking.status)) {
      throw new BadRequestError(`Cannot mark no-show for booking with status '${booking.status}'`);
    }

    const [updated] = await db
      .update(bookings)
      .set({ status: 'no_show', updated_at: new Date() })
      .where(eq(bookings.id, bookingId))
      .returning();

    await db
      .update(booking_reminders)
      .set({ status: 'cancelled' })
      .where(
        and(
          eq(booking_reminders.booking_id, bookingId),
          eq(booking_reminders.status, 'pending'),
        ),
      );

    logger.info({ bookingId, providerId }, 'Booking marked as no-show');
    return updated;
  }

  // ─── GDPR ───────────────────────────────────────────────────

  async getUserBookingsForExport(userId: string) {
    const userBookings = await db
      .select()
      .from(bookings)
      .where(eq(bookings.user_id, userId));

    const enriched = await Promise.all(
      userBookings.map(async (b) => {
        const reminders = await db
          .select()
          .from(booking_reminders)
          .where(eq(booking_reminders.booking_id, b.id));
        return { ...b, reminders };
      }),
    );

    return enriched;
  }

  async anonymizeUserBookings(userId: string): Promise<void> {
    const anonymizedId = '00000000-0000-0000-0000-000000000000';

    await db
      .update(bookings)
      .set({ user_id: anonymizedId, notes: null, provider_notes: null, updated_at: new Date() })
      .where(eq(bookings.user_id, userId));

    await db
      .update(booking_reminders)
      .set({ user_id: anonymizedId, message: null })
      .where(eq(booking_reminders.user_id, userId));

    logger.info({ userId }, 'User bookings anonymized for GDPR');
  }

  // ─── Private helpers ─────────────────────────────────────────

  private async fetchProviderAvailabilityRules(providerId: string, dayOfWeek: string): Promise<AvailabilityRule[]> {
    try {
      const client = createServiceClient(
        'booking-service',
        Bun.env.USER_PROVIDER_SERVICE_URL || 'http://localhost:3002',
        this.config.HMAC_SECRET,
      );
      const response = await client.get<{ success: boolean; data: AvailabilityRule[] }>(
        `/internal/providers/${providerId}/availability?dayOfWeek=${dayOfWeek}`,
      );
      return response.data || [];
    } catch (error) {
      logger.warn({ providerId, dayOfWeek, error }, 'Failed to fetch availability rules, using defaults');
      const weekdays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
      if (weekdays.includes(dayOfWeek)) {
        return [{
          day_of_week: dayOfWeek,
          start_time: '09:00',
          end_time: '17:00',
          slot_duration_minutes: 60,
          is_available: true,
        }];
      }
      return [];
    }
  }

  private async fetchProviderOverrides(providerId: string, date: string): Promise<AvailabilityOverride[]> {
    try {
      const client = createServiceClient(
        'booking-service',
        Bun.env.USER_PROVIDER_SERVICE_URL || 'http://localhost:3002',
        this.config.HMAC_SECRET,
      );
      const response = await client.get<{ success: boolean; data: AvailabilityOverride[] }>(
        `/internal/providers/${providerId}/availability/overrides?date=${date}`,
      );
      return response.data || [];
    } catch (error) {
      logger.warn({ providerId, date, error }, 'Failed to fetch availability overrides');
      return [];
    }
  }

  private async fetchProviderInfo(providerId: string): Promise<{ sessionPrice: number } | null> {
    try {
      const client = createServiceClient(
        'booking-service',
        Bun.env.USER_PROVIDER_SERVICE_URL || 'http://localhost:3002',
        this.config.HMAC_SECRET,
      );
      const response = await client.get<{ success: boolean; data: { sessionPrice: number } }>(
        `/internal/providers/${providerId}`,
      );
      return response.data || null;
    } catch (error) {
      logger.warn({ providerId, error }, 'Failed to fetch provider info');
      return null;
    }
  }

  private async fetchCalendarBlocks(providerId: string, _date: string): Promise<Array<{ start: string; end: string }>> {
    try {
      const [calendarSyncRow] = await db
        .select()
        .from(calendar_sync)
        .where(eq(calendar_sync.provider_id, providerId))
        .limit(1);

      if (!calendarSyncRow || calendarSyncRow.status !== 'active') return [];
      return [];
    } catch (error) {
      logger.warn({ providerId, error }, 'Failed to fetch calendar blocks');
      return [];
    }
  }
}
