import {
  BookingStatus,
  SessionType,
  CancelledBy,
  ReminderType,
  NotificationType,
  NotificationCategory,
} from './enums.js';

export interface Booking {
  id: string;
  user_id: string;
  provider_id: string;
  program_id: string | null;
  session_type: SessionType;
  status: BookingStatus;
  title: string | null;
  start_time: Date;
  end_time: Date;
  duration_minutes: number;
  timezone: string;
  notes: string | null;
  provider_notes: string | null;
  meeting_link: string | null;
  is_virtual: boolean;
  location_address: string | null;
  price: number;
  currency: string;
  /** Cross-DB reference to payment_db.orders.id */
  order_id: string | null;
  cancellation_reason: string | null;
  cancelled_by: CancelledBy | null;
  cancelled_at: Date | null;
  completed_at: Date | null;
  google_event_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface BookingReminder {
  id: string;
  booking_id: string;
  user_id: string;
  reminder_type: ReminderType;
  message: string | null;
  scheduled_at: Date;
  sent_at: Date | null;
  status: string;
  error_message: string | null;
  created_at: Date;
}

export interface CalendarSync {
  id: string;
  provider_id: string;
  google_calendar_id: string | null;
  /** Encrypted Google OAuth access token */
  google_access_token_encrypted: string | null;
  /** Encrypted Google OAuth refresh token */
  google_refresh_token_encrypted: string | null;
  sync_token: string | null;
  last_synced_at: Date | null;
  status: string;
  error_message: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface Notification {
  id: string;
  user_id: string;
  booking_id: string | null;
  type: NotificationType;
  category: NotificationCategory;
  title: string;
  body: string;
  body_html: string | null;
  /** JSONB object containing notification-specific data */
  data: Record<string, unknown> | null;
  template_id: string | null;
  status: string;
  priority: number;
  external_message_id: string | null;
  error_message: string | null;
  retry_count: number;
  max_retries: number;
  read_at: Date | null;
  sent_at: Date | null;
  delivered_at: Date | null;
  created_at: Date;
}

export interface NotificationTemplate {
  id: string;
  name: string;
  type: NotificationType;
  category: NotificationCategory;
  subject: string | null;
  body_template: string;
  body_html_template: string | null;
  /** JSONB array of variable definitions */
  variables: Record<string, unknown> | unknown[];
  status: string;
  created_at: Date;
  updated_at: Date;
}

export interface NotificationPreference {
  user_id: string;
  booking_email: boolean;
  booking_sms: boolean;
  booking_push: boolean;
  payment_email: boolean;
  payment_sms: boolean;
  payment_push: boolean;
  reminder_email: boolean;
  reminder_sms: boolean;
  reminder_push: boolean;
  document_email: boolean;
  document_push: boolean;
  provider_email: boolean;
  provider_push: boolean;
  progress_push: boolean;
  marketing_email: boolean;
  marketing_sms: boolean;
  system_email: boolean;
  system_push: boolean;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  timezone: string;
  updated_at: Date;
}

export interface PushToken {
  id: string;
  user_id: string;
  device_id: string;
  token: string;
  platform: string;
  is_active: boolean;
  last_used_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface ScheduledNotification {
  id: string;
  notification_id: string | null;
  user_id: string;
  template_id: string | null;
  type: NotificationType;
  category: NotificationCategory;
  /** JSONB object containing template variable values */
  template_data: Record<string, unknown> | null;
  scheduled_at: Date;
  sent_at: Date | null;
  status: string;
  reference_type: string | null;
  reference_id: string | null;
  created_at: Date;
}

export interface RecurringBooking {
  id: string;
  user_id: string;
  provider_id: string;
  program_id: string | null;
  session_type: SessionType;
  title: string | null;
  duration_minutes: number;
  timezone: string;
  /** Recurrence rule (e.g., RRULE string or structured pattern) */
  recurrence_rule: string;
  start_date: Date;
  end_date: Date | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}
