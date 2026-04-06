import { z } from 'zod';

// Re-export shared validators
export {
  uuidSchema,
  paginationSchema,
  validate,
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
  location: z.object({
    city: z.string().max(100).optional(),
    state: z.string().max(50).optional(),
    lat: z.number().optional(),
    lng: z.number().optional(),
  }).optional(),
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
  startTime: z.string().regex(/^\d{2}:\d{2}$/, 'Must be HH:mm format').optional(),
  endTime: z.string().regex(/^\d{2}:\d{2}$/, 'Must be HH:mm format').optional(),
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
  sortBy: z.enum(['relevance', 'rating', 'price_asc', 'price_desc', 'newest', 'popularity']).default('relevance'),
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

export const onboardingStepSchema = z.object({
  step: z.number().int().positive(),
  data: z.record(z.unknown()),
});

export const slotsQuerySchema = z.object({
  date: z.string().date(),
  timezone: z.string().max(50).default('America/New_York'),
});
