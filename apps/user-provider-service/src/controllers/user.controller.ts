import type { UserService } from '../services/user.service.js';
import type { EventPublisher } from '@longeny/events';
import { EVENT_NAMES } from '@longeny/types';

export class UserController {
  constructor(
    private userService: UserService,
    private publisher: EventPublisher,
  ) {}

  getProfile = async ({ store, set }: any) => {
    const user = await this.userService.getProfile(store.userId);
    return { success: true, data: user };
  };

  updateProfile = async ({ body, store, set }: any) => {
    const user = await this.userService.updateProfile(store.userId, body);
    await this.publisher.publish(EVENT_NAMES.USER_UPDATED, { authId: store.userId, changes: Object.keys(body) });
    return { success: true, data: user };
  };

  deleteAccount = async ({ store, set }: any) => {
    const result = await this.userService.softDelete(store.userId);
    await this.publisher.publish(EVENT_NAMES.USER_DEACTIVATED, { authId: store.userId, userId: result.id });
    return { success: true, data: result };
  };

  getAvatarUploadUrl = async ({ store }: any) => {
    const result = await this.userService.getAvatarUploadUrl(store.userId);
    return { success: true, data: result };
  };

  getHealthProfile = async ({ store }: any) => {
    const profile = await this.userService.getHealthProfile(store.userId);
    return { success: true, data: profile };
  };

  updateHealthProfile = async ({ body, store }: any) => {
    const profile = await this.userService.updateHealthProfile(store.userId, body);
    return { success: true, data: profile };
  };

  getPreferences = async ({ store }: any) => {
    const preferences = await this.userService.getPreferences(store.userId);
    return { success: true, data: preferences };
  };

  updatePreferences = async ({ body, store }: any) => {
    const preferences = await this.userService.updatePreferences(store.userId, body);
    return { success: true, data: preferences };
  };

  saveOnboardingStep = async ({ body, store }: any) => {
    const state = await this.userService.saveOnboardingStep(store.userId, body.step, body.data);
    return { success: true, data: state };
  };

  getOnboardingState = async ({ store }: any) => {
    const state = await this.userService.getOnboardingState(store.userId);
    return { success: true, data: state };
  };

  getConsents = async ({ store }: any) => {
    const consents = await this.userService.getConsents(store.userId);
    return { success: true, data: consents };
  };

  requestDataExport = async ({ store }: any) => {
    const exportRequest = await this.userService.requestDataExport(store.userId, 'dsar');
    return { success: true, data: exportRequest };
  };

  requestGdprErasure = async ({ store, set }: any) => {
    const request = await this.userService.requestGdprErasure(store.userId);
    await this.publisher.publish(EVENT_NAMES.GDPR_ERASURE_REQUESTED, { authId: store.userId, requestId: request.id });
    set.status = 201;
    return { success: true, data: request };
  };

  getGdprErasureStatus = async ({ store }: any) => {
    const status = await this.userService.getGdprErasureStatus(store.userId);
    return { success: true, data: status };
  };

  cancelGdprErasure = async ({ store }: any) => {
    const result = await this.userService.cancelGdprErasure(store.userId);
    return { success: true, data: result };
  };

  getPortableExport = async ({ store, query, set }: any) => {
    const format = (query.format === 'csv' ? 'csv' : 'json') as 'json' | 'csv';
    const exportData = await this.userService.getPortableExport(store.userId, format);
    await this.userService.requestDataExport(store.userId, 'portable').catch(() => {});
    return { success: true, data: exportData };
  };

  completeOnboarding = async ({ store }: any) => {
    const state = await this.userService.completeOnboarding(store.userId);
    await this.publisher.publish(EVENT_NAMES.USER_UPDATED, { authId: store.userId, changes: ['onboarding_completed'] });
    return { success: true, data: state };
  };

  getUserById = async ({ params }: any) => {
    const user = await this.userService.getUserByIdPublic(params.id);
    return { success: true, data: user };
  };

  listUsers = async ({ query }: any) => {
    const result = await this.userService.listUsers({
      search: query.search,
      status: query.status,
      page: query.page ? Number(query.page) : 1,
      limit: query.limit ? Number(query.limit) : 20,
    });
    return { success: true, ...result };
  };
}
