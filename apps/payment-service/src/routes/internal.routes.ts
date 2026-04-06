import { Elysia } from 'elysia';
import { verifyHmac } from '@longeny/middleware';
import { loadConfig, paymentConfigSchema } from '@longeny/config';
import * as internalController from '../controllers/internal.controller.js';

const config = loadConfig(paymentConfigSchema);

const internalRoutes = new Elysia({ prefix: '/internal' })
  .use(verifyHmac(config.HMAC_SECRET))
  .get('/gdpr/user-data/:userId', internalController.getUserPaymentData)
  .delete('/gdpr/user-data/:userId', internalController.anonymizeUserPaymentData);

export default internalRoutes;
