import { Elysia } from 'elysia';
import { requireAuth } from '@longeny/middleware';
import type { ProgressController } from '../controllers/progress.controller.js';
import {
  progressEntrySchema,
  habitSchema,
  reviewSchema,
} from '../validators/index.js';

const bearer = { security: [{ BearerAuth: [] }] };

export function createProgressRoutes(controller: ProgressController) {
  return new Elysia({ prefix: '/progress' })
    .use(requireAuth())
    .get('/dashboard', controller.getDashboard, {
      detail: { tags: ['Progress'], summary: 'Get progress dashboard overview', ...bearer },
    })
    .post('/entries', controller.createEntry, {
      body: progressEntrySchema,
      detail: { tags: ['Progress'], summary: 'Log a health metric entry', ...bearer },
    })
    .get('/entries', controller.listEntries, {
      detail: { tags: ['Progress'], summary: 'List health metric entries', ...bearer },
    })
    .delete('/entries/:id', controller.deleteEntry, {
      detail: { tags: ['Progress'], summary: 'Delete a metric entry', ...bearer },
    })
    .post('/habits', controller.createHabit, {
      body: habitSchema,
      detail: { tags: ['Progress'], summary: 'Create a habit', ...bearer },
    })
    .get('/habits', controller.listHabits, {
      detail: { tags: ['Progress'], summary: 'List habits', ...bearer },
    })
    .put('/habits/:id', controller.updateHabit, {
      detail: { tags: ['Progress'], summary: 'Update a habit', ...bearer },
    })
    .delete('/habits/:id', controller.deleteHabit, {
      detail: { tags: ['Progress'], summary: 'Delete a habit', ...bearer },
    })
    .post('/habits/:id/checkin', controller.habitCheckin, {
      detail: { tags: ['Progress'], summary: 'Check in on a habit', ...bearer },
    })
    .get('/habits/:id/history', controller.getCheckinHistory, {
      detail: { tags: ['Progress'], summary: 'Get habit check-in history', ...bearer },
    })
    .get('/achievements', controller.listAchievements, {
      detail: { tags: ['Progress'], summary: 'List earned achievements', ...bearer },
    })
    .get('/trends', controller.getProgressTrends, {
      detail: { tags: ['Progress'], summary: 'Get progress trends over time', ...bearer },
    })
    .post('/goals', controller.createGoal, {
      detail: { tags: ['Progress'], summary: 'Create a health goal', ...bearer },
    })
    .get('/goals', controller.listGoals, {
      detail: { tags: ['Progress'], summary: 'List health goals', ...bearer },
    })
    .put('/goals/:id', controller.updateGoal, {
      detail: { tags: ['Progress'], summary: 'Update a goal', ...bearer },
    })
    .put('/goals/:id/progress', controller.updateGoalProgress, {
      detail: { tags: ['Progress'], summary: 'Update goal progress', ...bearer },
    })
    .post('/reviews', controller.createReview, {
      body: reviewSchema,
      detail: { tags: ['Progress'], summary: 'Submit a review for a provider or program', ...bearer },
    })
    .get('/reviews', controller.listReviews, {
      detail: { tags: ['Progress'], summary: 'List own reviews', ...bearer },
    })
    .get('/reviews/provider/:providerId', controller.getProviderReviews, {
      detail: { tags: ['Progress'], summary: 'Get all reviews for a provider', ...bearer },
    })
    .put('/reviews/:id', controller.updateReview, {
      detail: { tags: ['Progress'], summary: 'Update a review', ...bearer },
    })
    .delete('/reviews/:id', controller.deleteReview, {
      detail: { tags: ['Progress'], summary: 'Delete a review', ...bearer },
    })
    .post('/reviews/:id/response', controller.createReviewResponse, {
      detail: { tags: ['Progress'], summary: 'Add provider response to a review', ...bearer },
    })
    .post('/reviews/:id/helpful', controller.voteReviewHelpful, {
      detail: { tags: ['Progress'], summary: 'Vote a review as helpful', ...bearer },
    })
    .post('/reminders', controller.createReminder, {
      detail: { tags: ['Progress'], summary: 'Create a wellness reminder', ...bearer },
    })
    .get('/reminders', controller.listReminders, {
      detail: { tags: ['Progress'], summary: 'List reminders', ...bearer },
    })
    .put('/reminders/:id', controller.updateReminder, {
      detail: { tags: ['Progress'], summary: 'Update a reminder', ...bearer },
    })
    .delete('/reminders/:id', controller.deleteReminder, {
      detail: { tags: ['Progress'], summary: 'Delete a reminder', ...bearer },
    });
}
