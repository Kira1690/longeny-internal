import { Elysia } from 'elysia';
import { requireAuth } from '@longeny/middleware';
import * as providerController from '../controllers/provider.controller.js';

const providerRoutes = new Elysia({ prefix: '/payments/provider' })
  .use(requireAuth())
  .get('/me/earnings', providerController.getProviderEarnings)
  .get('/me/payouts', providerController.getProviderPayouts);

export default providerRoutes;
