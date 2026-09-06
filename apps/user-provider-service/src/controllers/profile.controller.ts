import type { EventPublisher } from '@longeny/events';
import type { ProfileService } from '../services/profile.service.js';

/**
 * ProfileController — multi-profile / family (RRO) endpoints.
 * store.userId is the authenticated account's auth_id (JWT sub).
 * Internal handlers (notify, rro transition) are HMAC-authenticated and take
 * the profile from the request body instead of the token.
 */
export class ProfileController {
  constructor(
    private profileService: ProfileService,
    private publisher: EventPublisher,
  ) {}

  // ── Profiles CRUD ──

  listProfiles = async ({ store }: any) => {
    const data = await this.profileService.listProfiles(store.userId);
    return { success: true, data };
  };

  createProfile = async ({ body, store, set }: any) => {
    const data = await this.profileService.createProfile(store.userId, body);
    set.status = 201;
    return { success: true, data };
  };

  getProfile = async ({ params, store }: any) => {
    const data = await this.profileService.getProfile(store.userId, params.id);
    return { success: true, data };
  };

  updateProfile = async ({ params, body, store }: any) => {
    const data = await this.profileService.updateProfile(store.userId, params.id, body);
    return { success: true, data };
  };

  deactivateProfile = async ({ params, store }: any) => {
    const data = await this.profileService.deactivateProfile(store.userId, params.id);
    return { success: true, data };
  };

  activateProfile = async ({ params, store }: any) => {
    const data = await this.profileService.activateProfile(store.userId, params.id);
    return { success: true, data };
  };

  // ── Caregiver consent ──

  recordConsent = async ({ params, body, store, set }: any) => {
    const data = await this.profileService.recordConsent(store.userId, params.id, body);
    set.status = 201;
    return { success: true, data };
  };

  getConsent = async ({ params, store }: any) => {
    const data = await this.profileService.getConsent(store.userId, params.id);
    return { success: true, data };
  };

  // ── RRO state ──

  getRroState = async ({ params, store }: any) => {
    const data = await this.profileService.getRroState(store.userId, params.id);
    return { success: true, data };
  };

  // ── Internal: ownership resolution for other services ──

  /**
   * HMAC-authenticated. The caller passes the account it authenticated (the JWT
   * `sub` it received) and the profile that account is asking to act as. A
   * profile belonging to a different account raises NotFoundError, so the answer
   * is 404 — identical to a profile that does not exist.
   */
  resolveProfile = async ({ body }: any) => {
    const data = await this.profileService.resolveForService(body.authId, body.profileId);
    return { success: true, data };
  };

  /**
   * HMAC-authenticated read of a profile's RRO state and history, for the
   * classifier — which holds no user token and needs the history to see a
   * regression.
   */
  getRroStateForService = async ({ params }: any) => {
    const data = await this.profileService.getRroStateForService(params.profileId);
    return { success: true, data };
  };

  // ── Notifications ──

  addNotificationTarget = async ({ params, body, store, set }: any) => {
    const data = await this.profileService.addNotificationTarget(store.userId, params.id, body);
    set.status = 201;
    return { success: true, data };
  };

  getNotifications = async ({ params, store }: any) => {
    const data = await this.profileService.getNotifications(store.userId, params.id);
    return { success: true, data };
  };

  // ── Internal (HMAC) ──

  recordTransition = async ({ body }: any) => {
    const data = await this.profileService.recordTransition(body);
    return { success: true, data };
  };

  notifyProfile = async ({ body }: any) => {
    const data = await this.profileService.notifyProfile(body);
    return { success: true, data };
  };
}
