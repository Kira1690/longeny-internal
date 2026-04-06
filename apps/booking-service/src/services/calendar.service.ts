import { db } from '../db/index.js';
import { eq } from 'drizzle-orm';
import { calendar_sync } from '../db/schema.js';
import { google } from 'googleapis';
import { NotFoundError, BadRequestError, InternalError } from '@longeny/errors';
import { createLogger, encrypt, decrypt } from '@longeny/utils';
import type { BookingConfig } from '@longeny/config';

const logger = createLogger('booking-service:calendar');

interface CalendarEvent {
  summary: string;
  description?: string;
  start: string;
  end: string;
  timezone: string;
}

export class CalendarService {
  private oauth2Client;

  constructor(
    _prismaUnused: unknown,
    private config: BookingConfig,
  ) {
    this.oauth2Client = new google.auth.OAuth2(
      this.config.GOOGLE_CALENDAR_CLIENT_ID,
      this.config.GOOGLE_CALENDAR_CLIENT_SECRET,
      `${Bun.env.PUBLIC_URL || 'http://localhost:3003'}/bookings/calendar/callback`,
    );
  }

  getAuthUrl(providerId: string): string {
    const scopes = [
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/calendar.events',
    ];

    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      state: providerId,
      prompt: 'consent',
    });
  }

  async handleCallback(code: string, providerId: string) {
    try {
      const { tokens } = await this.oauth2Client.getToken(code);

      if (!tokens.access_token || !tokens.refresh_token) {
        throw new BadRequestError('Failed to obtain calendar tokens');
      }

      const encryptionKey = this.config.ENCRYPTION_KEY;
      const encryptedAccess = encrypt(tokens.access_token, encryptionKey);
      const encryptedRefresh = encrypt(tokens.refresh_token, encryptionKey);

      this.oauth2Client.setCredentials(tokens);
      const calendar = google.calendar({ version: 'v3', auth: this.oauth2Client });

      let calendarId = 'primary';
      try {
        const calendarList = await calendar.calendarList.list();
        const primary = calendarList.data.items?.find((c) => c.primary);
        if (primary?.id) calendarId = primary.id;
      } catch {
        // Use 'primary' as default
      }

      const [existing] = await db
        .select()
        .from(calendar_sync)
        .where(eq(calendar_sync.provider_id, providerId))
        .limit(1);

      let result;
      if (existing) {
        [result] = await db
          .update(calendar_sync)
          .set({
            google_calendar_id: calendarId,
            google_access_token_encrypted: encryptedAccess,
            google_refresh_token_encrypted: encryptedRefresh,
            status: 'active',
            error_message: null,
            last_synced_at: new Date(),
            updated_at: new Date(),
          })
          .where(eq(calendar_sync.provider_id, providerId))
          .returning();
      } else {
        [result] = await db
          .insert(calendar_sync)
          .values({
            provider_id: providerId,
            google_calendar_id: calendarId,
            google_access_token_encrypted: encryptedAccess,
            google_refresh_token_encrypted: encryptedRefresh,
            status: 'active',
            last_synced_at: new Date(),
          })
          .returning();
      }

      logger.info({ providerId }, 'Calendar connected successfully');
      return result;
    } catch (error) {
      if (error instanceof BadRequestError) throw error;
      logger.error({ providerId, error }, 'Failed to handle calendar callback');
      throw new InternalError('Failed to connect calendar');
    }
  }

  async disconnect(providerId: string): Promise<void> {
    const [calendarSyncRow] = await db
      .select()
      .from(calendar_sync)
      .where(eq(calendar_sync.provider_id, providerId))
      .limit(1);

    if (!calendarSyncRow) {
      throw new NotFoundError('Calendar connection', providerId);
    }

    if (calendarSyncRow.google_access_token_encrypted) {
      try {
        const accessToken = decrypt(calendarSyncRow.google_access_token_encrypted, this.config.ENCRYPTION_KEY);
        await this.oauth2Client.revokeToken(accessToken);
      } catch (error) {
        logger.warn({ providerId, error }, 'Failed to revoke calendar token');
      }
    }

    await db
      .update(calendar_sync)
      .set({
        status: 'disconnected',
        google_access_token_encrypted: null,
        google_refresh_token_encrypted: null,
        sync_token: null,
        updated_at: new Date(),
      })
      .where(eq(calendar_sync.provider_id, providerId));

    logger.info({ providerId }, 'Calendar disconnected');
  }

  async getConnectionStatus(providerId: string) {
    const [calendarSyncRow] = await db
      .select()
      .from(calendar_sync)
      .where(eq(calendar_sync.provider_id, providerId))
      .limit(1);

    if (!calendarSyncRow) {
      return {
        connected: false,
        status: 'disconnected',
        calendarId: null,
        lastSyncedAt: null,
        errorMessage: null,
      };
    }

    return {
      connected: calendarSyncRow.status === 'active',
      status: calendarSyncRow.status,
      calendarId: calendarSyncRow.google_calendar_id,
      lastSyncedAt: calendarSyncRow.last_synced_at?.toISOString() || null,
      errorMessage: calendarSyncRow.error_message,
    };
  }

  async createCalendarEvent(providerId: string, event: CalendarEvent): Promise<string | null> {
    const authedClient = await this.getAuthedClient(providerId);
    if (!authedClient) return null;

    try {
      const calendar = google.calendar({ version: 'v3', auth: authedClient });
      const [calendarSyncRow] = await db
        .select()
        .from(calendar_sync)
        .where(eq(calendar_sync.provider_id, providerId))
        .limit(1);

      const response = await calendar.events.insert({
        calendarId: calendarSyncRow?.google_calendar_id || 'primary',
        requestBody: {
          summary: event.summary,
          description: event.description,
          start: { dateTime: event.start, timeZone: event.timezone },
          end: { dateTime: event.end, timeZone: event.timezone },
        },
      });

      logger.info({ providerId, eventId: response.data.id }, 'Calendar event created');
      return response.data.id || null;
    } catch (error) {
      logger.error({ providerId, error }, 'Failed to create calendar event');
      await this.markSyncError(providerId, 'Failed to create calendar event');
      return null;
    }
  }

  async updateCalendarEvent(providerId: string, eventId: string, event: CalendarEvent): Promise<boolean> {
    const authedClient = await this.getAuthedClient(providerId);
    if (!authedClient) return false;

    try {
      const calendar = google.calendar({ version: 'v3', auth: authedClient });
      const [calendarSyncRow] = await db
        .select()
        .from(calendar_sync)
        .where(eq(calendar_sync.provider_id, providerId))
        .limit(1);

      await calendar.events.update({
        calendarId: calendarSyncRow?.google_calendar_id || 'primary',
        eventId,
        requestBody: {
          summary: event.summary,
          description: event.description,
          start: { dateTime: event.start, timeZone: event.timezone },
          end: { dateTime: event.end, timeZone: event.timezone },
        },
      });

      logger.info({ providerId, eventId }, 'Calendar event updated');
      return true;
    } catch (error) {
      logger.error({ providerId, eventId, error }, 'Failed to update calendar event');
      return false;
    }
  }

  async deleteCalendarEvent(providerId: string, eventId: string): Promise<boolean> {
    const authedClient = await this.getAuthedClient(providerId);
    if (!authedClient) return false;

    try {
      const calendar = google.calendar({ version: 'v3', auth: authedClient });
      const [calendarSyncRow] = await db
        .select()
        .from(calendar_sync)
        .where(eq(calendar_sync.provider_id, providerId))
        .limit(1);

      await calendar.events.delete({
        calendarId: calendarSyncRow?.google_calendar_id || 'primary',
        eventId,
      });

      logger.info({ providerId, eventId }, 'Calendar event deleted');
      return true;
    } catch (error) {
      logger.error({ providerId, eventId, error }, 'Failed to delete calendar event');
      return false;
    }
  }

  async syncExternalChanges(providerId: string): Promise<void> {
    const [calendarSyncRow] = await db
      .select()
      .from(calendar_sync)
      .where(eq(calendar_sync.provider_id, providerId))
      .limit(1);

    if (!calendarSyncRow || calendarSyncRow.status !== 'active') return;

    const authedClient = await this.getAuthedClient(providerId);
    if (!authedClient) return;

    try {
      const calendar = google.calendar({ version: 'v3', auth: authedClient });

      const params: Record<string, unknown> = {
        calendarId: calendarSyncRow.google_calendar_id || 'primary',
        singleEvents: true,
        timeMin: new Date().toISOString(),
      };

      if (calendarSyncRow.sync_token) {
        params.syncToken = calendarSyncRow.sync_token;
      } else {
        params.timeMax = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      }

      const response = await calendar.events.list(params as Parameters<typeof calendar.events.list>[0]);

      if (response.data.nextSyncToken) {
        await db
          .update(calendar_sync)
          .set({
            sync_token: response.data.nextSyncToken,
            last_synced_at: new Date(),
            error_message: null,
            updated_at: new Date(),
          })
          .where(eq(calendar_sync.provider_id, providerId));
      }

      logger.info(
        { providerId, eventsFound: response.data.items?.length || 0 },
        'Calendar sync completed',
      );
    } catch (error) {
      logger.error({ providerId, error }, 'Calendar sync failed');
      await this.markSyncError(providerId, 'Sync failed');
    }
  }

  private async getAuthedClient(providerId: string) {
    const [calendarSyncRow] = await db
      .select()
      .from(calendar_sync)
      .where(eq(calendar_sync.provider_id, providerId))
      .limit(1);

    if (
      !calendarSyncRow ||
      calendarSyncRow.status !== 'active' ||
      !calendarSyncRow.google_access_token_encrypted ||
      !calendarSyncRow.google_refresh_token_encrypted
    ) {
      return null;
    }

    try {
      const accessToken = decrypt(calendarSyncRow.google_access_token_encrypted, this.config.ENCRYPTION_KEY);
      const refreshToken = decrypt(calendarSyncRow.google_refresh_token_encrypted, this.config.ENCRYPTION_KEY);

      const client = new google.auth.OAuth2(
        this.config.GOOGLE_CALENDAR_CLIENT_ID,
        this.config.GOOGLE_CALENDAR_CLIENT_SECRET,
      );
      client.setCredentials({ access_token: accessToken, refresh_token: refreshToken });

      client.on('tokens', async (tokens) => {
        if (tokens.access_token) {
          const encrypted = encrypt(tokens.access_token, this.config.ENCRYPTION_KEY);
          await db
            .update(calendar_sync)
            .set({ google_access_token_encrypted: encrypted, updated_at: new Date() })
            .where(eq(calendar_sync.provider_id, providerId));
        }
      });

      return client;
    } catch (error) {
      logger.error({ providerId, error }, 'Failed to decrypt calendar tokens');
      await this.markSyncError(providerId, 'Token decryption failed');
      return null;
    }
  }

  private async markSyncError(providerId: string, message: string) {
    await db
      .update(calendar_sync)
      .set({ status: 'error', error_message: message, updated_at: new Date() })
      .where(eq(calendar_sync.provider_id, providerId))
      .catch(() => {});
  }
}
