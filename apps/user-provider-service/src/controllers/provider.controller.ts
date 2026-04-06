import type { ProviderService } from '../services/provider.service.js';
import type { EventPublisher } from '@longeny/events';
import { EVENT_NAMES } from '@longeny/types';

export class ProviderController {
  constructor(
    private providerService: ProviderService,
    private publisher: EventPublisher,
  ) {}

  register = async ({ body, store, set }: any) => {
    const provider = await this.providerService.register(store.userId, body);
    await this.publisher.publish(EVENT_NAMES.PROVIDER_REGISTERED, {
      providerId: provider.id,
      authId: store.userId,
      businessName: provider.business_name,
    });
    set.status = 201;
    return { success: true, data: provider };
  };

  getOwnProfile = async ({ store }: any) => {
    const provider = await this.providerService.getOwnProfile(store.userId);
    return { success: true, data: provider };
  };

  updateProfile = async ({ body, store }: any) => {
    const provider = await this.providerService.updateProfile(store.userId, body);
    await this.publisher.publish(EVENT_NAMES.PROVIDER_UPDATED, {
      providerId: provider.id,
      changes: Object.keys(body),
    });
    return { success: true, data: provider };
  };

  submitVerification = async ({ body, store, set }: any) => {
    const verification = await this.providerService.submitVerification(store.userId, body);
    set.status = 201;
    return { success: true, data: verification };
  };

  getAvailability = async ({ store }: any) => {
    const availability = await this.providerService.getAvailability(store.userId);
    return { success: true, data: availability };
  };

  setAvailability = async ({ body, store }: any) => {
    const availability = await this.providerService.setAvailability(store.userId, body.rules || body);
    return { success: true, data: availability };
  };

  addAvailabilityOverride = async ({ body, store, set }: any) => {
    const override = await this.providerService.addAvailabilityOverride(store.userId, body);
    set.status = 201;
    return { success: true, data: override };
  };

  removeAvailabilityOverride = async ({ store, params }: any) => {
    const result = await this.providerService.removeAvailabilityOverride(store.userId, params.id);
    return { success: true, data: result };
  };

  getPublicProfile = async ({ params }: any) => {
    const provider = await this.providerService.getPublicProfile(params.id);
    return { success: true, data: provider };
  };

  getSlots = async ({ params, query }: any) => {
    const slots = await this.providerService.getAvailableSlots(
      params.id,
      query.date,
      query.timezone || 'America/New_York',
    );
    return { success: true, data: slots };
  };

  createProgram = async ({ body, store, set }: any) => {
    const program = await this.providerService.createProgram(store.userId, body);
    await this.publisher.publish(EVENT_NAMES.PROVIDER_PROGRAM_CREATED, {
      programId: program.id,
      providerId: program.provider_id,
      title: program.title,
    });
    set.status = 201;
    return { success: true, data: program };
  };

  updateProgram = async ({ body, store, params }: any) => {
    const program = await this.providerService.updateProgram(store.userId, params.id, body);
    await this.publisher.publish(EVENT_NAMES.PROVIDER_PROGRAM_UPDATED, {
      programId: program.id,
      providerId: program.provider_id,
      changes: Object.keys(body),
    });
    return { success: true, data: program };
  };

  deleteProgram = async ({ store, params }: any) => {
    const result = await this.providerService.deleteProgram(store.userId, params.id);
    return { success: true, data: result };
  };

  createProduct = async ({ body, store, set }: any) => {
    const product = await this.providerService.createProduct(store.userId, body);
    await this.publisher.publish(EVENT_NAMES.PROVIDER_PRODUCT_CREATED, {
      productId: product.id,
      providerId: product.provider_id,
      title: product.title,
    });
    set.status = 201;
    return { success: true, data: product };
  };

  updateProduct = async ({ body, store, params }: any) => {
    const product = await this.providerService.updateProduct(store.userId, params.id, body);
    return { success: true, data: product };
  };

  listProviders = async ({ query }: any) => {
    const result = await this.providerService.listProviders({
      category: query.category,
      city: query.city,
      state: query.state,
      offersVirtual: query.offersVirtual ? query.offersVirtual === 'true' : undefined,
      offersInPerson: query.offersInPerson ? query.offersInPerson === 'true' : undefined,
      minRating: query.minRating ? Number(query.minRating) : undefined,
      search: query.search,
      page: query.page ? Number(query.page) : 1,
      limit: query.limit ? Number(query.limit) : 20,
    });
    return { success: true, ...result };
  };

  getOwnPrograms = async ({ store, query }: any) => {
    const result = await this.providerService.getOwnPrograms(store.userId, {
      status: query.status,
      page: query.page ? Number(query.page) : 1,
      limit: query.limit ? Number(query.limit) : 20,
    });
    return { success: true, ...result };
  };

  getProviderPrograms = async ({ params, query }: any) => {
    const result = await this.providerService.getProviderPrograms(params.id, {
      page: query.page ? Number(query.page) : 1,
      limit: query.limit ? Number(query.limit) : 20,
    });
    return { success: true, ...result };
  };

  getOwnProducts = async ({ store, query }: any) => {
    const result = await this.providerService.getOwnProducts(store.userId, {
      status: query.status,
      page: query.page ? Number(query.page) : 1,
      limit: query.limit ? Number(query.limit) : 20,
    });
    return { success: true, ...result };
  };

  deleteProduct = async ({ store, params }: any) => {
    const result = await this.providerService.deleteProduct(store.userId, params.id);
    return { success: true, data: result };
  };

  getProviderProducts = async ({ params, query }: any) => {
    const result = await this.providerService.getProviderProducts(params.id, {
      page: query.page ? Number(query.page) : 1,
      limit: query.limit ? Number(query.limit) : 20,
    });
    return { success: true, ...result };
  };

  getPublicAvailability = async ({ params }: any) => {
    const availability = await this.providerService.getPublicAvailability(params.id);
    return { success: true, data: availability };
  };

  getProviderStats = async ({ store }: any) => {
    const stats = await this.providerService.getProviderStats(store.userId);
    return { success: true, data: stats };
  };

  listCategories = async () => {
    const cats = await this.providerService.listCategories();
    return { success: true, data: cats };
  };
}
