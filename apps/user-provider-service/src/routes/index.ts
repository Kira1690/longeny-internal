import { Elysia } from 'elysia';
import { createUserRoutes } from './user.routes.js';
import { createProviderRoutes } from './provider.routes.js';
import { createMarketplaceRoutes } from './marketplace.routes.js';
import { createAdminRoutes } from './admin.routes.js';
import { createProgressRoutes } from './progress.routes.js';
import { createInternalRoutes } from './internal.routes.js';
import type { UserController } from '../controllers/user.controller.js';
import type { ProviderController } from '../controllers/provider.controller.js';
import type { MarketplaceController } from '../controllers/marketplace.controller.js';
import type { AdminController } from '../controllers/admin.controller.js';
import type { ProgressController } from '../controllers/progress.controller.js';
import type { InternalController } from '../controllers/internal.controller.js';

interface Controllers {
  user: UserController;
  provider: ProviderController;
  marketplace: MarketplaceController;
  admin: AdminController;
  progress: ProgressController;
  internal: InternalController;
}

export function buildRoutes(controllers: Controllers) {
  return new Elysia()
    .use(createUserRoutes(controllers.user))
    .use(createProviderRoutes(controllers.provider))
    .use(createMarketplaceRoutes(controllers.marketplace))
    .use(createAdminRoutes(controllers.admin))
    .use(createProgressRoutes(controllers.progress))
    .use(createInternalRoutes(controllers.internal));
}
