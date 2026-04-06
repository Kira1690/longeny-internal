import { Elysia } from 'elysia';
import { createBookingRoutes } from './booking.routes.js';
import { createCalendarRoutes } from './calendar.routes.js';
import { createNotificationRoutes } from './notification.routes.js';
import { createInternalRoutes } from './internal.routes.js';
import type { BookingController } from '../controllers/booking.controller.js';
import type { CalendarController } from '../controllers/calendar.controller.js';
import type { NotificationController } from '../controllers/notification.controller.js';
import type { InternalController } from '../controllers/internal.controller.js';

interface RouteControllers {
  bookingController: BookingController;
  calendarController: CalendarController;
  notificationController: NotificationController;
  internalController: InternalController;
  hmacSecret: string;
}

export function buildRoutes(controllers: RouteControllers): Elysia {
  return new Elysia()
    .use(createBookingRoutes(controllers.bookingController))
    .use(createCalendarRoutes(controllers.calendarController))
    .use(createNotificationRoutes(controllers.notificationController))
    .use(createInternalRoutes(controllers.internalController, controllers.hmacSecret));
}
