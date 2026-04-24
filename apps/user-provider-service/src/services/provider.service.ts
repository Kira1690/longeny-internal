import { NotFoundError, ConflictError } from '@longeny/errors';
import { createLogger } from '@longeny/utils';
import { db } from '../db/index.js';
import {
  users,
  providers,
  provider_verification,
  availability_rules,
  availability_overrides,
  programs,
  products,
  reviews,
  provider_categories,
} from '../db/schema.js';
import { eq, and, desc, asc, gte, ilike, or, sql, inArray, count } from 'drizzle-orm';

const logger = createLogger('provider-service');

export class ProviderService {
  constructor(_prismaUnused: unknown) {}

  private async getProviderByAuthId(authId: string) {
    const [user] = await db.select().from(users).where(eq(users.auth_id, authId)).limit(1);
    if (!user) throw new NotFoundError('User');

    const [provider] = await db.select().from(providers).where(eq(providers.user_id, user.id)).limit(1);
    if (!provider) throw new NotFoundError('Provider profile');

    return provider;
  }

  async register(authId: string, data: {
    businessName: string;
    description?: string;
    specializations: string[];
    qualifications: string[];
    phone?: string;
    address?: Record<string, unknown>;
  }) {
    const [user] = await db.select().from(users).where(eq(users.auth_id, authId)).limit(1);
    if (!user) throw new NotFoundError('User');

    const [existingProvider] = await db.select({ id: providers.id }).from(providers).where(eq(providers.user_id, user.id)).limit(1);
    if (existingProvider) throw new ConflictError('User is already registered as a provider');

    const [provider] = await db.insert(providers).values({
      user_id: user.id,
      business_name: data.businessName,
      bio: data.description,
      specialties: data.specializations,
      credentials: data.qualifications,
      location: data.address || null,
      status: 'pending',
    }).returning();

    logger.info({ providerId: provider.id, userId: user.id }, 'Provider registered');
    return provider;
  }

  async getOwnProfile(authId: string) {
    return this.getProviderByAuthId(authId);
  }

  async updateProfile(authId: string, data: {
    businessName?: string;
    displayName?: string;
    bio?: string;
    specialties?: string[];
    credentials?: string[];
    yearsExperience?: number;
    hourlyRate?: number;
    currency?: string;
    location?: Record<string, unknown>;
    serviceAreaRadiusMiles?: number;
    offersVirtual?: boolean;
    offersInPerson?: boolean;
    websiteUrl?: string | null;
    socialLinks?: Record<string, string>;
    cancellationPolicy?: string;
    cancellationHours?: number;
  }) {
    const provider = await this.getProviderByAuthId(authId);

    const updateData: Record<string, unknown> = { updated_at: new Date() };
    if (data.businessName !== undefined) updateData.business_name = data.businessName;
    if (data.displayName !== undefined) updateData.display_name = data.displayName;
    if (data.bio !== undefined) updateData.bio = data.bio;
    if (data.specialties !== undefined) updateData.specialties = data.specialties;
    if (data.credentials !== undefined) updateData.credentials = data.credentials;
    if (data.yearsExperience !== undefined) updateData.years_experience = data.yearsExperience;
    if (data.hourlyRate !== undefined) updateData.hourly_rate = String(data.hourlyRate);
    if (data.currency !== undefined) updateData.currency = data.currency;
    if (data.location !== undefined) updateData.location = data.location;
    if (data.serviceAreaRadiusMiles !== undefined) updateData.service_area_radius_miles = data.serviceAreaRadiusMiles;
    if (data.offersVirtual !== undefined) updateData.offers_virtual = data.offersVirtual;
    if (data.offersInPerson !== undefined) updateData.offers_in_person = data.offersInPerson;
    if (data.websiteUrl !== undefined) updateData.website_url = data.websiteUrl;
    if (data.socialLinks !== undefined) updateData.social_links = data.socialLinks;
    if (data.cancellationPolicy !== undefined) updateData.cancellation_policy = data.cancellationPolicy;
    if (data.cancellationHours !== undefined) updateData.cancellation_hours = data.cancellationHours;

    const [updated] = await db.update(providers).set(updateData as any).where(eq(providers.id, provider.id)).returning();
    return updated;
  }

  async submitVerification(authId: string, data: {
    documentType: string;
    documentUrl: string;
    notes?: string;
  }) {
    const provider = await this.getProviderByAuthId(authId);

    const [verification] = await db.insert(provider_verification).values({
      provider_id: provider.id,
      document_type: data.documentType,
      document_url: data.documentUrl,
      notes: data.notes,
      status: 'pending',
    }).returning();

    logger.info({ providerId: provider.id, verificationId: verification.id }, 'Verification document submitted');
    return verification;
  }

