import { errorEnvelope } from '@longeny/errors';
import type { EventPublisher } from '@longeny/events';
import type { OnboardingService } from '../services/onboarding.service.js';
import type { SectionKey } from '../validators/onboarding.validators.js';

export class OnboardingController {
  constructor(
    private onboardingService: OnboardingService,
    private publisher: EventPublisher,
  ) {}

  initOnboarding = async ({ store, set }: any) => {
    const result = await this.onboardingService.init(store.userId);
    set.status = 201;
    return { success: true, data: result };
  };

  getOnboarding = async ({ store }: any) => {
    const result = await this.onboardingService.getFullOnboardingByAuthId(store.userId);
    return { success: true, data: result };
  };

  getProgress = async ({ store }: any) => {
    const result = await this.onboardingService.getProgressByAuthId(store.userId);
    return { success: true, data: result };
  };

  getSection = async ({ params, store }: any) => {
    const result = await this.onboardingService.getSectionByAuthId(
      store.userId,
      params.section as SectionKey,
    );
    return { success: true, data: result };
  };

  saveSection = async ({ params, body, store }: any) => {
    const result = await this.onboardingService.saveSectionByAuthId(
      store.userId,
      params.section as SectionKey,
      body.data,
      body.mark_complete ?? false,
    );
    return { success: true, data: result };
  };

  submitOnboarding = async ({ store }: any) => {
    const result = await this.onboardingService.submitByAuthId(store.userId);
    return { success: true, data: result };
  };

  getUploadUrl = async ({ body, store, set }: any) => {
    const result = await this.onboardingService.getUploadUrl(
      store.userId,
      body.field_name,
      body.content_type,
    );
    set.status = 200;
    return { success: true, data: result };
  };

  // ── Admin handlers ──

  adminListProviders = async ({ query }: any) => {
    const result = await this.onboardingService.adminListProviders({
      status: query.status,
      page: query.page ? Number(query.page) : 1,
      limit: query.limit ? Number(query.limit) : 20,
    });
    return { success: true, ...result };
  };

  adminGetOnboarding = async ({ params }: any) => {
    const result = await this.onboardingService.adminGetOnboarding(params.providerId);
    return { success: true, data: result };
  };

  adminGetChecks = async ({ params }: any) => {
    const result = await this.onboardingService.adminGetChecks(params.providerId);
    return { success: true, data: result };
  };

  adminGetDocumentUrls = async ({ params }: any) => {
    const result = await this.onboardingService.adminGetDocumentUrls(params.providerId);
    return { success: true, data: result };
  };

  adminUpdateCheck = async ({ params, body, store }: any) => {
    const result = await this.onboardingService.adminUpdateCheck(
      params.providerId,
      store.userId,
      body.check_key,
      body.is_checked,
      body.notes,
    );
    return { success: true, data: result };
  };

  adminUpdateStatus = async ({ params, body, store, set }: any) => {
    // Checked against every role on the token, not just the highest one: an
    // account that holds both `admin` and `super_admin` presents `admin` as
    // `userRole` in some orderings, and would have been refused its own access.
    const roles: string[] = store.userRoles ?? [store.userRole];
    if (!roles.includes('super_admin')) {
      set.status = 403;
      return errorEnvelope(
        'FORBIDDEN',
        'Approving or rejecting onboarding requires super_admin role',
      );
    }
    const result = await this.onboardingService.adminUpdateStatus(
      params.providerId,
      store.userId,
      body.status,
      body.reviewer_notes,
    );
    return { success: true, data: result };
  };
}
