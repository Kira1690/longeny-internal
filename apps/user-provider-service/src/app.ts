import { Elysia } from 'elysia';
import { EventPublisher } from '@longeny/events';
import { errorHandler, requestLogger, corsMiddleware } from '@longeny/middleware';
import { config, redisUrl } from './config/index.js';

// Services
import { UserService } from './services/user.service.js';
import { ProviderService } from './services/provider.service.js';
import { MarketplaceService } from './services/marketplace.service.js';
import { AdminService } from './services/admin.service.js';
import { ProgressService } from './services/progress.service.js';

// Controllers
import { UserController } from './controllers/user.controller.js';
import { ProviderController } from './controllers/provider.controller.js';
import { MarketplaceController } from './controllers/marketplace.controller.js';
import { AdminController } from './controllers/admin.controller.js';
import { ProgressController } from './controllers/progress.controller.js';
import { InternalController } from './controllers/internal.controller.js';

// Routes
import { buildRoutes } from './routes/index.js';

export function createApp() {
  // ── Infrastructure ──
  const publisher = new EventPublisher(redisUrl, 'user-provider-service');

  // ── Services (no PrismaClient — Drizzle db is module-level) ──
  const userService = new UserService(null, config.ENCRYPTION_KEY);
  const providerService = new ProviderService(null);
  const marketplaceService = new MarketplaceService(null);
  const adminService = new AdminService(null);
  const progressService = new ProgressService(null);

  // ── Controllers ──
  const userController = new UserController(userService, publisher);
  const providerController = new ProviderController(providerService, publisher);
  const marketplaceController = new MarketplaceController(marketplaceService);
  const adminController = new AdminController(adminService);
  const progressController = new ProgressController(progressService);
  const internalController = new InternalController(userService, providerService);

  // ── Elysia app ──
  const app = new Elysia()
    .use(errorHandler())
    .use(requestLogger('user-provider-service'))
    .use(corsMiddleware(config.CORS_ORIGIN.split(',')))
    .get('/health', () => ({
      status: 'healthy',
      service: 'user-provider-service',
      timestamp: new Date().toISOString(),
    }))
    .use(buildRoutes({
      user: userController,
      provider: providerController,
      marketplace: marketplaceController,
      admin: adminController,
      progress: progressController,
      internal: internalController,
    }));

  return { app, publisher, userService };
}
