import { Elysia } from 'elysia';
import { requireAuth } from '@longeny/middleware';
import type { ProgressController } from '../controllers/progress.controller.js';
import {
  progressEntrySchema,
  habitSchema,
  reviewSchema,
} from '../validators/index.js';

export function createProgressRoutes(controller: ProgressController) {
  return new Elysia({ prefix: '/progress' })
    .use(requireAuth())
    .get('/dashboard', controller.getDashboard)
    .post('/entries', controller.createEntry, { body: progressEntrySchema })
    .get('/entries', controller.listEntries)
    .delete('/entries/:id', controller.deleteEntry)
    .post('/habits', controller.createHabit, { body: habitSchema })
    .get('/habits', controller.listHabits)
    .put('/habits/:id', controller.updateHabit)
    .delete('/habits/:id', controller.deleteHabit)
    .post('/habits/:id/checkin', controller.habitCheckin)
    .get('/habits/:id/history', controller.getCheckinHistory)
    .get('/achievements', controller.listAchievements)
    .get('/trends', controller.getProgressTrends)
    .post('/goals', controller.createGoal)
    .get('/goals', controller.listGoals)
    .put('/goals/:id', controller.updateGoal)
    .put('/goals/:id/progress', controller.updateGoalProgress)
    .post('/reviews', controller.createReview, { body: reviewSchema })
    .get('/reviews', controller.listReviews)
    .get('/reviews/provider/:providerId', controller.getProviderReviews)
    .put('/reviews/:id', controller.updateReview)
    .delete('/reviews/:id', controller.deleteReview)
    .post('/reviews/:id/response', controller.createReviewResponse)
    .post('/reviews/:id/helpful', controller.voteReviewHelpful)
    .post('/reminders', controller.createReminder)
    .get('/reminders', controller.listReminders)
    .put('/reminders/:id', controller.updateReminder)
    .delete('/reminders/:id', controller.deleteReminder);
}
