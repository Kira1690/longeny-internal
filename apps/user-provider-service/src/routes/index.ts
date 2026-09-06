import { Elysia } from 'elysia';
import type { AdminController } from '../controllers/admin.controller.js';
import type { InternalController } from '../controllers/internal.controller.js';
import type { MarketplaceController } from '../controllers/marketplace.controller.js';
import type { OnboardingController } from '../controllers/onboarding.controller.js';
import type { ProfileController } from '../controllers/profile.controller.js';
import type { ProgressController } from '../controllers/progress.controller.js';
import type { ProviderController } from '../controllers/provider.controller.js';
import type { UserController } from '../controllers/user.controller.js';
import type { ProfileService } from '../services/profile.service.js';
import { createAdminRoutes } from './admin.routes.js';
import { createInternalRoutes } from './internal.routes.js';
import { createMarketplaceRoutes } from './marketplace.routes.js';
import { createOnboardingRoutes } from './onboarding.routes.js';
import { createProfileRoutes } from './profile.routes.js';
import { createProgressRoutes } from './progress.routes.js';
import { createProviderRoutes } from './provider.routes.js';
import { createUserRoutes } from './user.routes.js';

interface Controllers {
  user: UserController;
  provider: ProviderController;
  marketplace: MarketplaceController;
  admin: AdminController;
  progress: ProgressController;
  internal: InternalController;
  onboarding: OnboardingController;
  profile: ProfileController;
  /** The service itself, for middleware that must re-check ownership. */
  profileService: ProfileService;
}

export function buildRoutes(controllers: Controllers) {
  return new Elysia()
    .use(createUserRoutes(controllers.user, controllers.profileService))
    .use(createProviderRoutes(controllers.provider))
    .use(createMarketplaceRoutes(controllers.marketplace))
    .use(createAdminRoutes(controllers.admin))
    .use(createProgressRoutes(controllers.progress, controllers.profileService))
    .use(createProfileRoutes(controllers.profile))
    .use(createInternalRoutes(controllers.internal, controllers.profile))
    .use(createOnboardingRoutes(controllers.onboarding));
}
