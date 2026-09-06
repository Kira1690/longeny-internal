import { Elysia } from 'elysia';
import type { BookingController } from '../controllers/booking.controller.js';
import type { CalendarController } from '../controllers/calendar.controller.js';
import type { InternalController } from '../controllers/internal.controller.js';
import type { NotificationController } from '../controllers/notification.controller.js';
import { createBookingRoutes } from './booking.routes.js';
import { createCalendarRoutes } from './calendar.routes.js';
import { createInternalRoutes } from './internal.routes.js';
import { createNotificationRoutes } from './notification.routes.js';

interface RouteControllers {
  bookingController: BookingController;
  calendarController: CalendarController;
  notificationController: NotificationController;
  internalController: InternalController;
  hmacSecret: string;
}

export function buildRoutes(controllers: RouteControllers) {
  return new Elysia()
    .use(createBookingRoutes(controllers.bookingController))
    .use(createCalendarRoutes(controllers.calendarController))
    .use(createNotificationRoutes(controllers.notificationController))
    .use(
      createInternalRoutes(
        controllers.internalController,
        controllers.bookingController,
        controllers.hmacSecret,
      ),
    );
}
