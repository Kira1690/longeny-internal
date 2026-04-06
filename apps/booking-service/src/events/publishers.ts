import type { EventPublisher } from '@longeny/events';
import { EVENT_NAMES } from '@longeny/types';

// ─── Booking Events ────────────────────────────────────────────

interface BookingCreatedPayload {
  bookingId: string;
  userId: string;
  providerId: string;
  sessionType: string;
  startTime: string;
  endTime: string;
  price: number;
  currency: string;
}

export async function publishBookingCreated(
  publisher: EventPublisher,
  payload: BookingCreatedPayload,
): Promise<void> {
  await publisher.publish(EVENT_NAMES.BOOKING_CREATED, payload);
}

interface BookingConfirmedPayload {
  bookingId: string;
  userId: string;
  providerId: string;
  startTime: string;
  endTime: string;
}

export async function publishBookingConfirmed(
  publisher: EventPublisher,
  payload: BookingConfirmedPayload,
): Promise<void> {
  await publisher.publish(EVENT_NAMES.BOOKING_CONFIRMED, payload);
}

interface BookingCancelledPayload {
  bookingId: string;
  userId: string;
  providerId: string;
  cancelledBy: string;
  reason: string | null;
  isLateCancellation: boolean;
}

export async function publishBookingCancelled(
  publisher: EventPublisher,
  payload: BookingCancelledPayload,
): Promise<void> {
  await publisher.publish(EVENT_NAMES.BOOKING_CANCELLED, payload);
}

interface BookingCompletedPayload {
  bookingId: string;
  userId: string;
  providerId: string;
  completedAt: string;
}

export async function publishBookingCompleted(
  publisher: EventPublisher,
  payload: BookingCompletedPayload,
): Promise<void> {
  await publisher.publish(EVENT_NAMES.BOOKING_COMPLETED, payload);
}

interface BookingReminderDuePayload {
  reminderId: string;
  bookingId: string;
  userId: string;
  providerId: string;
  reminderType: string;
  startTime: string;
}

export async function publishBookingReminderDue(
  publisher: EventPublisher,
  payload: BookingReminderDuePayload,
): Promise<void> {
  await publisher.publish(EVENT_NAMES.BOOKING_REMINDER_DUE, payload);
}
