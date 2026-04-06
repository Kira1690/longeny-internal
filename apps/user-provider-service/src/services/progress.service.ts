import { db } from '../db/index.js';
import { sql, eq, and, gte, lte, inArray } from 'drizzle-orm';
import {
  progress_entries,
  habits,
  habit_checkins,
  achievements,
  reviews,
  review_responses,
  review_helpful_votes,
  goals,
  reminders,
  users,
  providers,
} from '../db/schema.js';
import { NotFoundError, ConflictError, ForbiddenError } from '@longeny/errors';
import { createLogger, buildPaginationMeta } from '@longeny/utils';

const logger = createLogger('progress-service');

export class ProgressService {
  constructor(_prismaUnused: unknown) {}

  // ── Dashboard ──

  async getDashboard(userId: string) {
    const today = new Date().toISOString().split('T')[0];

    const [
      recentEntries,
      activeHabits,
      recentAchievements,
      [{ totalStreak, totalCompletions, longestStreak }],
    ] = await Promise.all([
      db
        .select()
        .from(progress_entries)
        .where(eq(progress_entries.user_id, userId))
        .orderBy(sql`${progress_entries.date} DESC`)
        .limit(10),
      db
        .select()
        .from(habits)
        .where(and(eq(habits.user_id, userId), eq(habits.is_active, true))),
      db
        .select()
        .from(achievements)
        .where(eq(achievements.user_id, userId))
        .orderBy(sql`${achievements.earned_at} DESC`)
        .limit(5),
      db.select({
        totalStreak: sql<number>`COALESCE(SUM(streak), 0)::int`,
        totalCompletions: sql<number>`COALESCE(SUM(total_completions), 0)::int`,
        longestStreak: sql<number>`COALESCE(MAX(longest_streak), 0)::int`,
      }).from(habits).where(and(eq(habits.user_id, userId), eq(habits.is_active, true))),
    ]);

    // Enrich habits with recent checkins
    const habitsWithCheckins = await Promise.all(
      activeHabits.map(async (h) => {
        const checkins = await db
          .select()
          .from(habit_checkins)
          .where(eq(habit_checkins.habit_id, h.id))
          .orderBy(sql`${habit_checkins.date} DESC`)
          .limit(7);
        return { ...h, checkins };
      }),
    );

    const [{ todayCheckins }] = await db
      .select({ todayCheckins: sql<number>`COUNT(*)::int` })
      .from(habit_checkins)
      .where(
        and(
          eq(habit_checkins.user_id, userId),
          sql`${habit_checkins.date}::text = ${today}`,
          eq(habit_checkins.completed, true),
        ),
      );

    return {
      recentEntries,
      activeHabits: habitsWithCheckins,
      recentAchievements,
      streaks: {
        totalCurrentStreak: totalStreak,
        longestStreak,
        totalCompletions,
      },
      todayCompletionRate: activeHabits.length > 0
        ? Math.round((todayCheckins / activeHabits.length) * 100)
        : 0,
    };
  }

  // ── Progress entries ──

  async createEntry(userId: string, data: {
    metricType: string;
    value: number;
    unit?: string;
    notes?: string;
    recordedAt?: string;
  }) {
    const dateObj = data.recordedAt ? new Date(data.recordedAt) : new Date();
    const dateStr = dateObj.toISOString().split('T')[0];

    // Upsert: find existing entry for this user/type/date, update or insert
    const [existing] = await db
      .select()
      .from(progress_entries)
      .where(
        and(
          eq(progress_entries.user_id, userId),
          sql`${progress_entries.type}::text = ${data.metricType}`,
          sql`${progress_entries.date}::text = ${dateStr}`,
        ),
      )
      .limit(1);

    let entry;
    if (existing) {
      [entry] = await db
        .update(progress_entries)
        .set({ value: data.value, unit: data.unit, notes: data.notes })
        .where(eq(progress_entries.id, existing.id))
        .returning();
    } else {
      [entry] = await db
        .insert(progress_entries)
        .values({
          user_id: userId,
          type: data.metricType as any,
          metric: data.metricType,
          value: data.value,
          unit: data.unit,
          notes: data.notes,
          date: dateStr,
        })
        .returning();
    }

    await this.checkProgressAchievements(userId);

    return entry;
  }