  async getAvailability(authId: string) {
    const provider = await this.getProviderByAuthId(authId);

    const rules = await db.select().from(availability_rules)
      .where(eq(availability_rules.provider_id, provider.id))
      .orderBy(asc(availability_rules.day_of_week), asc(availability_rules.start_time));

    const overrides = await db.select().from(availability_overrides)
      .where(and(
        eq(availability_overrides.provider_id, provider.id),
        gte(availability_overrides.date, new Date().toISOString().split('T')[0]),
      ))
      .orderBy(asc(availability_overrides.date));

    return { rules, overrides };
  }

  async setAvailability(authId: string, rules: Array<{
    dayOfWeek: string;
    startTime: string;
    endTime: string;
    slotDurationMinutes?: number;
    isAvailable?: boolean;
  }>) {
    const provider = await this.getProviderByAuthId(authId);

    await db.transaction(async (tx) => {
      await tx.delete(availability_rules).where(eq(availability_rules.provider_id, provider.id));

      if (rules.length > 0) {
        await tx.insert(availability_rules).values(
          rules.map((rule) => ({
            provider_id: provider.id,
            day_of_week: rule.dayOfWeek as any,
            start_time: rule.startTime,
            end_time: rule.endTime,
            slot_duration_minutes: rule.slotDurationMinutes || 60,
            is_active: rule.isAvailable !== false,
          })),
        );
      }
    });

    return this.getAvailability(authId);
  }

  async addAvailabilityOverride(authId: string, data: {
    date: string;
    startTime?: string;
    endTime?: string;
    isBlocked?: boolean;
    reason?: string;
  }) {
    const provider = await this.getProviderByAuthId(authId);

    const [override] = await db.insert(availability_overrides).values({
      provider_id: provider.id,
      date: data.date,
      start_time: data.startTime || null,
      end_time: data.endTime || null,
      is_blocked: data.isBlocked || false,
      reason: data.reason,
    }).returning();

    return override;
  }

  async removeAvailabilityOverride(authId: string, overrideId: string) {
    const provider = await this.getProviderByAuthId(authId);

    const [override] = await db.select().from(availability_overrides)
      .where(and(eq(availability_overrides.id, overrideId), eq(availability_overrides.provider_id, provider.id)))
      .limit(1);

    if (!override) throw new NotFoundError('Availability override', overrideId);

    await db.delete(availability_overrides).where(eq(availability_overrides.id, overrideId));
    return { success: true };
  }

  async getPublicProfile(providerId: string) {
    const [provider] = await db.select().from(providers).where(eq(providers.id, providerId)).limit(1);

    if (!provider || provider.status === 'deactivated') {
      throw new NotFoundError('Provider', providerId);
    }

    const [user] = await db.select({
      first_name: users.first_name,
      last_name: users.last_name,
      avatar_url: users.avatar_url,
    }).from(users).where(eq(users.id, provider.user_id)).limit(1);

    const activePrograms = await db.select().from(programs)
      .where(and(eq(programs.provider_id, providerId), eq(programs.status, 'active')))
      .orderBy(desc(programs.created_at));

    const activeProducts = await db.select().from(products)
      .where(and(eq(products.provider_id, providerId), eq(products.status, 'active')))
      .orderBy(desc(products.created_at));

    return { ...provider, user, programs: activePrograms, products: activeProducts };
  }

