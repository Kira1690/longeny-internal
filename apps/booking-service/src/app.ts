import { swagger } from '@elysiajs/swagger';
import { EventPublisher } from '@longeny/events';
import { corsMiddleware, errorHandler, requestContext, requestLogger } from '@longeny/middleware';
import { Elysia } from 'elysia';
import Redis from 'ioredis';
import { config } from './config/index.js';

// Services
import { BookingService } from './services/booking.service.js';
import { CalendarService } from './services/calendar.service.js';
import { InviteService } from './services/invite.service.js';
import { NotificationService } from './services/notification.service.js';
import { ReminderService } from './services/reminder.service.js';

// Controllers
import { BookingController } from './controllers/booking.controller.js';
import { CalendarController } from './controllers/calendar.controller.js';
import { InternalController } from './controllers/internal.controller.js';
import { NotificationController } from './controllers/notification.controller.js';

// Routes
import { buildRoutes } from './routes/index.js';

export function createApp() {
  // ── Load Config ──

  // ── Redis ──
  const redisUrl = `redis://${config.REDIS_PASSWORD ? `:${config.REDIS_PASSWORD}@` : ''}${config.REDIS_HOST}:${config.REDIS_PORT}`;

  const redis = new Redis(redisUrl, {
    maxRetriesPerRequest: 3,
    lazyConnect: true,
  });

  // ── Event Infrastructure ──
  const publisher = new EventPublisher(redisUrl, 'booking-service');

  // ── Services (no PrismaClient — Drizzle db is module-level) ──
  const bookingService = new BookingService(null, redis, publisher, config);
  const calendarService = new CalendarService(null, config);
  const inviteService = new InviteService();
  const notificationService = new NotificationService(null, config);
  const reminderService = new ReminderService(null, publisher, notificationService);

  // ── Controllers ──
  const bookingController = new BookingController(bookingService);
  const calendarController = new CalendarController(calendarService, inviteService);
  const notificationController = new NotificationController(notificationService);
  const internalController = new InternalController(bookingService, notificationService);

  // ── Elysia app ──
  const app = new Elysia()
    // ── Swagger UI at /docs, machine-readable spec at /docs/json ──
    .use(
      swagger({
        path: '/docs',
        documentation: {
          info: {
            title: 'LONGENY Booking Service API',
            version: '1.0.0',
            description:
              'Session booking, provider availability, Google Calendar sync and notifications.' +
              '\n\n' +
              '**Auth.** Every route outside `/internal/*` needs a Bearer access token from the ' +
              'Auth service, plus the permission named in each operation. A valid token that ' +
              'lacks the permission gets `403 FORBIDDEN` with a message naming what is missing; ' +
              'a route restricted to a role answers `403 FORBIDDEN` naming the roles.\n\n' +
              '**Ownership.** A booking or notification that belongs to somebody else answers ' +
              'exactly like one that does not exist — `404 NOT_FOUND` — so never infer that an ' +
              'id is real from the response.\n\n' +
              '**Times** are ISO-8601 UTC instants (`2026-09-01T10:00:00Z`). `timezone` is an ' +
              'IANA zone name and only affects how slots and reminders are rendered.',
          },
          tags: [
            {
              name: 'Bookings',
              description: 'Slot lookup and the booking lifecycle for the person booking',
            },
            {
              name: 'Provider Bookings',
              description:
                'Provider-only views and lifecycle actions — confirm, complete, mark no-show',
            },
            {
              name: 'Calendar',
              description: 'Provider Google Calendar connection (OAuth) and sync status',
            },
            {
              name: 'Notifications',
              description: 'In-app notifications, push tokens, preferences',
            },
            {
              name: 'Notification Admin',
              description: 'Admin-only sending, broadcasting and template management',
            },
            {
              name: 'Internal',
              description:
                'Service-to-service endpoints (HMAC-signed) — not reachable from the browser',
            },
          ],
          components: {
            securitySchemes: {
              BearerAuth: {
                type: 'http',
                scheme: 'bearer',
                bearerFormat: 'JWT',
              },
            },
          },
        },
      }),
    )
    .use(errorHandler())
    .use(requestContext())
    .use(requestLogger('booking-service'))
    .use(corsMiddleware(config.CORS_ORIGIN.split(',')))
    .get('/health', () => ({
      success: true,
      data: {
        status: 'healthy',
        service: 'booking-service',
        version: '0.0.1',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
      },
    }))
    .use(
      buildRoutes({
        bookingController,
        calendarController,
        notificationController,
        internalController,
        hmacSecret: config.HMAC_SECRET,
      }),
    );

  return { app, config, redis, publisher, reminderService, bookingService, notificationService };
}
