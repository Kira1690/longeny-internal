import { z } from 'zod';
import { uuidSchema } from './common.js';

export const createBookingSchema = z.object({
  providerId: uuidSchema,
  programId: uuidSchema.optional(),
  // These are the values the `session_type` Postgres enum can store. The
  // validator previously allowed one_on_one / group / follow_up, none of which
  // the database accepts — a request using them passed validation and then
  // crashed the insert with a 500.
  sessionType: z.enum(['consultation', 'followup', 'assessment', 'program_session', 'custom']),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  notes: z.string().max(2000).optional(),
  timezone: z.string().max(50).default('UTC'),
});

export const cancelBookingSchema = z.object({
  reason: z.string().max(1000).optional(),
});

export const rescheduleSchema = z.object({
  newStartTime: z.string().datetime(),
  newEndTime: z.string().datetime(),
  reason: z.string().max(1000).optional(),
});

export const notificationPreferencesSchema = z.object({
  channels: z.object({
    email: z.boolean().default(true),
    sms: z.boolean().default(false),
    push: z.boolean().default(true),
    inApp: z.boolean().default(true),
  }),
  reminders: z.object({
    twentyFourHour: z.boolean().default(true),
    oneHour: z.boolean().default(true),
    fifteenMin: z.boolean().default(false),
  }),
  categories: z.record(z.boolean()).optional(),
});

export const updateBookingSchema = z.object({
  startTime: z.string().datetime().optional(),
  endTime: z.string().datetime().optional(),
  notes: z.string().max(2000).optional(),
  timezone: z.string().max(50).optional(),
});

export const registerPushTokenSchema = z.object({
  deviceId: z.string().min(1).max(255),
  token: z.string().min(1).max(1024),
  platform: z.enum(['ios', 'android', 'web']),
});

/**
 * POST /calendar/invite — an appointment for someone with no login.
 *
 * The recipient is named by profile, never by email address: the address comes
 * from the profile's verified notification targets, so a caller cannot use this
 * endpoint to send mail to an arbitrary address.
 */
export const calendarInviteSchema = z
  .object({
    profileId: z.string().uuid(),
    title: z.string().trim().min(1).max(200),
    startTime: z.string().datetime(),
    endTime: z.string().datetime(),
    description: z.string().trim().max(2000).optional(),
    location: z.string().trim().max(300).optional(),
  })
  .superRefine((value, ctx) => {
    if (new Date(value.endTime) <= new Date(value.startTime)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endTime'],
        message: 'endTime must be after startTime',
      });
    }
  });
