import {
  CAREGIVER_CONSENT_TYPES,
  NOTIFICATION_CHANNELS as NOTIFY_CHANNELS,
  PROFILE_RELATIONS,
  RRO_STATES,
  RRO_TRANSITION_SOURCES,
} from '@longeny/types';
import { z } from 'zod';

// Re-export shared validators
export {
  uuidSchema,
  paginationSchema,
  updateProfileSchema,
  healthProfileSchema,
  onboardingSchema,
  preferencesSchema,
  providerRegisterSchema,
  programSchema,
  productSchema,
  availabilityRuleSchema,
  reviewSchema,
  habitSchema,
  habitCheckinSchema,
  progressEntrySchema,
} from '@longeny/validators';

// ── Service-specific schemas ──

export const updateProviderProfileSchema = z.object({
  businessName: z.string().min(1).max(200).trim().optional(),
  displayName: z.string().max(200).trim().optional(),
  bio: z.string().max(5000).optional(),
  specialties: z.array(z.string()).optional(),
  credentials: z.array(z.string()).optional(),
  yearsExperience: z.number().int().nonnegative().optional(),
  hourlyRate: z.number().nonnegative().optional(),
  currency: z.string().length(3).optional(),
  location: z
    .object({
      city: z.string().max(100).optional(),
      state: z.string().max(50).optional(),
      lat: z.number().optional(),
      lng: z.number().optional(),
    })
    .optional(),
  serviceAreaRadiusMiles: z.number().int().positive().optional(),
  offersVirtual: z.boolean().optional(),
  offersInPerson: z.boolean().optional(),
  websiteUrl: z.string().url().optional().nullable(),
  socialLinks: z.record(z.string()).optional(),
  cancellationPolicy: z.string().max(2000).optional(),
  cancellationHours: z.number().int().nonnegative().optional(),
});

export const verificationDocumentSchema = z.object({
  documentType: z.string().min(1).max(50),
  documentUrl: z.string().url(),
  notes: z.string().max(1000).optional(),
});

export const availabilityOverrideSchema = z.object({
  date: z.string().date(),
  startTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/, 'Must be HH:mm format')
    .optional(),
  endTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/, 'Must be HH:mm format')
    .optional(),
  isBlocked: z.boolean().default(false),
  reason: z.string().max(200).optional(),
});

export const marketplaceSearchSchema = z.object({
  q: z.string().max(200).optional(),
  category: z.string().max(100).optional(),
  subcategory: z.string().max(100).optional(),
  entityType: z.enum(['provider', 'program', 'product']).optional(),
  minPrice: z.coerce.number().nonnegative().optional(),
  maxPrice: z.coerce.number().nonnegative().optional(),
  offersVirtual: z.coerce.boolean().optional(),
  offersInPerson: z.coerce.boolean().optional(),
  city: z.string().max(100).optional(),
  state: z.string().max(50).optional(),
  minRating: z.coerce.number().min(0).max(5).optional(),
  sortBy: z
    .enum(['relevance', 'rating', 'price_asc', 'price_desc', 'newest', 'popularity'])
    .default('relevance'),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const savedItemSchema = z.object({
  entityType: z.enum(['provider', 'program', 'product']),
  entityId: z.string().uuid(),
});

export const adminProviderStatusSchema = z.object({
  status: z.enum(['pending', 'verified', 'suspended', 'rejected', 'deactivated']),
  reason: z.string().max(1000).optional(),
});

export const adminUserStatusSchema = z.object({
  status: z.enum(['active', 'inactive', 'suspended', 'deactivated']),
  reason: z.string().max(1000).optional(),
});

export const adminProgramStatusSchema = z.object({
  status: z.enum(['draft', 'active', 'paused', 'archived']),
  reason: z.string().max(1000).optional(),
});

export const adminModerationSchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'escalated']),
  reviewNotes: z.string().max(2000).optional(),
  actionTaken: z.string().max(100).optional(),
});

export const adminVerifyProviderSchema = z.object({
  verificationIds: z.array(z.string().uuid()).optional(),
  notes: z.string().max(1000).optional(),
});

/**
 * PUT /admin/providers/:id/suspend — the handler reads `body.reason`, so a
 * bodyless request used to dereference `undefined` and answer 500. Every field
 * is optional, which makes `{}` the minimum valid body; `.default({})` keeps a
 * genuinely absent body a 200 rather than turning the fix into a new 400.
 */