  async getAvailableSlots(providerId: string, date: string, _timezone: string) {
    const targetDate = new Date(date);
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const dayOfWeek = dayNames[targetDate.getUTCDay()];

    const rules = await db.select().from(availability_rules)
      .where(and(
        eq(availability_rules.provider_id, providerId),
        eq(availability_rules.day_of_week, dayOfWeek as any),
        eq(availability_rules.is_active, true),
      ));

    const overrides = await db.select().from(availability_overrides)
      .where(and(
        eq(availability_overrides.provider_id, providerId),
        eq(availability_overrides.date, date),
      ));

    const blockedOverride = overrides.find((o) => o.is_blocked && !o.start_time);
    if (blockedOverride) return [];

    const slots: Array<{ startTime: string; endTime: string; available: boolean }> = [];

    for (const rule of rules) {
      const [startH, startM] = rule.start_time.split(':').map(Number);
      const [endH, endM] = rule.end_time.split(':').map(Number);
      const duration = rule.slot_duration_minutes;
      const buffer = rule.buffer_minutes;

      let currentMinutes = startH * 60 + startM;
      const endMinutes = endH * 60 + endM;

      while (currentMinutes + duration <= endMinutes) {
        const slotStartHour = Math.floor(currentMinutes / 60);
        const slotStartMin = currentMinutes % 60;
        const slotEndMin = currentMinutes + duration;
        const slotEndHour = Math.floor(slotEndMin / 60);
        const slotEndMinute = slotEndMin % 60;

        const startTime = `${String(slotStartHour).padStart(2, '0')}:${String(slotStartMin).padStart(2, '0')}`;
        const endTime = `${String(slotEndHour).padStart(2, '0')}:${String(slotEndMinute).padStart(2, '0')}`;

        const isBlocked = overrides.some((o) => {
          if (!o.is_blocked || !o.start_time || !o.end_time) return false;
          const [oh, om] = o.start_time.split(':').map(Number);
          const [eh, em] = o.end_time.split(':').map(Number);
          const overrideStart = oh * 60 + om;
          const overrideEnd = eh * 60 + em;
          return currentMinutes < overrideEnd && currentMinutes + duration > overrideStart;
        });

        slots.push({ startTime, endTime, available: !isBlocked });
        currentMinutes += duration + buffer;
      }
    }

    return slots;
  }

  async createProgram(authId: string, data: {
    title: string;
    description: string;
    category: string;
    durationWeeks?: number;
    sessionsPerWeek?: number;
    maxParticipants?: number;
    priceType?: string;
    price: number;
    currency?: string;
    shortDescription?: string;
    subcategory?: string;
    sessionDurationMinutes?: number;
    prerequisites?: string;
    whatToExpect?: string;
    outcomes?: unknown;
    tags?: string[];
    imageUrl?: string;
  }) {
    const provider = await this.getProviderByAuthId(authId);

    const [program] = await db.insert(programs).values({
      provider_id: provider.id,
      title: data.title,
      description: data.description,
      short_description: data.shortDescription,
      category: data.category,
      subcategory: data.subcategory,
      duration_weeks: data.durationWeeks,
      session_count: data.sessionsPerWeek ? (data.durationWeeks || 1) * data.sessionsPerWeek : undefined,
      session_duration_minutes: data.sessionDurationMinutes || 60,
      price: String(data.price),
      price_type: (data.priceType as any) || 'one_time',
      max_participants: data.maxParticipants,
      prerequisites: data.prerequisites,
      what_to_expect: data.whatToExpect,
      outcomes: data.outcomes as any || null,
      tags: data.tags || [],
      image_url: data.imageUrl,
      status: 'draft',
    }).returning();

    logger.info({ programId: program.id, providerId: provider.id }, 'Program created');
    return program;
  }

  async updateProgram(authId: string, programId: string, data: Record<string, unknown>) {
    const provider = await this.getProviderByAuthId(authId);

    const [program] = await db.select().from(programs)
      .where(and(eq(programs.id, programId), eq(programs.provider_id, provider.id)))
      .limit(1);

    if (!program) throw new NotFoundError('Program', programId);

    const updateData: Record<string, unknown> = { updated_at: new Date() };
    const fieldMap: Record<string, string> = {
      title: 'title', description: 'description', shortDescription: 'short_description',
      category: 'category', subcategory: 'subcategory', durationWeeks: 'duration_weeks',
      sessionCount: 'session_count', sessionDurationMinutes: 'session_duration_minutes',
      price: 'price', priceType: 'price_type', maxParticipants: 'max_participants',
      prerequisites: 'prerequisites', whatToExpect: 'what_to_expect',
      outcomes: 'outcomes', tags: 'tags', imageUrl: 'image_url', status: 'status',
    };
    for (const [key, col] of Object.entries(fieldMap)) {
      if (data[key] !== undefined) updateData[col] = data[key];
    }

    const [updated] = await db.update(programs).set(updateData as any).where(eq(programs.id, programId)).returning();
    return updated;
  }

  async deleteProgram(authId: string, programId: string) {
    const provider = await this.getProviderByAuthId(authId);

    const [program] = await db.select().from(programs)
      .where(and(eq(programs.id, programId), eq(programs.provider_id, provider.id)))
      .limit(1);

    if (!program) throw new NotFoundError('Program', programId);

    await db.update(programs).set({ status: 'archived', updated_at: new Date() }).where(eq(programs.id, programId));
    return { success: true };
  }

