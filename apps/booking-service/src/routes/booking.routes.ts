import { Elysia } from 'elysia';
import { requireAuth, requireRole } from '@longeny/middleware';
import type { BookingController } from '../controllers/booking.controller.js';

export function createBookingRoutes(controller: BookingController): Elysia {
  const authRequired = requireAuth();
  const providerRequired = requireRole('provider');

  // Auth-required section (all users)
  const authRoutes = new Elysia()
    .use(authRequired)
    .get('/providers/:id/slots', controller.getAvailableSlots)
    .post('/', controller.createBooking)
    .get('/', controller.listUserBookings)
    .get('/:id', controller.getBooking)
    .put('/:id', controller.updateBooking)
    .patch('/:id/cancel', controller.cancelBooking)
    .patch('/:id/reschedule', controller.rescheduleBooking);

  // Provider-only section
  const providerRoutes = new Elysia()
    .use(authRequired)
    .use(providerRequired)
    .get('/provider', controller.listProviderBookings)
    .get('/provider/upcoming', controller.listProviderUpcomingBookings)
    .patch('/:id/confirm', controller.confirmBooking)
    .patch('/:id/complete', controller.completeBooking)
    .patch('/:id/no-show', controller.markNoShow);

  return new Elysia({ prefix: '/bookings' })
    .use(authRoutes)
    .use(providerRoutes);
}