export const adminSuspendProviderSchema = z
  .object({
    reason: z.string().max(1000).optional(),
  })
  .default({});

/**
 * PUT /admin/settings — `settings` is required rather than defaulted: an absent
 * list used to make the call a silent no-op that still wrote an audit row.
 */
export const adminSettingsUpdateSchema = z.object({
  settings: z
    .array(
      z.object({
        key: z.string().min(1).max(200),
        // Any JSON value, including null — the column is jsonb and callers
        // legitimately store booleans, numbers and objects.
        value: z.unknown(),
      }),
    )
    .min(1),
});

/**
 * POST /admin/reports/export — the report type is the switch the service
 * branches on, so it is constrained here and the service's own default branch
 * becomes unreachable defence rather than the only check.
 */
export const adminReportExportSchema = z.object({
  reportType: z.enum(['users', 'providers', 'programs']),
  format: z.string().max(20).default('json'),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  filters: z.record(z.unknown()).optional(),
});

/**
 * PUT /admin/content-flags/:id — an invalid `status` used to reach Postgres and
 * fail there as a 500; the enum mirrors `flagStatusEnum` in the schema.
 */
export const adminContentFlagResolveSchema = z.object({
  status: z.enum(['open', 'reviewing', 'resolved', 'dismissed']),
  resolutionNotes: z.string().max(2000).optional(),
});

export const onboardingStepSchema = z.object({
  step: z.number().int().positive(),
  data: z.record(z.unknown()),
});

export const slotsQuerySchema = z.object({
  date: z.string().date(),
  timezone: z.string().max(50).default('America/New_York'),
});

// ── Multi-Profile / Family (RRO) schemas ──

// The taxonomy has one definition, in @longeny/types. These four lists were
// copied out of it here, which is how `source` below drifted: two of the five
// transition sources were missing and no build ever noticed.

/**
 * An optional field a form left untouched arrives as `""`, not as absent.
 *
 * Zod's `.email()` and `.url()` reject an empty string, so a client that sent
 * every field in its form — the normal thing to do — got a 400 naming a field
 * the user never filled in. `lastName` accepted `""` only because it carries no
 * format check, so the API disagreed with itself field by field.
 *
 * Treat empty as absent, before the format check runs.
 */
const blankAsAbsent = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), schema.optional());

export const createProfileSchema = z.object({
  relation: z.enum(PROFILE_RELATIONS),
  firstName: z.string().min(1).max(100).trim(),
  lastName: z.string().max(100).trim().optional(),
  email: blankAsAbsent(z.string().email().max(255)),
  phone: blankAsAbsent(z.string().min(5).max(30)),
  dateOfBirth: blankAsAbsent(z.string().date()),
  gender: z.enum(['male', 'female', 'non_binary', 'prefer_not_to_say']).optional(),
  avatarUrl: blankAsAbsent(z.string().url()),
  notes: z.string().max(2000).optional(),
  goal: z.string().max(1000).optional(),
});

export const updateProfileScopedSchema = z.object({
  relation: z.enum(PROFILE_RELATIONS).optional(),
  firstName: z.string().min(1).max(100).trim().optional(),
  lastName: z.string().max(100).trim().optional(),
  email: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().email().max(255).optional().nullable(),
  ),
  phone: z.string().min(5).max(30).optional().nullable(),
  dateOfBirth: z.string().date().optional().nullable(),
  gender: z.enum(['male', 'female', 'non_binary', 'prefer_not_to_say']).optional(),
  avatarUrl: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().url().optional().nullable(),
  ),
  notes: z.string().max(2000).optional().nullable(),
});

export const caregiverConsentSchema = z.object({
  // Was free text: 'banana_pudding' returned 201 and was stored, so the audit
  // table faithfully recorded a consent type nothing could query. The list is
  // the taxonomy, imported rather than re-typed.
  consentType: z.enum(CAREGIVER_CONSENT_TYPES),
  status: z.enum(['granted', 'revoked']).default('granted'),
  documentUrl: blankAsAbsent(z.string().url()),
  notes: z.string().max(2000).optional(),
});

