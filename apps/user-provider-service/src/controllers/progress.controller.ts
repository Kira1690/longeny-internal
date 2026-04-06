import type { ProgressService } from '../services/progress.service.js';

export class ProgressController {
  constructor(private progressService: ProgressService) {}

  getDashboard = async ({ store }: any) => {
    const dashboard = await this.progressService.getDashboard(store.userId);
    return { success: true, data: dashboard };
  };

  createEntry = async ({ body, store, set }: any) => {
    const entry = await this.progressService.createEntry(store.userId, body);
    set.status = 201;
    return { success: true, data: entry };
  };

  listEntries = async ({ store, query }: any) => {
    const result = await this.progressService.listEntries(store.userId, {
      type: query.type,
      startDate: query.startDate,
      endDate: query.endDate,
      page: query.page ? Number(query.page) : 1,
      limit: query.limit ? Number(query.limit) : 20,
    });
    return { success: true, ...result };
  };

  deleteEntry = async ({ store, params }: any) => {
    const result = await this.progressService.deleteEntry(store.userId, params.id);
    return { success: true, data: result };
  };

  createHabit = async ({ body, store, set }: any) => {
    const habit = await this.progressService.createHabit(store.userId, body);
    set.status = 201;
    return { success: true, data: habit };
  };

  listHabits = async ({ store, query }: any) => {
    const habits = await this.progressService.listHabits(store.userId, query.includeInactive === 'true');
    return { success: true, data: habits };
  };

  updateHabit = async ({ store, params, body }: any) => {
    const habit = await this.progressService.updateHabit(store.userId, params.id, body);
    return { success: true, data: habit };
  };

  deleteHabit = async ({ store, params }: any) => {
    const result = await this.progressService.deleteHabit(store.userId, params.id);
    return { success: true, data: result };
  };

  habitCheckin = async ({ store, params, body, set }: any) => {
    const checkin = await this.progressService.habitCheckin(store.userId, params.id, body || {});
    set.status = 201;
    return { success: true, data: checkin };
  };

  getCheckinHistory = async ({ store, params, query }: any) => {
    const result = await this.progressService.getCheckinHistory(store.userId, params.id, {
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

  getProgressTrends = async ({ store, query }: any) => {
    const result = await this.progressService.getProgressTrends(store.userId, {
      type: query.type,
      startDate: query.startDate,
      endDate: query.endDate,
      granularity: query.granularity as 'day' | 'week' | 'month',
    });
    return { success: true, data: result };
  };

  createGoal = async ({ store, body, set }: any) => {
    const goal = await this.progressService.createGoal(store.userId, body);
    set.status = 201;
    return { success: true, data: goal };
  };

  listGoals = async ({ store, query }: any) => {
    const result = await this.progressService.listGoals(store.userId, {
      status: query.status,
      page: query.page ? Number(query.page) : 1,
      limit: query.limit ? Number(query.limit) : 20,
    });
    return { success: true, ...result };
  };

  updateGoal = async ({ store, params, body }: any) => {
    const goal = await this.progressService.updateGoal(store.userId, params.id, body);
    return { success: true, data: goal };
  };

  updateGoalProgress = async ({ store, params, body }: any) => {
    const goal = await this.progressService.updateGoalProgress(store.userId, params.id, body);
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