  async createProduct(authId: string, data: {
    title: string;
    description: string;
    category: string;
    price: number;
    currency?: string;
    stockQuantity?: number;
    images?: string[];
    shortDescription?: string;
    compareAtPrice?: number;
    sku?: string;
    tags?: string[];
    attributes?: Record<string, unknown>;
    isDigital?: boolean;
    digitalFileUrl?: string;
  }) {
    const provider = await this.getProviderByAuthId(authId);

    const [product] = await db.insert(products).values({
      provider_id: provider.id,
      title: data.title,
      description: data.description,
      short_description: data.shortDescription,
      category: data.category,
      price: String(data.price),
      compare_at_price: data.compareAtPrice ? String(data.compareAtPrice) : null,
      inventory_count: data.stockQuantity || 0,
      sku: data.sku,
      image_urls: data.images || [],
      tags: data.tags || [],
      attributes: data.attributes || null,
      is_digital: data.isDigital || false,
      digital_file_url: data.digitalFileUrl,
      status: 'draft',
    }).returning();

    logger.info({ productId: product.id, providerId: provider.id }, 'Product created');
    return product;
  }

  async updateProduct(authId: string, productId: string, data: Record<string, unknown>) {
    const provider = await this.getProviderByAuthId(authId);

    const [product] = await db.select().from(products)
      .where(and(eq(products.id, productId), eq(products.provider_id, provider.id)))
      .limit(1);

    if (!product) throw new NotFoundError('Product', productId);

    const updateData: Record<string, unknown> = { updated_at: new Date() };
    const fieldMap: Record<string, string> = {
      title: 'title', description: 'description', shortDescription: 'short_description',
      category: 'category', price: 'price', compareAtPrice: 'compare_at_price',
      stockQuantity: 'inventory_count', sku: 'sku', images: 'image_urls',
      tags: 'tags', attributes: 'attributes', isDigital: 'is_digital',
      digitalFileUrl: 'digital_file_url', status: 'status',
    };
    for (const [key, col] of Object.entries(fieldMap)) {
      if (data[key] !== undefined) updateData[col] = data[key];
    }

    const [updated] = await db.update(products).set(updateData as any).where(eq(products.id, productId)).returning();
    return updated;
  }

  async deleteProduct(authId: string, productId: string) {
    const provider = await this.getProviderByAuthId(authId);

    const [product] = await db.select().from(products)
      .where(and(eq(products.id, productId), eq(products.provider_id, provider.id)))
      .limit(1);

    if (!product) throw new NotFoundError('Product', productId);

    await db.update(products).set({ status: 'archived', updated_at: new Date() }).where(eq(products.id, productId));
    return { success: true };
  }

