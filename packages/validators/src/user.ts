import { z } from 'zod';
import { phoneSchema, uuidSchema } from './common.js';

// ── User Profile ──
export const updateProfileSchema = z.object({
  firstName: z.string().min(1).max(100).trim().optional(),
  lastName: z.string().min(1).max(100).trim().optional(),
  phone: phoneSchema,
  avatarUrl: z.string().url().optional(),
  timezone: z.string().max(50).optional(),
  locale: z.string().max(10).optional(),
});

export const healthProfileSchema = z.object({
  dateOfBirth: z.string().date().optional(),
  gender: z.enum(['male', 'female', 'non_binary', 'prefer_not_to_say']).optional(),
  heightCm: z.number().positive().max(300).optional(),
  weightKg: z.number().positive().max(500).optional(),
  fitnessLevel: z.enum(['beginner', 'intermediate', 'advanced', 'elite']).optional(),
  medicalConditions: z.array(z.string()).optional(),
  medications: z.array(z.string()).optional(),
  allergies: z.array(z.string()).optional(),
  goals: z.array(z.string()).optional(),
});

export const onboardingSchema = z.object({
  firstName: z.string().min(1).max(100).trim(),
  lastName: z.string().min(1).max(100).trim(),
  phone: phoneSchema,
  healthProfile: healthProfileSchema.optional(),
  consents: z
    .array(
      z.object({
        consentType: z.string().min(1),
        granted: z.boolean(),
      }),
    )
    .optional(),
});

export const preferencesSchema = z.object({
  notifications: z
    .object({
      email: z.boolean().optional(),
      sms: z.boolean().optional(),
      push: z.boolean().optional(),
      inApp: z.boolean().optional(),
    })
    .optional(),
  language: z.string().max(10).optional(),
  timezone: z.string().max(50).optional(),
  theme: z.enum(['light', 'dark', 'system']).optional(),
});

// ── Provider ──
export const providerRegisterSchema = z.object({
  businessName: z.string().min(1).max(200).trim(),
  description: z.string().max(2000).optional(),
  specializations: z.array(z.string()).min(1),
  qualifications: z.array(z.string()).min(1),
  phone: phoneSchema,
  address: z
    .object({
      line1: z.string().min(1).max(200),
      line2: z.string().max(200).optional(),
      city: z.string().min(1).max(100),
      state: z.string().max(100).optional(),
      postalCode: z.string().max(20),
      country: z.string().min(2).max(3),
    })
    .optional(),
});

export const programSchema = z.object({
  title: z.string().min(1).max(200).trim(),
  description: z.string().max(5000),
  category: z.string().min(1),
  durationWeeks: z.number().int().positive().max(52),
  sessionsPerWeek: z.number().int().positive().max(14),
  maxParticipants: z.number().int().positive().optional(),
  priceType: z.enum(['one_time', 'per_session', 'subscription']),
  price: z.number().nonnegative(),
  currency: z.string().length(3).default('USD'),
});

export const productSchema = z.object({
  title: z.string().min(1).max(200).trim(),
  description: z.string().max(5000),
  category: z.string().min(1),
  price: z.number().nonnegative(),
  currency: z.string().length(3).default('USD'),
  stockQuantity: z.number().int().nonnegative().optional(),
  images: z.array(z.string().url()).max(10).optional(),
});

export const availabilityRuleSchema = z.object({
  dayOfWeek: z.enum([
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
    'sunday',
  ]),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, 'Must be HH:mm format'),
  endTime: z.string().regex(/^\d{2}:\d{2}$/, 'Must be HH:mm format'),
  slotDurationMinutes: z.number().int().positive().default(60),
  isAvailable: z.boolean().default(true),
});

export const reviewSchema = z.object({
  providerId: uuidSchema,
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(2000).optional(),
  bookingId: uuidSchema.optional(),
});

// ── Habits & Progress ──
export const habitSchema = z.object({
  name: z.string().min(1).max(200).trim(),
  description: z.string().max(1000).optional(),
  frequency: z.enum(['DAILY', 'WEEKLY', 'CUSTOM']),
  targetCount: z.number().int().positive().default(1),
  customDays: z
    .array(z.enum(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']))
    .optional(),
  reminderTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/, 'Must be HH:mm format')
    .optional(),
});

export const habitCheckinSchema = z.object({
  habitId: uuidSchema,
  completedAt: z.string().datetime().optional(),
  notes: z.string().max(500).optional(),
  value: z.number().optional(),
});

export const progressEntrySchema = z.object({
  metricType: z.string().min(1).max(100),
  value: z.number(),
  unit: z.string().max(50).optional(),
  notes: z.string().max(1000).optional(),
  recordedAt: z.string().datetime().optional(),
});
