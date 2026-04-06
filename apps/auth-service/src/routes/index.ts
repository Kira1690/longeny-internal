import Elysia from 'elysia';
import authRoutes from './auth.routes.js';
import rbacRoutes from './rbac.routes.js';
import internalRoutes from './internal.routes.js';

const routes = new Elysia()
  .use(authRoutes)
  .use(rbacRoutes)
  .use(internalRoutes);

export default routes;
