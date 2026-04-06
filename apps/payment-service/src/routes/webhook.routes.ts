import { Elysia } from 'elysia';
import * as webhookController from '../controllers/webhook.controller.js';

// NO auth middleware on webhook routes
// Raw body access: handlers use request.text() for signature verification
const webhookRoutes = new Elysia({ prefix: '/payments/webhooks' })
  .post('/stripe', webhookController.stripeWebhook)
  .post('/razorpay', webhookController.razorpayWebhook);

export default webhookRoutes;
