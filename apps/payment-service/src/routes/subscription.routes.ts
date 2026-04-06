import { Elysia } from 'elysia';
import { requireAuth } from '@longeny/middleware';
import * as subscriptionController from '../controllers/subscription.controller.js';

const subscriptionRoutes = new Elysia({ prefix: '/payments/subscriptions' })
  .use(requireAuth())
  .post('/', subscriptionController.createSubscription)
  .get('/', subscriptionController.listSubscriptions)
  .get('/:id', subscriptionController.getSubscriptionDetail)
  .put('/:id', subscriptionController.updateSubscription)
  .patch('/:id/cancel', subscriptionController.cancelSubscription);

export default subscriptionRoutes;
