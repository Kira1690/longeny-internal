import Elysia from 'elysia';
import { verifyHmac } from '@longeny/middleware';
import {
  handleInternalVerify,
  handleInternalGetConsents,
  handleGdprExport,
  handleGdprDelete,
} from '../controllers/internal.controller.js';
import { config } from '../config/index.js';

const internalRoutes = new Elysia({ prefix: '/internal' })
  .use(verifyHmac(config.HMAC_SECRET))
  .get('/auth/verify', handleInternalVerify)
  .get('/auth/consents/:userId', handleInternalGetConsents)
  .get('/gdpr/user-data/:credentialId', handleGdprExport)
  .delete('/gdpr/user-data/:credentialId', handleGdprDelete);

export default internalRoutes;
