import { Elysia } from 'elysia';
import { requireAuth, requireRole } from '@longeny/middleware';
import type { AdminController } from '../controllers/admin.controller.js';
import {
  adminProviderStatusSchema,
  adminUserStatusSchema,
  adminProgramStatusSchema,
  adminModerationSchema,
  adminVerifyProviderSchema,
} from '../validators/index.js';

export function createAdminRoutes(controller: AdminController) {
  return new Elysia({ prefix: '/admin' })
    .use(requireAuth())
    .use(requireRole('admin'))
    .get('/dashboard', controller.getDashboardOverview)
    .get('/providers/pending', controller.getPendingProviders)
    .get('/providers', controller.listProviders)
    .patch('/providers/:id/status', controller.updateProviderStatus, { body: adminProviderStatusSchema })
    .post('/providers/:id/verify', controller.verifyProvider, { body: adminVerifyProviderSchema })
    .put('/providers/:id/suspend', controller.suspendProvider)
    .get('/users', controller.listUsers)
    .get('/users/:id', controller.getUserDetail)
    .patch('/users/:id/status', controller.updateUserStatus, { body: adminUserStatusSchema })
    .get('/programs', controller.listPrograms)
    .patch('/programs/:id/status', controller.updateProgramStatus, { body: adminProgramStatusSchema })
    .get('/moderation', controller.getModerationQueue)
    .patch('/moderation/:id', controller.moderateItem, { body: adminModerationSchema })
    .get('/analytics/overview', controller.getAnalyticsOverview)
    .get('/analytics/users', controller.getUserAnalytics)
    .get('/analytics/revenue', controller.getRevenueAnalytics)
    .get('/analytics/bookings', controller.getBookingAnalytics)
    .get('/analytics/ai', controller.getAiAnalytics)
    .get('/analytics/providers', controller.getProviderAnalytics)
    .get('/settings', controller.getSettings)
    .put('/settings', controller.updateSettings)
    .post('/reports/export', controller.exportReport)
    .get('/content-flags', controller.listContentFlags)
    .put('/content-flags/:id', controller.resolveContentFlag)
    .get('/audit-logs', controller.getAuditLogs);
}