export const notificationTargetSchema = z.object({
  channel: z.enum(NOTIFY_CHANNELS),
  destination: z.string().min(1).max(500),
  calendarId: z.string().max(255).optional(),
});

export const notifyProfileSchema = z.object({
  profileId: z.string().uuid(),
  channel: z.enum(NOTIFY_CHANNELS).optional(),
  subject: z.string().max(255).optional(),
  body: z.string().max(5000),
  metadata: z.record(z.unknown()).optional(),
  /**
   * One attachment, for a calendar invite. Bounded at 100 KB: an ICS event is a
   * couple of kilobytes, and this endpoint is not a file transfer.
   */
  attachment: z
    .object({
      filename: z.string().max(120),
      contentType: z.string().max(100),
      content: z.string().max(100_000),
      method: z.string().max(20).optional(),
    })
    .optional(),
});

export const rroTransitionSchema = z.object({
  profileId: z.string().uuid(),
  toState: z.enum(RRO_STATES),
  reason: z.string().max(1000).optional(),
  // Sources come from the taxonomy, not a second list. The hand-written literal
  // this replaced was missing 'patient' and 'admin', so a transition either of
  // them caused could not be recorded with its real origin.
  source: z.enum(RRO_TRANSITION_SOURCES).default('system'),
  goal: z.string().max(1000).optional(),
  metadata: z.record(z.unknown()).optional(),
});

/**
 * POST /internal/profiles/resolve — the ownership question, asked by another service.
 *
 * Services that store profile-scoped data (intake, documents, AI output) live in
 * their own databases and cannot join to `profiles`. Rather than each one
 * re-implementing the rule, they ask this service, which answers through the
 * same `assertOwnership` guard the local profile-context middleware uses.
 *
 * `profileId` omitted means "the account owner's own self profile", matching a
 * request that carries no X-Active-Profile-Id header.
 */
export const resolveProfileSchema = z.object({
  authId: z.string().uuid(),
  profileId: z.string().uuid().optional(),
});

// ── Progress: habit & goal write schemas ──
//
// The shared `habitSchema` / `habitCheckinSchema` in @longeny/validators cover
// the create-habit body only: they are required-field schemas, and the check-in
// one carries `habitId`, which these routes take from the path. The update and
// goal bodies had no schema at all, so Elysia handed the controller `unknown`.
// Each schema below mirrors the ProgressService parameter type it feeds.

const GOAL_STATUSES = ['pending', 'in_progress', 'completed', 'abandoned'] as const;

/** PUT /progress/habits/:id — partial update; `id` comes from the path. */
export const updateHabitSchema = z.object({
  name: z.string().min(1).max(200).trim().optional(),
  description: z.string().max(1000).optional(),
  frequency: z.enum(['DAILY', 'WEEKLY', 'CUSTOM']).optional(),
  targetCount: z.number().int().positive().optional(),
  reminderTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/, 'Must be HH:mm format')
    .optional(),
  isActive: z.boolean().optional(),
  category: z.string().max(50).optional(),
  unit: z.string().max(20).optional(),
});

/**
 * POST /progress/habits/:id/checkin — every field is optional, so a bare
 * "I did it today" check-in sends no body at all. `.default({})` keeps that
 * request valid instead of failing it on a missing body.
 */
export const habitCheckinBodySchema = z
  .object({
    notes: z.string().max(500).optional(),
    value: z.number().optional(),
    date: z.string().date().optional(),
  })
  .default({});

/** POST /progress/goals */
export const createGoalSchema = z.object({
  title: z.string().min(1).max(200).trim(),
  description: z.string().max(2000).optional(),
  targetValue: z.number().optional(),
  unit: z.string().max(50).optional(),
  category: z.string().max(100).optional(),
  startDate: z.string().date(),
  targetDate: z.string().date().optional(),
});

/** PUT /progress/goals/:id — partial update. */
export const updateGoalSchema = z.object({
  title: z.string().min(1).max(200).trim().optional(),
  description: z.string().max(2000).optional(),
  targetValue: z.number().optional(),
  unit: z.string().max(50).optional(),
  category: z.string().max(100).optional(),
  targetDate: z.string().date().optional(),
  status: z.enum(GOAL_STATUSES).optional(),
});

/** PUT /progress/goals/:id/progress — records a new current value. */
export const goalProgressSchema = z.object({
  currentValue: z.number(),
});
