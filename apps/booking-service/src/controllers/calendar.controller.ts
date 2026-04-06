import type { CalendarService } from '../services/calendar.service.js';

export class CalendarController {
  constructor(private calendarService: CalendarService) {}

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
  handleCallback = async ({ query }: any) => {
    const code = query.code;
    const state = query.state; // providerId
    const error = query.error;

    if (error) {
      return {
        success: false,
        error: { code: 'CALENDAR_AUTH_FAILED', message: `Google OAuth error: ${error}` },
      };
    }

    if (!code || !state) {
      return {
        success: false,
        error: { code: 'BAD_REQUEST', message: 'Missing code or state parameter' },
      };
    }

    const calendarSync = await this.calendarService.handleCallback(code, state);

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
