import { Elysia } from 'elysia';
import { requireAuth } from '@longeny/middleware';
import type { MarketplaceController } from '../controllers/marketplace.controller.js';
import { savedItemSchema } from '../validators/index.js';

export function createMarketplaceRoutes(controller: MarketplaceController) {
  const authRequired = requireAuth();

  return new Elysia({ prefix: '/marketplace' })
    // Public endpoints
    .get('/search', controller.search)
    .get('/search/suggestions', controller.getSearchSuggestions)
    .get('/featured', controller.getFeaturedListings)
    .get('/trending', controller.getTrending)
    .get('/providers', controller.searchProviders)
    .get('/providers/:slug', controller.getProviderBySlug)
    .get('/programs', controller.searchPrograms)
    .get('/programs/:id', controller.getProgramDetail)
    .get('/products', controller.searchProducts)
    .get('/products/:id', controller.getProductDetail)
    .get('/categories', controller.listCategories)
    .get('/categories/:slug', controller.getCategoryBySlug)
    .get('/facets', controller.getFacets)
    // Auth-required endpoints
    .use(authRequired)
    .get('/recommendations', controller.getRecommendations)
    .post('/saved', controller.saveItem, { body: savedItemSchema })
    .get('/saved', controller.listSavedItems)
    .delete('/saved/:id', controller.removeSavedItem);
}
