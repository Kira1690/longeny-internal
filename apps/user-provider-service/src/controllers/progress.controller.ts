import { InternalError } from '@longeny/errors';
import type { RequestContext } from '@longeny/middleware';
import type { ProgressService } from '../services/progress.service.js';

/**
 * Request state the progress handlers read: the account's auth_id (JWT sub) and
 * the subject of care. Both are populated per request by requireAuth and
 * profileContext, but Elysia's context type does not carry a derived `store`
 * this far down the plugin tree, so they can only be declared optional here and
 * asserted once, in `actor()`.
 */
type ProgressStore = Partial<Pick<RequestContext, 'userId' | 'activeProfileId'>>;

type Query = Record<string, string | undefined>;
type Params = Record<string, string>;
type ResponseSet = { status?: number | string };

/**
 * Request bodies are the service's own contracts — never re-declared here.
 * Every write route now validates its body with a Zod schema, but Elysia's
 * `documented()` wrapper hides the Zod type from inference, so the body still
 * arrives typed `unknown` and is asserted against the service's own parameter
 * type. The runtime shape is guaranteed by the route schema, not by the cast.
 */
type EntryBody = Parameters<ProgressService['createEntry']>[2];
type HabitBody = Parameters<ProgressService['createHabit']>[2];
type HabitPatch = Parameters<ProgressService['updateHabit']>[3];
type CheckinBody = NonNullable<Parameters<ProgressService['habitCheckin']>[3]>;
type GoalBody = Parameters<ProgressService['createGoal']>[2];
type GoalPatch = Parameters<ProgressService['updateGoal']>[3];
type GoalProgressBody = Parameters<ProgressService['updateGoalProgress']>[3];

/**
 * Who this request acts as: the paying account, and the profile whose health
 * data it may touch. An empty value means the route is missing requireAuth or
 * profileContext — a wiring bug, and defaulting the profile to the account
 * would silently mix one family member's health data into another's.
 */
function actor(store: ProgressStore): { accountId: string; profileId: string } {
  if (!store.userId || !store.activeProfileId) {
    throw new InternalError('Request context was not resolved for this route');
  }
  return { accountId: store.userId, profileId: store.activeProfileId };
}

export class ProgressController {
  constructor(private progressService: ProgressService) {}

  getDashboard = async ({ store }: { store: ProgressStore }) => {
    const { accountId, profileId } = actor(store);
    const dashboard = await this.progressService.getDashboard(accountId, profileId);
    return { success: true, data: dashboard };
  };

  createEntry = async ({
    body,
    store,
    set,
  }: { body: EntryBody; store: ProgressStore; set: ResponseSet }) => {
    const { accountId, profileId } = actor(store);
    const entry = await this.progressService.createEntry(accountId, profileId, body);
    set.status = 201;
    return { success: true, data: entry };
  };

  listEntries = async ({ store, query }: { store: ProgressStore; query: Query }) => {
    const { accountId, profileId } = actor(store);
    const result = await this.progressService.listEntries(accountId, profileId, {
      type: query.type,
      startDate: query.startDate,
      endDate: query.endDate,
      page: query.page ? Number(query.page) : 1,
      limit: query.limit ? Number(query.limit) : 20,
    });
    return { success: true, ...result };
  };

  deleteEntry = async ({ store, params }: { store: ProgressStore; params: Params }) => {
    const { accountId, profileId } = actor(store);
    const result = await this.progressService.deleteEntry(accountId, profileId, params.id);
    return { success: true, data: result };
  };

  createHabit = async ({
    body,
    store,
    set,
  }: { body: HabitBody; store: ProgressStore; set: ResponseSet }) => {
    const { accountId, profileId } = actor(store);
    const habit = await this.progressService.createHabit(accountId, profileId, body);
    set.status = 201;
    return { success: true, data: habit };
  };

  listHabits = async ({ store, query }: { store: ProgressStore; query: Query }) => {
    const { accountId, profileId } = actor(store);
    const habits = await this.progressService.listHabits(
      accountId,
      profileId,
      query.includeInactive === 'true',
    );
    return { success: true, data: habits };
  };

  updateHabit = async ({
    store,
    params,
    body,
  }: { store: ProgressStore; params: Params; body: unknown }) => {
    const { accountId, profileId } = actor(store);
    const habit = await this.progressService.updateHabit(
      accountId,
      profileId,
      params.id,
      body as HabitPatch,
    );
    return { success: true, data: habit };
  };

  deleteHabit = async ({ store, params }: { store: ProgressStore; params: Params }) => {
    const { accountId, profileId } = actor(store);
    const result = await this.progressService.deleteHabit(accountId, profileId, params.id);
    return { success: true, data: result };
  };

  habitCheckin = async ({
    store,
    params,
    body,
    set,
  }: { store: ProgressStore; params: Params; body: unknown; set: ResponseSet }) => {
    const { accountId, profileId } = actor(store);
    const checkin = await this.progressService.habitCheckin(
      accountId,
      profileId,
      params.id,
      (body as CheckinBody | null) || {},
    );
    set.status = 201;
    return { success: true, data: checkin };
  };

