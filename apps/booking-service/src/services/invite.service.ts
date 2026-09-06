import { AppError, NotFoundError } from '@longeny/errors';
import { ServiceCallError, createLogger, createServiceClient } from '@longeny/utils';
import { config } from '../config/index.js';

const logger = createLogger('calendar-invite');

export interface InviteInput {
  profileId: string;
  title: string;
  startTime: string;
  endTime: string;
  description?: string;
  location?: string;
  organizerEmail?: string;
}

interface NotifyResponse {
  data: {
    profileId: string;
    delivered: number;
    attempted: number;
    entries: { id: string; channel: string; status: string; error: string | null }[];
  };
}

/**
 * Calendar invites for people who have no login.
 *
 * A dependent profile — a parent, a child — never signs in, so an appointment
 * reaches them only through a notification target. This builds a real RFC 5545
 * invite and hands it to user-provider, which owns the targets and the delivery
 * log, so one service decides who may be contacted and records what was sent.
 */
export class InviteService {
  private readonly userProvider = createServiceClient(
    'booking-service',
    config.USER_PROVIDER_SERVICE_URL,
    config.HMAC_SECRET,
  );

  async sendInvite(input: InviteInput) {
    const ics = buildIcs(input, config.SMTP_FROM);

    try {
      const response = await this.userProvider.post<NotifyResponse>('/internal/notify/profile', {
        profileId: input.profileId,
        channel: 'calendar',
        subject: input.title,
        body: [
          input.description ?? 'You have an appointment with Longeny.',
          '',
          `When: ${formatWhen(input.startTime)}`,
          input.location ? `Where: ${input.location}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
        attachment: {
          filename: 'invite.ics',
          contentType: 'text/calendar',
          method: 'REQUEST',
          content: ics,
        },
      });

      const result = response.data;

      // Delivery is reported honestly. Nothing delivered means nothing arrived,
      // and the endpoint says so rather than answering 200 for a message that
      // sits in a log row marked failed.
      if (result.delivered === 0) {
        const reason = result.entries.find((e) => e.error)?.error ?? 'No calendar target reachable';
        logger.warn({ profileId: input.profileId, reason }, 'Calendar invite not delivered');
        throw new AppError(
          `Invite could not be delivered: ${reason}`,
          502,
          'DELIVERY_FAILED',
          true,
          {
            attempted: result.attempted,
            entries: result.entries,
          },
        );
      }

      return result;
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (error instanceof ServiceCallError && error.status === 404) {
        throw new NotFoundError('Profile');
      }
      logger.error({ error, profileId: input.profileId }, 'Invite dispatch failed');
      throw new AppError('Invite could not be dispatched', 502, 'DELIVERY_FAILED');
    }
  }
}

/** ICS wants UTC as YYYYMMDDTHHMMSSZ, with no punctuation. */
function toIcsTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    throw new AppError(`Invalid date: ${iso}`, 400, 'VALIDATION_ERROR');
  }
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

/**
 * Escape per RFC 5545 §3.3.11. Backslash first, or it would escape the escapes
 * added after it.
 */
function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * A real invite, not a text file that mentions a time: calendar clients only
 * offer "add to calendar" for a well-formed VEVENT with a stable UID.
 *
 * The UID is derived from the profile and the start time, so re-sending the same
 * appointment updates the existing entry in the recipient's calendar rather than
 * adding a second one.
 */
function buildIcs(input: InviteInput, organizer: string): string {
  const uid = `${input.profileId}-${toIcsTime(input.startTime)}@longeny`;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Longeny//Care Scheduling//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${toIcsTime(new Date().toISOString())}`,
    `DTSTART:${toIcsTime(input.startTime)}`,
    `DTEND:${toIcsTime(input.endTime)}`,
    `SUMMARY:${escapeIcsText(input.title)}`,
    input.description ? `DESCRIPTION:${escapeIcsText(input.description)}` : '',
    input.location ? `LOCATION:${escapeIcsText(input.location)}` : '',
    `ORGANIZER:mailto:${input.organizerEmail ?? organizer}`,
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean);

  // CRLF, not LF. Some clients reject an ICS with bare newlines.
  return `${lines.join('\r\n')}\r\n`;
}

function formatWhen(iso: string): string {
  return new Date(iso).toUTCString();
}
