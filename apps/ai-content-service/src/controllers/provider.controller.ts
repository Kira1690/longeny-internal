import { AppError } from '@longeny/errors';
import { ProviderProfileService, type ProviderProfileInput } from '../services/provider-profile.service.js';

export class ProviderController {
  constructor(private readonly profileSvc: ProviderProfileService) {}

  async upsert({ body, store }: { body: ProviderProfileInput; store: { userId: string } }) {
    const result = await this.profileSvc.upsert(store.userId, body);
    return { success: true, data: result };
  }

  async get({ params }: { params: { id: string } }) {
    const profile = await this.profileSvc.get(params.id);
    if (!profile) {
      throw new AppError('Provider profile not found', 404, 'NOT_FOUND');
    }
    return { success: true, data: profile };
  }

  async list({ query }: { query: { specialty?: string; city?: string; mode?: string } }) {
    const profiles = await this.profileSvc.list(query);
    return { success: true, data: profiles };
  }

  async deactivate({ params }: { params: { id: string } }) {
    await this.profileSvc.deactivate(params.id);
    return { success: true, data: { deactivated: true } };
  }
}