  getCheckinHistory = async ({
    store,
    params,
    query,
  }: { store: ProgressStore; params: Params; query: Query }) => {
    const { accountId, profileId } = actor(store);
    const result = await this.progressService.getCheckinHistory(accountId, profileId, params.id, {
      startDate: query.startDate,
      endDate: query.endDate,
      page: query.page ? Number(query.page) : 1,
      limit: query.limit ? Number(query.limit) : 30,
    });
    return { success: true, ...result };
  };

  listAchievements = async ({ store }: any) => {
    const achievements = await this.progressService.listAchievements(store.userId);
    return { success: true, data: achievements };
  };

  createReview = async ({ store, body, set }: any) => {
    const review = await this.progressService.createReview(store.userId, body);
    set.status = 201;
    return { success: true, data: review };
  };

  listReviews = async ({ query }: any) => {
    const result = await this.progressService.listReviews({
      targetType: query.targetType,
      targetId: query.targetId,
      userId: query.userId,
      status: query.status,
      page: query.page ? Number(query.page) : 1,
      limit: query.limit ? Number(query.limit) : 20,
    });
    return { success: true, ...result };
  };

  updateReview = async ({ store, params, body }: any) => {
    const review = await this.progressService.updateReview(store.userId, params.id, body);
    return { success: true, data: review };
  };

  deleteReview = async ({ store, params }: any) => {
    const result = await this.progressService.deleteReview(store.userId, params.id);
    return { success: true, data: result };
  };

  getProgressTrends = async ({ store, query }: { store: ProgressStore; query: Query }) => {
    const { accountId, profileId } = actor(store);
    const result = await this.progressService.getProgressTrends(accountId, profileId, {
      type: query.type,
      startDate: query.startDate,
      endDate: query.endDate,
      granularity: query.granularity as 'day' | 'week' | 'month',
    });
    return { success: true, data: result };
  };

  createGoal = async ({
    store,
    body,
    set,
  }: { store: ProgressStore; body: unknown; set: ResponseSet }) => {
    const { accountId, profileId } = actor(store);
    const goal = await this.progressService.createGoal(accountId, profileId, body as GoalBody);
    set.status = 201;
    return { success: true, data: goal };
  };

  listGoals = async ({ store, query }: { store: ProgressStore; query: Query }) => {
    const { accountId, profileId } = actor(store);
    const result = await this.progressService.listGoals(accountId, profileId, {
      status: query.status,
      page: query.page ? Number(query.page) : 1,
      limit: query.limit ? Number(query.limit) : 20,
    });
    return { success: true, ...result };
  };

  updateGoal = async ({
    store,
    params,
    body,
  }: { store: ProgressStore; params: Params; body: unknown }) => {
    const { accountId, profileId } = actor(store);
    const goal = await this.progressService.updateGoal(
      accountId,
      profileId,
      params.id,
      body as GoalPatch,
    );
    return { success: true, data: goal };
  };

  updateGoalProgress = async ({
    store,
    params,
    body,
  }: { store: ProgressStore; params: Params; body: unknown }) => {
    const { accountId, profileId } = actor(store);
    const goal = await this.progressService.updateGoalProgress(
      accountId,
      profileId,
      params.id,
      body as GoalProgressBody,
    );
    return { success: true, data: goal };
  };

  getProviderReviews = async ({ params, query }: any) => {
    const result = await this.progressService.getProviderReviews(params.providerId, {
      page: query.page ? Number(query.page) : 1,
      limit: query.limit ? Number(query.limit) : 20,
    });
    return { success: true, ...result };
  };

  createReviewResponse = async ({ store, params, body, set }: any) => {
    const response = await this.progressService.createReviewResponse(store.userId, params.id, body);
    set.status = 201;
    return { success: true, data: response };
  };

  voteReviewHelpful = async ({ store, params, set }: any) => {
    const result = await this.progressService.voteReviewHelpful(store.userId, params.id);
    set.status = 201;
    return { success: true, data: result };
  };

  createReminder = async ({ store, body, set }: any) => {
    const reminder = await this.progressService.createReminder(store.userId, body);
    set.status = 201;
    return { success: true, data: reminder };
  };

  listReminders = async ({ store, query }: any) => {
    const result = await this.progressService.listReminders(store.userId, {
      active: query.active ? query.active === 'true' : undefined,
      page: query.page ? Number(query.page) : 1,
      limit: query.limit ? Number(query.limit) : 20,
    });
    return { success: true, ...result };
  };

  updateReminder = async ({ store, params, body }: any) => {
    const reminder = await this.progressService.updateReminder(store.userId, params.id, body);
    return { success: true, data: reminder };
  };

  deleteReminder = async ({ store, params }: any) => {
    const result = await this.progressService.deleteReminder(store.userId, params.id);
    return { success: true, data: result };
  };
}