  async listEntries(userId: string, filters: {
    type?: string;
    startDate?: string;
    endDate?: string;
    page?: number;
    limit?: number;
  }) {
    const page = filters.page || 1;
    const limit = filters.limit || 20;
    const offset = (page - 1) * limit;

    const conditions: any[] = [eq(progress_entries.user_id, userId)];
    if (filters.type) conditions.push(sql`${progress_entries.type}::text = ${filters.type}`);
    if (filters.startDate) conditions.push(sql`${progress_entries.date}::date >= ${filters.startDate}::date`);
    if (filters.endDate) conditions.push(sql`${progress_entries.date}::date <= ${filters.endDate}::date`);

    const whereClause = and(...conditions);

    const [entries, [{ count }]] = await Promise.all([
      db
        .select()
        .from(progress_entries)
        .where(whereClause)
        .orderBy(sql`${progress_entries.date} DESC`)
        .limit(limit)
        .offset(offset),
      db.select({ count: sql<number>`COUNT(*)::int` }).from(progress_entries).where(whereClause),
    ]);

    return {
      data: entries,
      pagination: buildPaginationMeta(count, page, limit),
    };
  }

  async deleteEntry(userId: string, entryId: string) {
    const [entry] = await db
      .select()
      .from(progress_entries)
      .where(and(eq(progress_entries.id, entryId), eq(progress_entries.user_id, userId)))
      .limit(1);

    if (!entry) {
      throw new NotFoundError('Progress entry', entryId);
    }

    await db.delete(progress_entries).where(eq(progress_entries.id, entryId));

    return { success: true };
  }

  // ── Habits ──

  async createHabit(userId: string, data: {
    name: string;
    description?: string;
    frequency: string;
    targetCount?: number;
    customDays?: string[];
    reminderTime?: string;
    category?: string;
    unit?: string;
  }) {
    const [habit] = await db
      .insert(habits)
      .values({
        user_id: userId,
        title: data.name,
        description: data.description,
        category: data.category,
        frequency: data.frequency as any,
        target_count: data.targetCount || 1,
        unit: data.unit,
        reminder_time: data.reminderTime ?? null,
      })
      .returning();

    return habit;
  }

  async listHabits(userId: string, includeInactive = false) {
    const conditions: any[] = [eq(habits.user_id, userId)];
    if (!includeInactive) conditions.push(eq(habits.is_active, true));

    const habitRows = await db
      .select()
      .from(habits)
      .where(and(...conditions))
      .orderBy(sql`${habits.created_at} DESC`);

    const enriched = await Promise.all(
      habitRows.map(async (h) => {
        const checkins = await db
          .select()
          .from(habit_checkins)
          .where(eq(habit_checkins.habit_id, h.id))
          .orderBy(sql`${habit_checkins.date} DESC`)
          .limit(7);
        return { ...h, checkins };
      }),
    );

    return enriched;
  }

  async updateHabit(userId: string, habitId: string, data: {
    name?: string;
    description?: string;
    frequency?: string;
    targetCount?: number;
    reminderTime?: string;
    isActive?: boolean;
    category?: string;
    unit?: string;
  }) {
    const [habit] = await db
      .select()
      .from(habits)
      .where(and(eq(habits.id, habitId), eq(habits.user_id, userId)))
      .limit(1);

    if (!habit) {
      throw new NotFoundError('Habit', habitId);
    }

    const updateData: Record<string, unknown> = { updated_at: new Date() };
    if (data.name !== undefined) updateData.title = data.name;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.category !== undefined) updateData.category = data.category;
    if (data.frequency !== undefined) updateData.frequency = data.frequency;
    if (data.targetCount !== undefined) updateData.target_count = data.targetCount;
    if (data.unit !== undefined) updateData.unit = data.unit;
    if (data.isActive !== undefined) updateData.is_active = data.isActive;
    if (data.reminderTime !== undefined) updateData.reminder_time = data.reminderTime ?? null;

