import { Elysia } from 'elysia';
import Redis from 'ioredis';
import { EventPublisher } from '@longeny/events';
import { errorHandler, requestLogger, corsMiddleware } from '@longeny/middleware';
import { loadConfig, bookingConfigSchema } from '@longeny/config';

// Services
import { BookingService } from './services/booking.service.js';
import { CalendarService } from './services/calendar.service.js';
import { NotificationService } from './services/notification.service.js';
import { ReminderService } from './services/reminder.service.js';

// Controllers
import { BookingController } from './controllers/booking.controller.js';
import { CalendarController } from './controllers/calendar.controller.js';
import { NotificationController } from './controllers/notification.controller.js';
import { InternalController } from './controllers/internal.controller.js';

// Routes
import { buildRoutes } from './routes/index.js';

export function createApp() {
  // ── Load Config ──
  const config = loadConfig(bookingConfigSchema);

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
  const notificationService = new NotificationService(null, config);
  const reminderService = new ReminderService(null, publisher, notificationService);

  // ── Controllers ──
  const bookingController = new BookingController(bookingService);
  const calendarController = new CalendarController(calendarService);
  const notificationController = new NotificationController(notificationService);
  const internalController = new InternalController(bookingService, notificationService);

  // ── Elysia app ──
  const app = new Elysia()
    .use(errorHandler())
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
    .use(buildRoutes({
      bookingController,
      calendarController,
      notificationController,
      internalController,
      hmacSecret: config.HMAC_SECRET,
    }));

  return { app, config, redis, publisher, reminderService, bookingService, notificationService };
}
