import type { BookingService } from '../services/booking.service.js';
import { parsePaginationParams, buildPaginationMeta } from '@longeny/utils';

export class BookingController {
  constructor(private bookingService: BookingService) {}

  // GET /bookings/providers/:id/slots
  getAvailableSlots = async ({ query, params }: any) => {
    const providerId = params.id;
    const date = query.date;
    const timezone = query.timezone || 'UTC';

    if (!date) {
      return {
        success: false,
        error: { code: 'BAD_REQUEST', message: 'date query parameter is required' },
      };
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return {
        success: false,
        error: { code: 'BAD_REQUEST', message: 'date must be in YYYY-MM-DD format' },
      };
    }

    const slots = await this.bookingService.getAvailableSlots(providerId, date, timezone);

    return {
      success: true,
      data: slots,
      meta: { timestamp: new Date().toISOString() },
    };
  };

  // POST /bookings
  createBooking = async ({ body, store, set }: any) => {
    const booking = await this.bookingService.createBooking({
      userId: store.userId,
      providerId: body.providerId,
      programId: body.programId,
      sessionType: body.sessionType,
      startTime: body.startTime,
      endTime: body.endTime,
      notes: body.notes,
      timezone: body.timezone,
    });

    set.status = 201;
    return {
      success: true,
      data: booking,
      message: 'Booking created successfully',
      meta: { timestamp: new Date().toISOString() },
    };
  };

  // GET /bookings
  listUserBookings = async ({ store, query }: any) => {
    const { page, limit } = parsePaginationParams(query);

    const { bookings, total } = await this.bookingService.listUserBookings(store.userId, {
      status: query.status,
      timeframe: query.timeframe,
      page,
      limit,
    });

    return {
      success: true,
      data: bookings,
      pagination: buildPaginationMeta(total, page, limit),
      meta: { timestamp: new Date().toISOString() },
    };
  };

  // GET /bookings/provider
  listProviderBookings = async ({ store, query }: any) => {
    const { page, limit } = parsePaginationParams(query);

    const { bookings, total } = await this.bookingService.listProviderBookings(store.userId, {
      status: query.status,
      date: query.date,
      page,
      limit,
    });

    return {
      success: true,
      data: bookings,
      pagination: buildPaginationMeta(total, page, limit),
      meta: { timestamp: new Date().toISOString() },
    };
  };

  // GET /bookings/:id
  getBooking = async ({ params, store }: any) => {
    const booking = await this.bookingService.getBooking(params.id, store.userId);

    return {
      success: true,
      data: booking,
      meta: { timestamp: new Date().toISOString() },
    };
  };

  // PUT /bookings/:id
  updateBooking = async ({ params, store, body }: any) => {
    const booking = await this.bookingService.updateBooking(params.id, store.userId, body);

    return {
      success: true,
      data: booking,
      message: 'Booking updated',
      meta: { timestamp: new Date().toISOString() },
    };
  };

  // GET /bookings/provider/upcoming
  listProviderUpcomingBookings = async ({ store, query }: any) => {
    const { page, limit } = parsePaginationParams(query);

    const { bookings, total } = await this.bookingService.listProviderUpcomingBookings(store.userId, {
      page,
      limit,
    });

    return {
      success: true,
      data: bookings,
      pagination: buildPaginationMeta(total, page, limit),
      meta: { timestamp: new Date().toISOString() },
    };
  };

  // PATCH /bookings/:id/confirm
  confirmBooking = async ({ params, store }: any) => {
    const booking = await this.bookingService.confirmBooking(params.id, store.userId);

    return {
      success: true,
      data: booking,
      message: 'Booking confirmed',
      meta: { timestamp: new Date().toISOString() },
    };
  };

  // PATCH /bookings/:id/cancel
  cancelBooking = async ({ params, store, body }: any) => {
    const booking = await this.bookingService.cancelBooking(
      params.id,
      store.userId,
      store.userRole,
      body?.reason,
    );

    return {
      success: true,
      data: booking,
      message: 'Booking cancelled',
      meta: { timestamp: new Date().toISOString() },
    };
  };

  // PATCH /bookings/:id/reschedule
  rescheduleBooking = async ({ params, store, body }: any) => {
    const booking = await this.bookingService.rescheduleBooking(
      params.id,
      store.userId,
      body.newStartTime,
      body.newEndTime,
      body.reason,
    );

    return {
      success: true,
      data: booking,
      message: 'Booking rescheduled',
      meta: { timestamp: new Date().toISOString() },
    };
  };

  // PATCH /bookings/:id/complete
  completeBooking = async ({ params, store }: any) => {
    const booking = await this.bookingService.completeBooking(params.id, store.userId);

    return {
      success: true,
      data: booking,
      message: 'Booking completed',
      meta: { timestamp: new Date().toISOString() },
    };
  };

  // PATCH /bookings/:id/no-show
  markNoShow = async ({ params, store }: any) => {
    const booking = await this.bookingService.markNoShow(params.id, store.userId);

    return {
      success: true,
      data: booking,
      message: 'Booking marked as no-show',
      meta: { timestamp: new Date().toISOString() },
    };
  };
}
