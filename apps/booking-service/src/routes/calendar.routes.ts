import { Elysia } from 'elysia';
import { requireAuth, requireRole } from '@longeny/middleware';
import type { CalendarController } from '../controllers/calendar.controller.js';

export function createCalendarRoutes(controller: CalendarController): Elysia {
  const authRequired = requireAuth();
  const providerRequired = requireRole('provider');

  return new Elysia({ prefix: '/bookings/calendar' })
    .use(authRequired)
    .use(providerRequired)
    .get('/connect', controller.getConnectUrl)
    .get('/callback', controller.handleCallback)
    .delete('/disconnect', controller.disconnect)
    .get('/status', controller.getStatus);
}
