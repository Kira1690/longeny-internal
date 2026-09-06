import { createLogger } from '@longeny/utils';
import nodemailer, { type Transporter } from 'nodemailer';
import { config } from '../config/index.js';

const logger = createLogger('mailer');

export interface MailAttachment {
  filename: string;
  contentType: string;
  /** Raw content — an ICS body, not base64. */
  content: string;
  /** For calendar invites: `text/calendar; method=REQUEST`. */
  method?: string;
}

export interface MailInput {
  to: string;
  subject: string;
  text: string;
  attachment?: MailAttachment;
}

/**
 * Email delivery for dependent-profile notifications.
 *
 * A dependent profile — a parent, a child — has no login. Everything they are
 * told arrives through a notification target, and until now `notifyProfile`
 * wrote `status: 'queued'` and stopped: nothing consumed the queue, so every
 * message a family thought had gone out had never been sent. This is the
 * transport that makes `sent` mean sent.
 *
 * The result is returned rather than thrown, because the caller has to record
 * the outcome either way — a failed delivery is a `failed` log row with the
 * reason, not a lost message.
 */
export class MailerService {
  private transporter: Transporter | null = null;

  private getTransporter(): Transporter {
    if (!this.transporter) {
      this.transporter = nodemailer.createTransport({
        host: config.SMTP_HOST,
        port: config.SMTP_PORT,
        // Local mail catchers and most internal relays run without TLS on 1025;
        // a real relay upgrades through STARTTLS, which nodemailer negotiates.
        secure: false,
        ...(config.SMTP_USER
          ? { auth: { user: config.SMTP_USER, pass: config.SMTP_PASSWORD } }
          : {}),
      });
    }
    return this.transporter;
  }

  async send(input: MailInput): Promise<{ delivered: boolean; error?: string }> {
    try {
      await this.getTransporter().sendMail({
        from: config.SMTP_FROM,
        to: input.to,
        subject: input.subject,
        text: input.text,
        ...(input.attachment
          ? {
              attachments: [
                {
                  filename: input.attachment.filename,
                  content: input.attachment.content,
                  contentType: input.attachment.method
                    ? `${input.attachment.contentType}; method=${input.attachment.method}`
                    : input.attachment.contentType,
                },
              ],
            }
          : {}),
      });
      return { delivered: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error, to: maskAddress(input.to) }, 'Email delivery failed');
      return { delivered: false, error: message.slice(0, 500) };
    }
  }
}

/** Never log a dependent's full address — it is the only identifier they have here. */
function maskAddress(address: string): string {
  const [local, domain] = address.split('@');
  if (!domain) return '***';
  return `${local.slice(0, 2)}***@${domain}`;
}
