import type { MarketplaceService } from '../services/marketplace.service.js';

export class MarketplaceController {
  constructor(private marketplaceService: MarketplaceService) {}

  search = async ({ query }: any) => {
    const results = await this.marketplaceService.search({
      q: query.q,
      category: query.category,
      subcategory: query.subcategory,
      entityType: query.entityType as any,
      minPrice: query.minPrice ? Number(query.minPrice) : undefined,
      maxPrice: query.maxPrice ? Number(query.maxPrice) : undefined,
      offersVirtual: query.offersVirtual ? query.offersVirtual === 'true' : undefined,
      offersInPerson: query.offersInPerson ? query.offersInPerson === 'true' : undefined,
      city: query.city,
      state: query.state,
      minRating: query.minRating ? Number(query.minRating) : undefined,
      sortBy: query.sortBy || 'relevance',
      page: query.page ? Number(query.page) : 1,
      limit: query.limit ? Number(query.limit) : 20,
    });
    return { success: true, ...results };
  };

  searchProviders = async ({ query }: any) => {
    const results = await this.marketplaceService.searchProviders({
      q: query.q,
      category: query.category,
      minPrice: query.minPrice ? Number(query.minPrice) : undefined,
      maxPrice: query.maxPrice ? Number(query.maxPrice) : undefined,
      offersVirtual: query.offersVirtual ? query.offersVirtual === 'true' : undefined,
      offersInPerson: query.offersInPerson ? query.offersInPerson === 'true' : undefined,
      city: query.city,
      state: query.state,
      minRating: query.minRating ? Number(query.minRating) : undefined,
      sortBy: query.sortBy || 'relevance',
      page: query.page ? Number(query.page) : 1,
      limit: query.limit ? Number(query.limit) : 20,
    });
    return { success: true, ...results };
  };

  getProviderBySlug = async ({ params }: any) => {
    const provider = await this.marketplaceService.getProviderBySlug(params.slug);
    return { success: true, data: provider };
  };

  searchPrograms = async ({ query }: any) => {
    const results = await this.marketplaceService.searchPrograms({
      q: query.q,
      category: query.category,
      subcategory: query.subcategory,
      minPrice: query.minPrice ? Number(query.minPrice) : undefined,
      maxPrice: query.maxPrice ? Number(query.maxPrice) : undefined,
      sortBy: query.sortBy || 'relevance',
      page: query.page ? Number(query.page) : 1,
      limit: query.limit ? Number(query.limit) : 20,
    });
    return { success: true, ...results };
  };

  getProgramDetail = async ({ params }: any) => {
    const program = await this.marketplaceService.getProgramDetail(params.id);
    return { success: true, data: program };
  };

  searchProducts = async ({ query }: any) => {
    const results = await this.marketplaceService.searchProducts({
      q: query.q,
      category: query.category,
      minPrice: query.minPrice ? Number(query.minPrice) : undefined,
      maxPrice: query.maxPrice ? Number(query.maxPrice) : undefined,
      sortBy: query.sortBy || 'relevance',
      page: query.page ? Number(query.page) : 1,
      limit: query.limit ? Number(query.limit) : 20,
    });
    return { success: true, ...results };
  };

  getProductDetail = async ({ params }: any) => {
    const product = await this.marketplaceService.getProductDetail(params.id);
    return { success: true, data: product };
  };

  listCategories = async () => {
    const cats = await this.marketplaceService.listCategories();
    return { success: true, data: cats };
  };

  getFacets = async ({ query }: any) => {
    const facets = await this.marketplaceService.getFacets({
      entityType: query.entityType,
      category: query.category,
    });
    return { success: true, data: facets };
  };

  saveItem = async ({ body, store, set }: any) => {
    const item = await this.marketplaceService.saveItem(store.userId, body.entityType, body.entityId);
    set.status = 201;
    return { success: true, data: item };
  };

  listSavedItems = async ({ store, query }: any) => {
    const items = await this.marketplaceService.listSavedItems(
      store.userId,
      query.page ? Number(query.page) : 1,
      query.limit ? Number(query.limit) : 20,
    );
    return { success: true, ...items };
  };

  removeSavedItem = async ({ store, params }: any) => {
    const result = await this.marketplaceService.removeSavedItem(store.userId, params.id);
    return { success: true, data: result };
  };

  getCategoryBySlug = async ({ params }: any) => {
    const result = await this.marketplaceService.getCategoryBySlug(params.slug);
    return { success: true, data: result };
  };

  getFeaturedListings = async () => {
    const result = await this.marketplaceService.getFeaturedListings();
    return { success: true, data: result };
  };

  getTrending = async ({ query }: any) => {
    const limit = query.limit ? Number(query.limit) : 20;
    const result = await this.marketplaceService.getTrending(limit);
    return { success: true, data: result };
  };

  getRecommendations = async ({ store }: any) => {
    const result = await this.marketplaceService.getRecommendations(store.userId);
    return { success: true, data: result };
  };

  getSearchSuggestions = async ({ query }: any) => {
    const result = await this.marketplaceService.getSearchSuggestions(
      query.q || '',
      query.limit ? Number(query.limit) : 10,
    );
    return { success: true, data: result };
  };
}