  async listProviders(filters: {
    category?: string;
    offersVirtual?: boolean;
    offersInPerson?: boolean;
    minRating?: number;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const page = filters.page || 1;
    const limit = filters.limit || 20;
    const offset = (page - 1) * limit;

    const conditions: any[] = [inArray(providers.status, ['verified', 'pending'])];
    if (filters.search) conditions.push(or(ilike(providers.business_name, `%${filters.search}%`), ilike(providers.display_name!, `%${filters.search}%`)));
    if (filters.offersVirtual !== undefined) conditions.push(eq(providers.offers_virtual, filters.offersVirtual));
    if (filters.offersInPerson !== undefined) conditions.push(eq(providers.offers_in_person, filters.offersInPerson));

    const { and: drizzleAnd } = await import('drizzle-orm');
    const whereClause = drizzleAnd(...conditions);

    const providersList = await db.select().from(providers).where(whereClause).orderBy(desc(providers.rating_avg)).limit(limit).offset(offset);
    const total = await db.$count(providers, whereClause);

    return {
      data: providersList,
      pagination: { total: Number(total), page, limit, totalPages: Math.ceil(Number(total) / limit) },
    };
  }

  async getOwnPrograms(authId: string, filters: { status?: string; page?: number; limit?: number }) {
    const provider = await this.getProviderByAuthId(authId);
    const page = filters.page || 1;
    const limit = filters.limit || 20;
    const offset = (page - 1) * limit;

    const conditions: any[] = [eq(programs.provider_id, provider.id)];
    if (filters.status) conditions.push(eq(programs.status, filters.status as any));

    const { and: drizzleAnd } = await import('drizzle-orm');
    const whereClause = drizzleAnd(...conditions);

    const programsList = await db.select().from(programs).where(whereClause).orderBy(desc(programs.created_at)).limit(limit).offset(offset);
    const total = await db.$count(programs, whereClause);

    return {
      data: programsList,
      pagination: { total: Number(total), page, limit, totalPages: Math.ceil(Number(total) / limit) },
    };
  }

  async getProviderPrograms(providerId: string, filters: { page?: number; limit?: number }) {
    const page = filters.page || 1;
    const limit = filters.limit || 20;
    const offset = (page - 1) * limit;
    const where = and(eq(programs.provider_id, providerId), eq(programs.status, 'active'));

    const programsList = await db.select().from(programs).where(where).orderBy(desc(programs.created_at)).limit(limit).offset(offset);
    const total = await db.$count(programs, where);

    return {
      data: programsList,
      pagination: { total: Number(total), page, limit, totalPages: Math.ceil(Number(total) / limit) },
    };
  }

  async getOwnProducts(authId: string, filters: { status?: string; page?: number; limit?: number }) {
    const provider = await this.getProviderByAuthId(authId);
    const page = filters.page || 1;
    const limit = filters.limit || 20;
    const offset = (page - 1) * limit;

    const conditions: any[] = [eq(products.provider_id, provider.id)];
    if (filters.status) conditions.push(eq(products.status, filters.status as any));

    const { and: drizzleAnd } = await import('drizzle-orm');
    const whereClause = drizzleAnd(...conditions);

    const productsList = await db.select().from(products).where(whereClause).orderBy(desc(products.created_at)).limit(limit).offset(offset);
    const total = await db.$count(products, whereClause);

    return {
      data: productsList,
      pagination: { total: Number(total), page, limit, totalPages: Math.ceil(Number(total) / limit) },
    };
  }

  async getProviderProducts(providerId: string, filters: { page?: number; limit?: number }) {
    const page = filters.page || 1;
    const limit = filters.limit || 20;
    const offset = (page - 1) * limit;
    const where = and(eq(products.provider_id, providerId), eq(products.status, 'active'));

    const productsList = await db.select().from(products).where(where).orderBy(desc(products.created_at)).limit(limit).offset(offset);
    const total = await db.$count(products, where);

    return {
      data: productsList,
      pagination: { total: Number(total), page, limit, totalPages: Math.ceil(Number(total) / limit) },
    };
  }

  async getPublicAvailability(providerId: string) {
    const [provider] = await db.select().from(providers).where(eq(providers.id, providerId)).limit(1);

    if (!provider || provider.status === 'deactivated') {
      throw new NotFoundError('Provider', providerId);
    }

    const rules = await db.select().from(availability_rules)
      .where(and(eq(availability_rules.provider_id, providerId), eq(availability_rules.is_active, true)))
      .orderBy(asc(availability_rules.day_of_week), asc(availability_rules.start_time));

    const overrides = await db.select().from(availability_overrides)
      .where(and(
        eq(availability_overrides.provider_id, providerId),
        gte(availability_overrides.date, new Date().toISOString().split('T')[0]),
      ))
      .orderBy(asc(availability_overrides.date));

    return { rules, overrides };
  }

  async getProviderStats(authId: string) {
    const provider = await this.getProviderByAuthId(authId);

    const totalPrograms = await db.$count(programs, eq(programs.provider_id, provider.id));
    const activePrograms = await db.$count(programs, and(eq(programs.provider_id, provider.id), eq(programs.status, 'active')));
    const totalProducts = await db.$count(products, eq(products.provider_id, provider.id));
    const activeProducts = await db.$count(products, and(eq(products.provider_id, provider.id), eq(products.status, 'active')));
    const reviewCount = await db.$count(reviews, and(eq(reviews.target_type, 'PROVIDER'), eq(reviews.target_id, provider.id)));

    return {
      provider: {
        id: provider.id,
        status: provider.status,
        ratingAvg: provider.rating_avg,
        reviewCount: provider.review_count,
        totalBookings: provider.total_bookings,
      },
      programs: { total: Number(totalPrograms), active: Number(activePrograms) },
      products: { total: Number(totalProducts), active: Number(activeProducts) },
      reviews: { total: Number(reviewCount) },
    };
  }

  async listCategories() {
    const allCategories = await db.select().from(provider_categories)
      .where(eq(provider_categories.is_active, true))
      .orderBy(asc(provider_categories.sort_order));

    return allCategories.filter((c) => !c.parent_id);
  }

  async getProviderById(providerId: string) {
    const [provider] = await db.select().from(providers).where(eq(providers.id, providerId)).limit(1);

    if (!provider) throw new NotFoundError('Provider', providerId);

    const [user] = await db.select({
      first_name: users.first_name,
      last_name: users.last_name,
      email: users.email,
      avatar_url: users.avatar_url,
    }).from(users).where(eq(users.id, provider.user_id)).limit(1);

    return { ...provider, user };
  }

  async getProviderAvailabilityForDate(providerId: string, date: string) {
    return this.getAvailableSlots(providerId, date, 'America/New_York');
  }
}
