import { db } from '../db/index.js';
import { sql, eq, and, ilike, gte, lte, or } from 'drizzle-orm';
import {
  providers,
  users,
  provider_verification,
  programs,
  products,
  moderation_queue,
  admin_actions,
  platform_settings,
  analytics_snapshots,
  content_flags,
} from '../db/schema.js';
import { NotFoundError, BadRequestError } from '@longeny/errors';
import { createLogger, buildPaginationMeta } from '@longeny/utils';

const logger = createLogger('admin-service');

export class AdminService {
  constructor(_prismaUnused: unknown) {}

  // ── Provider management ──

  async listProviders(filters: {
    status?: string;
    search?: string;
    page?: number;
    limit?: number;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  }) {
    const page = filters.page || 1;
    const limit = filters.limit || 20;
    const offset = (page - 1) * limit;

    const conditions: any[] = [];
    if (filters.status) {
      conditions.push(sql`${providers.status}::text = ${filters.status}`);
    }
    if (filters.search) {
      conditions.push(
        or(
          ilike(providers.business_name, `%${filters.search}%`),
          ilike(providers.display_name, `%${filters.search}%`),
        ),
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const sortCol = filters.sortBy || 'created_at';
    const sortDir = filters.sortOrder || 'desc';
    const orderExpr = sortDir === 'asc'
      ? sql`${sql.raw(`"providers"."${sortCol}"`)}} ASC`
      : sql`${sql.raw(`"providers"."${sortCol}"`)}} DESC`;

    const [providerRows, [{ count }]] = await Promise.all([
      db
        .select()
        .from(providers)
        .where(whereClause)
        .orderBy(sql`${providers.created_at} DESC`)
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(providers)
        .where(whereClause),
    ]);

    // Enrich with user info and latest verification
    const enriched = await Promise.all(
      providerRows.map(async (p) => {
        const [user] = await db
          .select({
            first_name: users.first_name,
            last_name: users.last_name,
            email: users.email,
            status: users.status,
          })
          .from(users)
          .where(eq(users.id, p.user_id))
          .limit(1);

        const verifications = await db
          .select()
          .from(provider_verification)
          .where(eq(provider_verification.provider_id, p.id))
          .orderBy(sql`${provider_verification.created_at} DESC`)
          .limit(1);

        return { ...p, user, verifications };
      }),
    );

    return {
      data: enriched,
      pagination: buildPaginationMeta(count, page, limit),
    };
  }

  async updateProviderStatus(providerId: string, adminId: string, status: string, reason?: string) {
    const [provider] = await db
      .select()
      .from(providers)
      .where(eq(providers.id, providerId))
      .limit(1);

    if (!provider) {
      throw new NotFoundError('Provider', providerId);
    }

    const [updated] = await db.transaction(async (tx) => {
      const result = await tx
        .update(providers)
        .set({ status: status as any, updated_at: new Date() })
        .where(eq(providers.id, providerId))
        .returning();

      await tx.insert(admin_actions).values({
        admin_id: adminId,
        action_type: status === 'suspended' ? 'suspend_provider' : 'reactivate_provider',
        target_type: 'provider',
        target_id: providerId,
        reason,
        details: { previousStatus: provider.status, newStatus: status },
      });

      return result;
    });

    logger.info({ providerId, adminId, status }, 'Provider status updated');
    return updated;
  }

  async verifyProvider(providerId: string, adminId: string, data: {
    verificationIds?: string[];
    notes?: string;
  }) {
    const [provider] = await db
      .select()
      .from(providers)
      .where(eq(providers.id, providerId))
      .limit(1);

    if (!provider) {
      throw new NotFoundError('Provider', providerId);
    }

    const pendingVerifications = await db
      .select()
      .from(provider_verification)
      .where(
        and(
          eq(provider_verification.provider_id, providerId),
          eq(provider_verification.status, 'pending'),
        ),
      );

    await db.transaction(async (tx) => {
      const verificationIds = data.verificationIds || pendingVerifications.map((v) => v.id);

      for (const id of verificationIds) {
        await tx
          .update(provider_verification)
          .set({
            status: 'approved',
            reviewer_id: adminId,
            reviewed_at: new Date(),
            notes: data.notes,
          })
          .where(eq(provider_verification.id, id));
      }

      await tx
        .update(providers)
        .set({ status: 'verified', updated_at: new Date() })
        .where(eq(providers.id, providerId));

      await tx.insert(admin_actions).values({
        admin_id: adminId,
        action_type: 'verify_provider',
        target_type: 'provider',
        target_id: providerId,
        details: { verificationIds, notes: data.notes },
      });
    });

    logger.info({ providerId, adminId }, 'Provider verified');
    return { success: true };
  }

  // ── User management ──

  async listUsers(filters: {
    status?: string;
    search?: string;
    page?: number;
    limit?: number;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  }) {
    const page = filters.page || 1;
    const limit = filters.limit || 20;
    const offset = (page - 1) * limit;

    const conditions: any[] = [];
    if (filters.status) {
      conditions.push(sql`${users.status}::text = ${filters.status}`);
    }
    if (filters.search) {
      conditions.push(
        or(
          ilike(users.email, `%${filters.search}%`),
          ilike(users.first_name, `%${filters.search}%`),
          ilike(users.last_name, `%${filters.search}%`),
        ),
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [userRows, [{ count }]] = await Promise.all([
      db
        .select({
          id: users.id,
          auth_id: users.auth_id,
          email: users.email,
          first_name: users.first_name,
          last_name: users.last_name,
          avatar_url: users.avatar_url,
          status: users.status,
          timezone: users.timezone,
          created_at: users.created_at,
          updated_at: users.updated_at,
        })
        .from(users)
        .where(whereClause)
        .orderBy(sql`${users.created_at} DESC`)
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(users)
        .where(whereClause),
    ]);

    // Enrich with provider info
    const enriched = await Promise.all(
      userRows.map(async (u) => {
        const [providerInfo] = await db
          .select({ id: providers.id, status: providers.status, business_name: providers.business_name })
          .from(providers)
          .where(eq(providers.user_id, u.id))
          .limit(1);
        return { ...u, provider: providerInfo ?? null };
      }),
    );

    return {
      data: enriched,
      pagination: buildPaginationMeta(count, page, limit),
    };
  }

  async getUserDetail(userId: string) {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) {
      throw new NotFoundError('User', userId);
    }

    return user;
  }

  async updateUserStatus(userId: string, adminId: string, status: string, reason?: string) {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) {
      throw new NotFoundError('User', userId);
    }

    const [updated] = await db.transaction(async (tx) => {
      const result = await tx
        .update(users)
        .set({ status: status as any, updated_at: new Date() })
        .where(eq(users.id, userId))
        .returning();

      await tx.insert(admin_actions).values({
        admin_id: adminId,
        action_type: status === 'suspended' ? 'suspend_user' : 'reactivate_user',
        target_type: 'user',
        target_id: userId,
        reason,
        details: { previousStatus: user.status, newStatus: status },
      });

      return result;
    });

    logger.info({ userId, adminId, status }, 'User status updated');
    return updated;
  }

  // ── Program management ──

  async listPrograms(filters: {
    status?: string;
    category?: string;
    search?: string;
    page?: number;
    limit?: number;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  }) {
    const page = filters.page || 1;
    const limit = filters.limit || 20;
    const offset = (page - 1) * limit;

    const conditions: any[] = [];
    if (filters.status) conditions.push(sql`${programs.status}::text = ${filters.status}`);
    if (filters.category) conditions.push(eq(programs.category, filters.category));
    if (filters.search) {
      conditions.push(
        or(
          ilike(programs.title, `%${filters.search}%`),
          ilike(programs.description, `%${filters.search}%`),
        ),
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [programRows, [{ count }]] = await Promise.all([
      db
        .select()
        .from(programs)
        .where(whereClause)
        .orderBy(sql`${programs.created_at} DESC`)
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(programs)
        .where(whereClause),
    ]);

    const enriched = await Promise.all(
      programRows.map(async (p) => {
        const [provider] = await db
          .select({ id: providers.id, business_name: providers.business_name, status: providers.status })
          .from(providers)
          .where(eq(providers.id, p.provider_id))
          .limit(1);
        return { ...p, provider: provider ?? null };
      }),
    );

    return {
      data: enriched,
      pagination: buildPaginationMeta(count, page, limit),
    };
  }

  async updateProgramStatus(programId: string, adminId: string, status: string, reason?: string) {
    const [program] = await db
      .select()
      .from(programs)
      .where(eq(programs.id, programId))
      .limit(1);

    if (!program) {
      throw new NotFoundError('Program', programId);
    }

    const [updated] = await db.transaction(async (tx) => {
      const result = await tx
        .update(programs)
        .set({ status: status as any, updated_at: new Date() })
        .where(eq(programs.id, programId))
        .returning();

      await tx.insert(admin_actions).values({
        admin_id: adminId,
        action_type: 'moderate_content',
        target_type: 'program',
        target_id: programId,
        reason,
        details: { previousStatus: program.status, newStatus: status },
      });

      return result;
    });

    logger.info({ programId, adminId, status }, 'Program status updated');
    return updated;
  }

  // ── Moderation ──

  async getModerationQueue(filters: {
    status?: string;
    entityType?: string;
    page?: number;
    limit?: number;
  }) {
    const page = filters.page || 1;
    const limit = filters.limit || 20;
    const offset = (page - 1) * limit;

    const conditions: any[] = [];
    if (filters.status) conditions.push(sql`${moderation_queue.status}::text = ${filters.status}`);
    if (filters.entityType) conditions.push(eq(moderation_queue.entity_type, filters.entityType));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [items, [{ count }]] = await Promise.all([
      db
        .select()
        .from(moderation_queue)
        .where(whereClause)
        .orderBy(moderation_queue.priority, moderation_queue.created_at)
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(moderation_queue)
        .where(whereClause),
    ]);

    return {
      data: items,
      pagination: buildPaginationMeta(count, page, limit),
    };
  }

  async moderateItem(itemId: string, adminId: string, data: {
    status: string;
    reviewNotes?: string;
    actionTaken?: string;
  }) {
    const [item] = await db
      .select()
      .from(moderation_queue)
      .where(eq(moderation_queue.id, itemId))
      .limit(1);

    if (!item) {
      throw new NotFoundError('Moderation item', itemId);
    }

    const [updated] = await db
      .update(moderation_queue)
      .set({
        status: data.status as any,
        reviewed_by: adminId,
        reviewed_at: new Date(),
        review_notes: data.reviewNotes,
        action_taken: data.actionTaken,
        updated_at: new Date(),
      })
      .where(eq(moderation_queue.id, itemId))
      .returning();

    await db.insert(admin_actions).values({
      admin_id: adminId,
      action_type: 'moderate_content',
      target_type: item.entity_type,
      target_id: item.entity_id,
      details: {
        moderationItemId: itemId,
        status: data.status,
        reviewNotes: data.reviewNotes,
        actionTaken: data.actionTaken,
      },
    });

    logger.info({ itemId, adminId, status: data.status }, 'Moderation item processed');
    return updated;
  }

  // ── Analytics ──

  async getAnalyticsOverview() {
    const [
      [{ totalUsers }],
      [{ activeUsers }],
      [{ totalProviders }],
      [{ verifiedProviders }],
      [{ totalPrograms }],
      [{ activePrograms }],
      [{ totalProducts }],
    ] = await Promise.all([
      db.select({ totalUsers: sql<number>`COUNT(*)::int` }).from(users),
      db.select({ activeUsers: sql<number>`COUNT(*)::int` }).from(users).where(sql`${users.status}::text = 'active'`),
      db.select({ totalProviders: sql<number>`COUNT(*)::int` }).from(providers),
      db.select({ verifiedProviders: sql<number>`COUNT(*)::int` }).from(providers).where(sql`${providers.status}::text = 'verified'`),
      db.select({ totalPrograms: sql<number>`COUNT(*)::int` }).from(programs),
      db.select({ activePrograms: sql<number>`COUNT(*)::int` }).from(programs).where(sql`${programs.status}::text = 'active'`),
      db.select({ totalProducts: sql<number>`COUNT(*)::int` }).from(products),
    ]);

    const recentSnapshots = await db
      .select()
      .from(analytics_snapshots)
      .orderBy(sql`${analytics_snapshots.period_start} DESC`)
      .limit(10);

    return {
      users: { total: totalUsers, active: activeUsers },
      providers: { total: totalProviders, verified: verifiedProviders },
      programs: { total: totalPrograms, active: activePrograms },
      products: { total: totalProducts },
      recentSnapshots,
    };
  }

  async getUserAnalytics(filters: {
    startDate?: string;
    endDate?: string;
    granularity?: 'day' | 'week' | 'month';
  }) {
    const startDate = filters.startDate
      ? new Date(filters.startDate)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const endDate = filters.endDate ? new Date(filters.endDate) : new Date();

    const snapshots = await db
      .select()
      .from(analytics_snapshots)
      .where(
        and(
          sql`${analytics_snapshots.metric_type} LIKE ${'user_%'}`,
          gte(analytics_snapshots.period_start, startDate),
          lte(analytics_snapshots.period_end, endDate),
        ),
      )
      .orderBy(analytics_snapshots.period_start);

    const newUsers = await db.execute(
      sql`SELECT DATE(created_at) AS date, COUNT(*)::int AS count FROM users WHERE created_at >= ${startDate} AND created_at <= ${endDate} GROUP BY DATE(created_at) ORDER BY date ASC`,
    );

    return { snapshots, newUsers: Array.isArray(newUsers) ? newUsers : [] };
  }

  async getRevenueAnalytics(filters: {
    startDate?: string;
    endDate?: string;
  }) {
    const startDate = filters.startDate
      ? new Date(filters.startDate)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const endDate = filters.endDate ? new Date(filters.endDate) : new Date();

    const snapshots = await db
      .select()
      .from(analytics_snapshots)
      .where(
        and(
          sql`${analytics_snapshots.metric_type} LIKE ${'revenue_%'}`,
          gte(analytics_snapshots.period_start, startDate),
          lte(analytics_snapshots.period_end, endDate),
        ),
      )
      .orderBy(analytics_snapshots.period_start);

    return { snapshots };
  }

  async getBookingAnalytics(filters: {
    startDate?: string;
    endDate?: string;
  }) {
    const startDate = filters.startDate
      ? new Date(filters.startDate)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const endDate = filters.endDate ? new Date(filters.endDate) : new Date();

    const snapshots = await db
      .select()
      .from(analytics_snapshots)
      .where(
        and(
          sql`${analytics_snapshots.metric_type} LIKE ${'booking_%'}`,
          gte(analytics_snapshots.period_start, startDate),
          lte(analytics_snapshots.period_end, endDate),
        ),
      )
      .orderBy(analytics_snapshots.period_start);

    return { snapshots };
  }

  // ── Dashboard overview ──

  async getDashboardOverview() {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [
      [{ totalUsers }],
      [{ activeUsers }],
      [{ newUsersToday }],
      [{ totalProviders }],
      [{ pendingProviders }],
      [{ verifiedProviders }],
      [{ totalPrograms }],
      [{ totalProducts }],
      [{ pendingModeration }],
      [{ openFlags }],
    ] = await Promise.all([
      db.select({ totalUsers: sql<number>`COUNT(*)::int` }).from(users),
      db.select({ activeUsers: sql<number>`COUNT(*)::int` }).from(users).where(sql`${users.status}::text = 'active'`),
      db.select({ newUsersToday: sql<number>`COUNT(*)::int` }).from(users).where(gte(users.created_at, todayStart)),
      db.select({ totalProviders: sql<number>`COUNT(*)::int` }).from(providers),
      db.select({ pendingProviders: sql<number>`COUNT(*)::int` }).from(providers).where(sql`${providers.status}::text = 'pending'`),
      db.select({ verifiedProviders: sql<number>`COUNT(*)::int` }).from(providers).where(sql`${providers.status}::text = 'verified'`),
      db.select({ totalPrograms: sql<number>`COUNT(*)::int` }).from(programs),
      db.select({ totalProducts: sql<number>`COUNT(*)::int` }).from(products),
      db.select({ pendingModeration: sql<number>`COUNT(*)::int` }).from(moderation_queue).where(sql`${moderation_queue.status}::text = 'pending'`),
      db.select({ openFlags: sql<number>`COUNT(*)::int` }).from(content_flags).where(sql`${content_flags.status}::text = 'open'`),
    ]);

    return {
      users: { total: totalUsers, active: activeUsers, newToday: newUsersToday },
      providers: { total: totalProviders, pending: pendingProviders, verified: verifiedProviders },
      programs: { total: totalPrograms },
      products: { total: totalProducts },
      moderation: { pending: pendingModeration },
      contentFlags: { open: openFlags },
    };
  }

  // ── Pending providers ──

  async getPendingProviders(filters: { page?: number; limit?: number }) {
    const page = filters.page || 1;
    const limit = filters.limit || 20;
    const offset = (page - 1) * limit;

    const [providerRows, [{ count }]] = await Promise.all([
      db
        .select()
        .from(providers)
        .where(sql`${providers.status}::text = 'pending'`)
        .orderBy(providers.created_at)
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(providers)
        .where(sql`${providers.status}::text = 'pending'`),
    ]);

    const enriched = await Promise.all(
      providerRows.map(async (p) => {
        const [user] = await db
          .select({ first_name: users.first_name, last_name: users.last_name, email: users.email })
          .from(users)
          .where(eq(users.id, p.user_id))
          .limit(1);

        const verifications = await db
          .select()
          .from(provider_verification)
          .where(
            and(
              eq(provider_verification.provider_id, p.id),
              eq(provider_verification.status, 'pending'),
            ),
          )
          .orderBy(sql`${provider_verification.created_at} DESC`);

        return { ...p, user, verifications };
      }),
    );

    return {
      data: enriched,
      pagination: buildPaginationMeta(count, page, limit),
    };
  }

  // ── Suspend provider ──

  async suspendProvider(providerId: string, adminId: string, reason?: string) {
    const [provider] = await db
      .select()
      .from(providers)
      .where(eq(providers.id, providerId))
      .limit(1);

    if (!provider) {
      throw new NotFoundError('Provider', providerId);
    }

    const [updated] = await db.transaction(async (tx) => {
      const result = await tx
        .update(providers)
        .set({ status: 'suspended', updated_at: new Date() })
        .where(eq(providers.id, providerId))
        .returning();

      await tx.insert(admin_actions).values({
        admin_id: adminId,
        action_type: 'suspend_provider',
        target_type: 'provider',
        target_id: providerId,
        reason,
        details: { previousStatus: provider.status, newStatus: 'suspended' },
      });

      return result;
    });

    logger.info({ providerId, adminId }, 'Provider suspended');
    return updated;
  }

  // ── AI analytics ──

  async getAiAnalytics(filters: { startDate?: string; endDate?: string }) {
    const startDate = filters.startDate
      ? new Date(filters.startDate)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const endDate = filters.endDate ? new Date(filters.endDate) : new Date();

    const snapshots = await db
      .select()
      .from(analytics_snapshots)
      .where(
        and(
          sql`${analytics_snapshots.metric_type} LIKE ${'ai_%'}`,
          gte(analytics_snapshots.period_start, startDate),
          lte(analytics_snapshots.period_end, endDate),
        ),
      )
      .orderBy(analytics_snapshots.period_start);

    return { snapshots };
  }

  // ── Provider analytics ──

  async getProviderAnalytics(filters: { startDate?: string; endDate?: string }) {
    const startDate = filters.startDate
      ? new Date(filters.startDate)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const endDate = filters.endDate ? new Date(filters.endDate) : new Date();

    const snapshots = await db
      .select()
      .from(analytics_snapshots)
      .where(
        and(
          sql`${analytics_snapshots.metric_type} LIKE ${'provider_%'}`,
          gte(analytics_snapshots.period_start, startDate),
          lte(analytics_snapshots.period_end, endDate),
        ),
      )
      .orderBy(analytics_snapshots.period_start);

    const newProviders = await db.execute(
      sql`SELECT DATE(created_at) AS date, COUNT(*)::int AS count FROM providers WHERE created_at >= ${startDate} AND created_at <= ${endDate} GROUP BY DATE(created_at) ORDER BY date ASC`,
    );

    return { snapshots, newProviders: Array.isArray(newProviders) ? newProviders : [] };
  }

  // ── Platform settings ──

  async getSettings(category?: string) {
    const conditions: any[] = [];
    if (category) conditions.push(eq(platform_settings.category, category));

    const settings = await db
      .select()
      .from(platform_settings)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(platform_settings.category);

    return settings.map((s) => ({
      key: s.key,
      value: s.is_sensitive ? '***' : s.value,
      category: s.category,
      description: s.description,
      isSensitive: s.is_sensitive,
      updatedAt: s.updated_at,
    }));
  }

  async updateSettings(adminId: string, settings: Array<{ key: string; value: unknown }>) {
    const results = [];

    for (const setting of settings) {
      const [existing] = await db
        .select()
        .from(platform_settings)
        .where(eq(platform_settings.key, setting.key))
        .limit(1);

      let result;
      if (existing) {
        [result] = await db
          .update(platform_settings)
          .set({ value: setting.value as any, updated_by: adminId, updated_at: new Date() })
          .where(eq(platform_settings.key, setting.key))
          .returning();
      } else {
        [result] = await db
          .insert(platform_settings)
          .values({
            key: setting.key,
            value: setting.value as any,
            category: 'general',
            updated_by: adminId,
          })
          .returning();
      }
      results.push(result);
    }

    await db.insert(admin_actions).values({
      admin_id: adminId,
      action_type: 'update_settings',
      target_type: 'platform_settings',
      target_id: '00000000-0000-0000-0000-000000000000',
      details: { updatedKeys: settings.map((s) => s.key) },
    });

    logger.info({ adminId, keys: settings.map((s) => s.key) }, 'Platform settings updated');
    return results;
  }

  // ── Export report ──

  async exportReport(adminId: string, data: {
    reportType: string;
    format: string;
    startDate?: string;
    endDate?: string;
    filters?: Record<string, unknown>;
  }) {
    const startDate = data.startDate
      ? new Date(data.startDate)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const endDate = data.endDate ? new Date(data.endDate) : new Date();

    let reportData: unknown;

    switch (data.reportType) {
      case 'users':
        reportData = await db
          .select({
            id: users.id,
            email: users.email,
            first_name: users.first_name,
            last_name: users.last_name,
            status: users.status,
            created_at: users.created_at,
          })
          .from(users)
          .where(and(gte(users.created_at, startDate), lte(users.created_at, endDate)));
        break;
      case 'providers':
        reportData = await db
          .select()
          .from(providers)
          .where(and(gte(providers.created_at, startDate), lte(providers.created_at, endDate)));
        break;
      case 'programs':
        reportData = await db
          .select()
          .from(programs)
          .where(and(gte(programs.created_at, startDate), lte(programs.created_at, endDate)));
        break;
      default:
        throw new BadRequestError(`Unknown report type: ${data.reportType}`);
    }

    await db.insert(admin_actions).values({
      admin_id: adminId,
      action_type: 'export_data',
      target_type: 'report',
      target_id: '00000000-0000-0000-0000-000000000000',
      details: { reportType: data.reportType, format: data.format },
    });

    logger.info({ adminId, reportType: data.reportType }, 'Report exported');
    return { data: reportData, format: data.format, reportType: data.reportType };
  }

  // ── Content flags ──

  async listContentFlags(filters: {
    status?: string;
    entityType?: string;
    page?: number;
    limit?: number;
  }) {
    const page = filters.page || 1;
    const limit = filters.limit || 20;
    const offset = (page - 1) * limit;

    const conditions: any[] = [];
    if (filters.status) conditions.push(sql`${content_flags.status}::text = ${filters.status}`);
    if (filters.entityType) conditions.push(eq(content_flags.entity_type, filters.entityType));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [flags, [{ count }]] = await Promise.all([
      db
        .select()
        .from(content_flags)
        .where(whereClause)
        .orderBy(sql`${content_flags.created_at} DESC`)
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(content_flags)
        .where(whereClause),
    ]);

    // Enrich with reporter info
    const enriched = await Promise.all(
      flags.map(async (f) => {
        const [reporter] = await db
          .select({ first_name: users.first_name, last_name: users.last_name, email: users.email })
          .from(users)
          .where(eq(users.id, f.reported_by))
          .limit(1);
        return { ...f, reporter: reporter ?? null };
      }),
    );

    return {
      data: enriched,
      pagination: buildPaginationMeta(count, page, limit),
    };
  }

  async resolveContentFlag(flagId: string, adminId: string, data: {
    status: string;
    resolutionNotes?: string;
  }) {
    const [flag] = await db
      .select()
      .from(content_flags)
      .where(eq(content_flags.id, flagId))
      .limit(1);

    if (!flag) {
      throw new NotFoundError('Content flag', flagId);
    }

    const [updated] = await db
      .update(content_flags)
      .set({
        status: data.status as any,
        resolved_by: adminId,
        resolved_at: new Date(),
        resolution_notes: data.resolutionNotes,
        updated_at: new Date(),
      })
      .where(eq(content_flags.id, flagId))
      .returning();

    await db.insert(admin_actions).values({
      admin_id: adminId,
      action_type: 'moderate_content',
      target_type: flag.entity_type,
      target_id: flag.entity_id,
      details: {
        flagId,
        status: data.status,
        resolutionNotes: data.resolutionNotes,
      },
    });

    logger.info({ flagId, adminId, status: data.status }, 'Content flag resolved');
    return updated;
  }

  // ── Audit logs ──

  async getAuditLogs(filters: {
    adminId?: string;
    actionType?: string;
    targetType?: string;
    page?: number;
    limit?: number;
  }) {
    const page = filters.page || 1;
    const limit = filters.limit || 20;
    const offset = (page - 1) * limit;

    const conditions: any[] = [];
    if (filters.adminId) conditions.push(eq(admin_actions.admin_id, filters.adminId));
    if (filters.actionType) conditions.push(sql`${admin_actions.action_type}::text = ${filters.actionType}`);
    if (filters.targetType) conditions.push(eq(admin_actions.target_type, filters.targetType));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [logs, [{ count }]] = await Promise.all([
      db
        .select()
        .from(admin_actions)
        .where(whereClause)
        .orderBy(sql`${admin_actions.created_at} DESC`)
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(admin_actions)
        .where(whereClause),
    ]);

    return {
      data: logs,
      pagination: buildPaginationMeta(count, page, limit),
    };
  }
}
