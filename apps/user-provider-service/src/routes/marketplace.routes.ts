import { Elysia } from 'elysia';
import { requireAuth } from '@longeny/middleware';
import type { MarketplaceController } from '../controllers/marketplace.controller.js';
import { savedItemSchema } from '../validators/index.js';

const bearer = { security: [{ BearerAuth: [] }] };

export function createMarketplaceRoutes(controller: MarketplaceController) {
  const authRequired = requireAuth();

  return new Elysia({ prefix: '/marketplace' })
    // Public endpoints
    .get('/search', controller.search, {
      detail: { tags: ['Marketplace'], summary: 'Search providers, programs and products' },
    })
    .get('/search/suggestions', controller.getSearchSuggestions, {
      detail: { tags: ['Marketplace'], summary: 'Get search autocomplete suggestions' },
    })
    .get('/featured', controller.getFeaturedListings, {
      detail: { tags: ['Marketplace'], summary: 'Get featured listings' },
    })
    .get('/trending', controller.getTrending, {
      detail: { tags: ['Marketplace'], summary: 'Get trending providers and programs' },
    })
    .get('/providers', controller.searchProviders, {
      detail: { tags: ['Marketplace'], summary: 'Search providers with filters' },
    })
    .get('/providers/:slug', controller.getProviderBySlug, {
      detail: { tags: ['Marketplace'], summary: 'Get provider by slug' },
    })
    .get('/programs', controller.searchPrograms, {
      detail: { tags: ['Marketplace'], summary: 'Search programs' },
    })
    .get('/programs/:id', controller.getProgramDetail, {
      detail: { tags: ['Marketplace'], summary: 'Get program detail' },
    })
    .get('/products', controller.searchProducts, {
      detail: { tags: ['Marketplace'], summary: 'Search products' },
    })
    .get('/products/:id', controller.getProductDetail, {
      detail: { tags: ['Marketplace'], summary: 'Get product detail' },
    })
    .get('/categories', controller.listCategories, {
      detail: { tags: ['Marketplace'], summary: 'List all categories' },
    })
    .get('/categories/:slug', controller.getCategoryBySlug, {
      detail: { tags: ['Marketplace'], summary: 'Get category by slug' },
    })
    .get('/facets', controller.getFacets, {
      detail: { tags: ['Marketplace'], summary: 'Get search facets (filters available)' },
    })
    // Auth-required endpoints
    .use(authRequired)
    .get('/recommendations', controller.getRecommendations, {
      detail: { tags: ['Marketplace'], summary: 'Get personalised recommendations', ...bearer },
    })
    .post('/saved', controller.saveItem, {
      body: savedItemSchema,
      detail: { tags: ['Marketplace'], summary: 'Save a provider, program or product', ...bearer },
    })
    .get('/saved', controller.listSavedItems, {
      detail: { tags: ['Marketplace'], summary: 'List saved items', ...bearer },
    })
    .delete('/saved/:id', controller.removeSavedItem, {
      detail: { tags: ['Marketplace'], summary: 'Remove saved item', ...bearer },
    });
}