    const [updated] = await db
      .update(habits)
      .set(updateData as any)
      .where(eq(habits.id, habitId))
      .returning();

    return updated;
  }

  async deleteHabit(userId: string, habitId: string) {
    const [habit] = await db
      .select()
      .from(habits)
      .where(and(eq(habits.id, habitId), eq(habits.user_id, userId)))
      .limit(1);

    if (!habit) {
      throw new NotFoundError('Habit', habitId);
    }

    await db.update(habits).set({ is_active: false, updated_at: new Date() }).where(eq(habits.id, habitId));

    return { success: true };
  }

  async habitCheckin(userId: string, habitId: string, data?: {
    notes?: string;
    value?: number;
    date?: string;
  }) {
    const [habit] = await db
      .select()
      .from(habits)
      .where(and(eq(habits.id, habitId), eq(habits.user_id, userId), eq(habits.is_active, true)))
      .limit(1);

    if (!habit) {
      throw new NotFoundError('Habit', habitId);
    }

    const checkinDate = data?.date
      ? data.date.split('T')[0]
      : new Date().toISOString().split('T')[0];

    const [existing] = await db
      .select()
      .from(habit_checkins)
      .where(
        and(
          eq(habit_checkins.habit_id, habitId),
          sql`${habit_checkins.date}::text = ${checkinDate}`,
        ),
      )
      .limit(1);

    let checkin;
    if (existing) {
      [checkin] = await db
        .update(habit_checkins)
        .set({
          count: existing.count + 1,
          completed: true,
          notes: data?.notes,
        })
        .where(eq(habit_checkins.id, existing.id))
        .returning();
    } else {
      [checkin] = await db
        .insert(habit_checkins)
        .values({
          habit_id: habitId,
          user_id: userId,
          date: checkinDate,
          count: data?.value || 1,
          completed: true,
          notes: data?.notes,
        })
        .returning();
    }

    await this.updateStreak(habitId, userId);
    await this.checkHabitAchievements(userId, habitId);

    return checkin;
  }

  async getCheckinHistory(userId: string, habitId: string, filters: {
    startDate?: string;
    endDate?: string;
    page?: number;
    limit?: number;
  }) {
    const [habit] = await db
      .select()
      .from(habits)
      .where(and(eq(habits.id, habitId), eq(habits.user_id, userId)))
      .limit(1);

    if (!habit) {
      throw new NotFoundError('Habit', habitId);
    }

    const page = filters.page || 1;
    const limit = filters.limit || 30;
    const offset = (page - 1) * limit;

    const conditions: any[] = [eq(habit_checkins.habit_id, habitId)];
    if (filters.startDate) conditions.push(sql`${habit_checkins.date}::date >= ${filters.startDate}::date`);
    if (filters.endDate) conditions.push(sql`${habit_checkins.date}::date <= ${filters.endDate}::date`);

    const whereClause = and(...conditions);

    const [checkins, [{ count }]] = await Promise.all([
      db
        .select()
        .from(habit_checkins)
        .where(whereClause)
        .orderBy(sql`${habit_checkins.date} DESC`)
        .limit(limit)
        .offset(offset),
      db.select({ count: sql<number>`COUNT(*)::int` }).from(habit_checkins).where(whereClause),
    ]);

    return {
      data: checkins,
      habit: { id: habit.id, title: habit.title, streak: habit.streak, longestStreak: habit.longest_streak },
      pagination: buildPaginationMeta(count, page, limit),
    };
  }

  // ── Achievements ──

  async listAchievements(userId: string) {
    return db
      .select()
      .from(achievements)
      .where(eq(achievements.user_id, userId))
      .orderBy(sql`${achievements.earned_at} DESC`);
  }

  // ── Reviews ──

  async createReview(userId: string, data: {
    targetType: string;
    targetId: string;
    rating: number;
    title?: string;
    comment?: string;
  }) {
    const [existing] = await db
      .select()
      .from(reviews)
      .where(
        and(
          eq(reviews.user_id, userId),
          sql`${reviews.target_type}::text = ${data.targetType}`,
          eq(reviews.target_id, data.targetId),
        ),
      )
      .limit(1);

    if (existing) {
      throw new ConflictError('You have already reviewed this item');
    }

    const [review] = await db
      .insert(reviews)
      .values({
        user_id: userId,
        target_type: data.targetType as any,
        target_id: data.targetId,
        rating: data.rating,
        title: data.title,
        comment: data.comment,
        status: 'PENDING',
      })
      .returning();

    if (data.targetType === 'PROVIDER') {
      await this.updateProviderRating(data.targetId);
    }

    return review;
  }

  async listReviews(filters: {
    targetType?: string;
    targetId?: string;
    userId?: string;
    status?: string;
    page?: number;
    limit?: number;
  }) {
    const page = filters.page || 1;
    const limit = filters.limit || 20;
    const offset = (page - 1) * limit;

    const conditions: any[] = [];
    if (filters.targetType) conditions.push(sql`${reviews.target_type}::text = ${filters.targetType}`);
    if (filters.targetId) conditions.push(eq(reviews.target_id, filters.targetId));
    if (filters.userId) conditions.push(eq(reviews.user_id, filters.userId));
    if (filters.status) conditions.push(sql`${reviews.status}::text = ${filters.status}`);

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [reviewRows, [{ count }]] = await Promise.all([
      db
        .select()
        .from(reviews)
        .where(whereClause)
        .orderBy(sql`${reviews.created_at} DESC`)
        .limit(limit)
        .offset(offset),
      db.select({ count: sql<number>`COUNT(*)::int` }).from(reviews).where(whereClause),
    ]);

    const enriched = await Promise.all(
      reviewRows.map(async (r) => {
        const [user] = await db
          .select({ first_name: users.first_name, last_name: users.last_name, avatar_url: users.avatar_url })
          .from(users)
          .where(eq(users.id, r.user_id))
          .limit(1);
        return { ...r, user: user ?? null };
      }),
    );

    return {
      data: enriched,
      pagination: buildPaginationMeta(count, page, limit),
    };
  }

  async updateReview(userId: string, reviewId: string, data: {
    rating?: number;
    title?: string;
    comment?: string;
  }) {
    const [review] = await db
      .select()
      .from(reviews)
      .where(and(eq(reviews.id, reviewId), eq(reviews.user_id, userId)))
      .limit(1);

    if (!review) {
      throw new NotFoundError('Review', reviewId);
    }

    const updateData: Record<string, unknown> = { status: 'PENDING', updated_at: new Date() };
    if (data.rating !== undefined) updateData.rating = data.rating;
    if (data.title !== undefined) updateData.title = data.title;
    if (data.comment !== undefined) updateData.comment = data.comment;

    const [updated] = await db
      .update(reviews)
      .set(updateData as any)
      .where(eq(reviews.id, reviewId))
      .returning();

    if (data.rating !== undefined) {
      await this.updateProviderRating(review.target_id);
    }

    return updated;
  }

  async deleteReview(userId: string, reviewId: string) {
    const [review] = await db
      .select()
      .from(reviews)
      .where(and(eq(reviews.id, reviewId), eq(reviews.user_id, userId)))
      .limit(1);

    if (!review) {
      throw new NotFoundError('Review', reviewId);
    }

    await db.delete(reviews).where(eq(reviews.id, reviewId));

    if (review.target_type === 'PROVIDER') {
      await this.updateProviderRating(review.target_id);
    }

    return { success: true };
  }

  // ── Progress trends ──

  async getProgressTrends(userId: string, filters: {
    type?: string;
    startDate?: string;
    endDate?: string;
    granularity?: 'day' | 'week' | 'month';
  }) {
    const startDate = filters.startDate
      ? filters.startDate
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const endDate = filters.endDate ? filters.endDate : new Date().toISOString().split('T')[0];
    const granularity = filters.granularity || 'day';

    const typeFilter = filters.type ? sql` AND "type"::text = ${filters.type}` : sql``;

    let dateGroup: string;
    switch (granularity) {
      case 'week':
        dateGroup = `DATE_TRUNC('week', "date")`;
        break;
      case 'month':
        dateGroup = `DATE_TRUNC('month', "date")`;
        break;
      default:
        dateGroup = `"date"`;
    }

    const trends = await db.execute(
      sql`SELECT ${sql.raw(dateGroup)} AS period, "type"::text,
         AVG("value")::float AS avg_value,
         MIN("value")::float AS min_value,
         MAX("value")::float AS max_value,
         COUNT(*)::int AS count
         FROM progress_entries
         WHERE "user_id" = ${userId}::uuid AND "date"::date >= ${startDate}::date AND "date"::date <= ${endDate}::date
         ${typeFilter}
         GROUP BY ${sql.raw(dateGroup)}, "type"
         ORDER BY period ASC`,
    );

    return Array.isArray(trends) ? trends : [];
  }

  // ── Goals ──

  async createGoal(userId: string, data: {
    title: string;
    description?: string;
    targetValue?: number;
    unit?: string;
    category?: string;
    startDate: string;
    targetDate?: string;
  }) {
    const [goal] = await db
      .insert(goals)
      .values({
        user_id: userId,
        title: data.title,
        description: data.description,
        target_value: data.targetValue?.toString(),
        unit: data.unit,
        category: data.category,
        start_date: data.startDate,
        target_date: data.targetDate ?? null,
        status: 'in_progress',
      })
      .returning();

    return goal;
  }

  async listGoals(userId: string, filters: { status?: string; page?: number; limit?: number }) {
    const page = filters.page || 1;
    const limit = filters.limit || 20;
    const offset = (page - 1) * limit;

    const conditions: any[] = [eq(goals.user_id, userId)];
    if (filters.status) conditions.push(sql`${goals.status}::text = ${filters.status}`);

    const whereClause = and(...conditions);

    const [goalRows, [{ count }]] = await Promise.all([
      db
        .select()
        .from(goals)
        .where(whereClause)
        .orderBy(sql`${goals.created_at} DESC`)
        .limit(limit)
        .offset(offset),
      db.select({ count: sql<number>`COUNT(*)::int` }).from(goals).where(whereClause),
    ]);

    return {
      data: goalRows,
      pagination: buildPaginationMeta(count, page, limit),
    };
  }

  async updateGoal(userId: string, goalId: string, data: {
    title?: string;
    description?: string;
    targetValue?: number;
    unit?: string;
    category?: string;
    targetDate?: string;
    status?: string;
  }) {
    const [goal] = await db
      .select()
      .from(goals)
      .where(and(eq(goals.id, goalId), eq(goals.user_id, userId)))
      .limit(1);

    if (!goal) {
      throw new NotFoundError('Goal', goalId);
    }

    const updateData: Record<string, unknown> = { updated_at: new Date() };
    if (data.title !== undefined) updateData.title = data.title;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.targetValue !== undefined) updateData.target_value = data.targetValue.toString();
    if (data.unit !== undefined) updateData.unit = data.unit;
    if (data.category !== undefined) updateData.category = data.category;
    if (data.targetDate !== undefined) updateData.target_date = data.targetDate ?? null;
    if (data.status !== undefined) {
      updateData.status = data.status;
      if (data.status === 'completed') updateData.completed_at = new Date();
    }

    const [updated] = await db
      .update(goals)
      .set(updateData as any)
      .where(eq(goals.id, goalId))
      .returning();

    return updated;
  }

  async updateGoalProgress(userId: string, goalId: string, data: { currentValue: number }) {
    const [goal] = await db
      .select()
      .from(goals)
      .where(and(eq(goals.id, goalId), eq(goals.user_id, userId)))
      .limit(1);

    if (!goal) {
      throw new NotFoundError('Goal', goalId);
    }

    const isCompleted = goal.target_value
      ? data.currentValue >= Number(goal.target_value)
      : false;

    const [updated] = await db
      .update(goals)
      .set({
        current_value: data.currentValue.toString(),
        status: isCompleted ? 'completed' : goal.status,
        completed_at: isCompleted ? new Date() : goal.completed_at,
        updated_at: new Date(),
      })
      .where(eq(goals.id, goalId))
      .returning();

    return updated;
  }

  // ── Provider reviews (public) ──

  async getProviderReviews(providerId: string, filters: { page?: number; limit?: number }) {
    const page = filters.page || 1;
    const limit = filters.limit || 20;
    const offset = (page - 1) * limit;

    const whereClause = and(
      sql`${reviews.target_type}::text = 'PROVIDER'`,
      eq(reviews.target_id, providerId),
      sql`${reviews.status}::text IN ('PENDING', 'APPROVED')`,
    );

    const [reviewRows, [{ count }]] = await Promise.all([
      db
        .select()
        .from(reviews)
        .where(whereClause)
        .orderBy(sql`${reviews.created_at} DESC`)
        .limit(limit)
        .offset(offset),
      db.select({ count: sql<number>`COUNT(*)::int` }).from(reviews).where(whereClause),
    ]);

    const enriched = await Promise.all(
      reviewRows.map(async (r) => {
        const [user] = await db
          .select({ first_name: users.first_name, last_name: users.last_name, avatar_url: users.avatar_url })
          .from(users)
          .where(eq(users.id, r.user_id))
          .limit(1);

        const [response] = await db
          .select()
          .from(review_responses)
          .where(eq(review_responses.review_id, r.id))
          .limit(1);

        const [{ helpfulCount }] = await db
          .select({ helpfulCount: sql<number>`COUNT(*)::int` })
          .from(review_helpful_votes)
          .where(eq(review_helpful_votes.review_id, r.id));

        return { ...r, user: user ?? null, response: response ?? null, helpfulCount };
      }),
    );

    return {
      data: enriched,
      pagination: buildPaginationMeta(count, page, limit),
    };
  }

  // ── Provider responds to review ──

  async createReviewResponse(userId: string, reviewId: string, data: { responseText: string }) {
    const [review] = await db
      .select()
      .from(reviews)
      .where(eq(reviews.id, reviewId))
      .limit(1);

    if (!review) {
      throw new NotFoundError('Review', reviewId);
    }

    const [existingResponse] = await db
      .select()
      .from(review_responses)
      .where(eq(review_responses.review_id, reviewId))
      .limit(1);

    if (existingResponse) {
      throw new ConflictError('Review already has a response');
    }

    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.auth_id, userId))
      .limit(1);

    if (!user) {
      throw new ForbiddenError('Only providers can respond to reviews');
    }

    const [provider] = await db
      .select()
      .from(providers)
      .where(eq(providers.user_id, user.id))
      .limit(1);

    if (!provider) {
      throw new ForbiddenError('Only providers can respond to reviews');
    }

    if (review.target_type !== 'PROVIDER' || review.target_id !== provider.id) {
      throw new ForbiddenError('You can only respond to reviews about your provider profile');
    }

    const [response] = await db
      .insert(review_responses)
      .values({
        review_id: reviewId,
        provider_id: provider.id,
        response_text: data.responseText,
      })
      .returning();

    return response;
  }

  // ── Vote review as helpful ──

  async voteReviewHelpful(userId: string, reviewId: string) {
    const [review] = await db
      .select()
      .from(reviews)
      .where(eq(reviews.id, reviewId))
      .limit(1);

    if (!review) {
      throw new NotFoundError('Review', reviewId);
    }

    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.auth_id, userId))
      .limit(1);

    if (!user) {
      throw new NotFoundError('User');
    }

    try {
      const [vote] = await db
        .insert(review_helpful_votes)
        .values({ review_id: reviewId, user_id: user.id })
        .returning();

      return vote;
    } catch (error: any) {
      if (error.code === '23505') {
        throw new ConflictError('You have already voted this review as helpful');
      }
      throw error;
    }
  }

  // ── Reminders ──

  async createReminder(userId: string, data: {
    title: string;
    message?: string;
    reminderType: string;
    relatedId?: string;
    scheduledAt: string;
  }) {
    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.auth_id, userId))
      .limit(1);

    if (!user) {
      throw new NotFoundError('User');
    }

    const [reminder] = await db
      .insert(reminders)
      .values({
        user_id: user.id,
        title: data.title,
        message: data.message,
        reminder_type: data.reminderType as any,
        related_id: data.relatedId,
        scheduled_at: new Date(data.scheduledAt),
      })
      .returning();

    return reminder;
  }

  async listReminders(userId: string, filters: { active?: boolean; page?: number; limit?: number }) {
    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.auth_id, userId))
      .limit(1);

    if (!user) {
      throw new NotFoundError('User');
    }

    const page = filters.page || 1;
    const limit = filters.limit || 20;
    const offset = (page - 1) * limit;

    const conditions: any[] = [eq(reminders.user_id, user.id)];
    if (filters.active !== undefined) conditions.push(eq(reminders.is_active, filters.active));

    const whereClause = and(...conditions);

    const [reminderRows, [{ count }]] = await Promise.all([
      db
        .select()
        .from(reminders)
        .where(whereClause)
        .orderBy(reminders.scheduled_at)
        .limit(limit)
        .offset(offset),
      db.select({ count: sql<number>`COUNT(*)::int` }).from(reminders).where(whereClause),
    ]);

    return {
      data: reminderRows,
      pagination: buildPaginationMeta(count, page, limit),
    };
  }

  async updateReminder(userId: string, reminderId: string, data: {
    title?: string;
    message?: string;
    scheduledAt?: string;
    isActive?: boolean;
  }) {
    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.auth_id, userId))
      .limit(1);

    if (!user) {
      throw new NotFoundError('User');
    }

    const [reminder] = await db
      .select()
      .from(reminders)
      .where(and(eq(reminders.id, reminderId), eq(reminders.user_id, user.id)))
      .limit(1);

    if (!reminder) {
      throw new NotFoundError('Reminder', reminderId);
    }

    const updateData: Record<string, unknown> = {};
    if (data.title !== undefined) updateData.title = data.title;
    if (data.message !== undefined) updateData.message = data.message;
    if (data.scheduledAt !== undefined) updateData.scheduled_at = new Date(data.scheduledAt);
    if (data.isActive !== undefined) updateData.is_active = data.isActive;

    const [updated] = await db
      .update(reminders)
      .set(updateData as any)
      .where(eq(reminders.id, reminderId))
      .returning();

    return updated;
  }

  async deleteReminder(userId: string, reminderId: string) {
    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.auth_id, userId))
      .limit(1);

    if (!user) {
      throw new NotFoundError('User');
    }

    const [reminder] = await db
      .select()
      .from(reminders)
      .where(and(eq(reminders.id, reminderId), eq(reminders.user_id, user.id)))
      .limit(1);

    if (!reminder) {
      throw new NotFoundError('Reminder', reminderId);
    }

    await db.delete(reminders).where(eq(reminders.id, reminderId));

    return { success: true };
  }

  // ── Private helpers ──

  private async updateStreak(habitId: string, _userId: string) {
    const checkins = await db
      .select()
      .from(habit_checkins)
      .where(and(eq(habit_checkins.habit_id, habitId), eq(habit_checkins.completed, true)))
      .orderBy(sql`${habit_checkins.date} DESC`)
      .limit(365);

    let streak = 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let i = 0; i < checkins.length; i++) {
      const expectedDate = new Date(today);
      expectedDate.setDate(expectedDate.getDate() - i);
      expectedDate.setHours(0, 0, 0, 0);

      const checkinDate = new Date(checkins[i].date as any);
      checkinDate.setHours(0, 0, 0, 0);

      if (checkinDate.getTime() === expectedDate.getTime()) {
        streak++;
      } else {
        break;
      }
    }

    const [habit] = await db
      .select()
      .from(habits)
      .where(eq(habits.id, habitId))
      .limit(1);

    await db.update(habits).set({
      streak,
      longest_streak: Math.max(streak, habit?.longest_streak || 0),
      total_completions: (habit?.total_completions || 0) + 1,
      updated_at: new Date(),
    }).where(eq(habits.id, habitId));
  }

  private async updateProviderRating(providerId: string) {
    const [result] = await db
      .select({
        avg: sql<number>`AVG(rating)::float`,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(reviews)
      .where(
        and(
          sql`${reviews.target_type}::text = 'PROVIDER'`,
          eq(reviews.target_id, providerId),
          sql`${reviews.status}::text IN ('PENDING', 'APPROVED')`,
        ),
      );

    await db
      .update(providers)
      .set({
        rating_avg: (result?.avg || 0).toString(),
        review_count: result?.count || 0,
        updated_at: new Date(),
      })
      .where(eq(providers.id, providerId))
      .catch(() => {
        // Provider may not exist in this DB context
      });
  }

  private async checkProgressAchievements(userId: string) {
    const [{ entryCount }] = await db
      .select({ entryCount: sql<number>`COUNT(*)::int` })
      .from(progress_entries)
      .where(eq(progress_entries.user_id, userId));

    const milestones = [
      { count: 1, type: 'first_entry', title: 'First Step', description: 'Logged your first progress entry', icon: 'star' },
      { count: 10, type: 'ten_entries', title: 'Getting Started', description: 'Logged 10 progress entries', icon: 'trending_up' },
      { count: 50, type: 'fifty_entries', title: 'Committed', description: 'Logged 50 progress entries', icon: 'fire' },
      { count: 100, type: 'hundred_entries', title: 'Century', description: 'Logged 100 progress entries', icon: 'trophy' },
    ];

    for (const milestone of milestones) {
      if (entryCount >= milestone.count) {
        const [existing] = await db
          .select()
          .from(achievements)
          .where(and(eq(achievements.user_id, userId), eq(achievements.type, milestone.type)))
          .limit(1);

        if (!existing) {
          await db.insert(achievements).values({
            user_id: userId,
            type: milestone.type,
            title: milestone.title,
            description: milestone.description,
            icon: milestone.icon,
          }).catch(() => { /* ignore duplicates */ });
        }
      }
    }
  }

  private async checkHabitAchievements(userId: string, habitId: string) {
    const [habit] = await db
      .select()
      .from(habits)
      .where(eq(habits.id, habitId))
      .limit(1);

    if (!habit) return;

    const streakMilestones = [
      { count: 7, type: 'week_streak', title: 'Week Warrior', description: '7-day streak', icon: 'calendar' },
      { count: 30, type: 'month_streak', title: 'Monthly Master', description: '30-day streak', icon: 'calendar_month' },
      { count: 100, type: 'century_streak', title: 'Unstoppable', description: '100-day streak', icon: 'bolt' },
    ];

    for (const milestone of streakMilestones) {
      if (habit.streak >= milestone.count) {
        const [existing] = await db
          .select()
          .from(achievements)
          .where(and(eq(achievements.user_id, userId), eq(achievements.type, milestone.type)))
          .limit(1);

        if (!existing) {
          await db.insert(achievements).values({
            user_id: userId,
            type: milestone.type,
            title: milestone.title,
            description: milestone.description,
            icon: milestone.icon,
            metadata: { habitId, habitTitle: habit.title },
          }).catch(() => { /* ignore duplicates */ });
        }
      }
    }
  }
}
