import { z } from 'zod';
import { uuidSchema } from './common.js';

export const createBookingSchema = z.object({
  providerId: uuidSchema,
  programId: uuidSchema.optional(),
  sessionType: z.enum(['one_on_one', 'group', 'consultation', 'follow_up']),
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
