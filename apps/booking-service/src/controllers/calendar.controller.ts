import { AppError, BadRequestError } from '@longeny/errors';
import type { RequestContext } from '@longeny/middleware';
import type { CalendarService } from '../services/calendar.service.js';
import type { InviteService } from '../services/invite.service.js';

interface CallbackContext {
  query: Record<string, string | undefined>;
  store: RequestContext;
}

export class CalendarController {
  constructor(
    private calendarService: CalendarService,
    private inviteService: InviteService,
  ) {}

  /**
   * POST /bookings/calendar/invite
   *
   * Sends an appointment to a profile with no login. The recipient's address is
   * never in the request — it comes from the profile's notification targets, so
   * this endpoint cannot be used to mail an arbitrary address.
   */
  sendInvite = async ({ body }: any) => {
    const data = await this.inviteService.sendInvite(body);
    return { success: true, data, meta: { timestamp: new Date().toISOString() } };
  };

  // GET /bookings/calendar/connect
  getConnectUrl = async ({ store }: any) => {
    const url = this.calendarService.getAuthUrl(store.userId);

    return {
      success: true,
      data: { url },
      meta: { timestamp: new Date().toISOString() },
    };
  };

  // GET /bookings/calendar/callback
  handleCallback = async ({ query, store }: CallbackContext) => {
    const code = query.code;
    // Opaque and signed, not a provider id — the service resolves it and
    // requires it to name the authenticated caller.
    const state = query.state;
    const error = query.error;

    // Thrown, not returned: both of these used to answer HTTP 200 with a
    // `success: false` body, which reads to any status-code check as a
    // successful connection.
    if (error) {
      throw new AppError(`Google OAuth error: ${error}`, 400, 'CALENDAR_AUTH_FAILED');
    }

    if (!code || !state) {
      throw new BadRequestError('Missing code or state parameter');
    }

    const calendarSync = await this.calendarService.handleCallback(code, state, store.userId);

    return {
      success: true,
      data: {
        connected: true,
        calendarId: calendarSync.google_calendar_id,
        status: calendarSync.status,
      },
      message: 'Calendar connected successfully',
      meta: { timestamp: new Date().toISOString() },
    };
  };

  // DELETE /bookings/calendar/disconnect
  disconnect = async ({ store }: any) => {
    await this.calendarService.disconnect(store.userId);

    return {
      success: true,
      data: null,
      message: 'Calendar disconnected',
      meta: { timestamp: new Date().toISOString() },
    };
  };

  // GET /bookings/calendar/status
  getStatus = async ({ store }: any) => {
    const status = await this.calendarService.getConnectionStatus(store.userId);

    return {
      success: true,
      data: status,
      meta: { timestamp: new Date().toISOString() },
    };
  };
}
