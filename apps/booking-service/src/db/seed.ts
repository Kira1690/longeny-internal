import { db } from './index.js';
import { notification_templates } from './schema.js';
import { createLogger } from '@longeny/utils';

const logger = createLogger('booking-service:seed');

async function seed() {
  logger.info('Seeding booking-service database...');

  // Seed notification templates
  const templates = [
    {
      name: 'booking_confirmed_email',
      type: 'email' as const,
      category: 'booking' as const,
      subject: 'Your booking is confirmed',
      body_template: 'Hello {{userName}}, your booking with {{providerName}} on {{startTime}} has been confirmed.',
      body_html_template: '<p>Hello {{userName}}, your booking with <strong>{{providerName}}</strong> on {{startTime}} has been confirmed.</p>',
      variables: { userName: 'string', providerName: 'string', startTime: 'string' },
      status: 'active' as const,
    },
    {
      name: 'booking_cancelled_email',
      type: 'email' as const,
      category: 'booking' as const,
      subject: 'Your booking has been cancelled',
      body_template: 'Hello {{userName}}, your booking on {{startTime}} has been cancelled.',
      body_html_template: '<p>Hello {{userName}}, your booking on {{startTime}} has been cancelled.</p>',
      variables: { userName: 'string', startTime: 'string' },
      status: 'active' as const,
    },
    {
      name: 'booking_reminder_24h_email',
      type: 'email' as const,
      category: 'reminder' as const,
      subject: 'Reminder: Your session is tomorrow',
      body_template: 'Hello {{userName}}, this is a reminder that your session with {{providerName}} is scheduled for tomorrow at {{startTime}}.',
      body_html_template: '<p>Hello {{userName}}, this is a reminder that your session with <strong>{{providerName}}</strong> is scheduled for tomorrow at {{startTime}}.</p>',
      variables: { userName: 'string', providerName: 'string', startTime: 'string' },
      status: 'active' as const,
    },
    {
      name: 'booking_reminder_1h_email',
      type: 'email' as const,
      category: 'reminder' as const,
      subject: 'Reminder: Your session starts in 1 hour',
      body_template: 'Hello {{userName}}, your session with {{providerName}} starts in 1 hour at {{startTime}}.',
      body_html_template: '<p>Hello {{userName}}, your session with <strong>{{providerName}}</strong> starts in 1 hour at {{startTime}}.</p>',
      variables: { userName: 'string', providerName: 'string', startTime: 'string' },
      status: 'active' as const,
    },
  ];

  for (const template of templates) {
    const [existing] = await db
      .select()
      .from(notification_templates)
      .where(
        // Use raw import to avoid circular
        (await import('drizzle-orm')).eq(notification_templates.name, template.name),
      )
      .limit(1);

    if (!existing) {
      await db.insert(notification_templates).values(template);
      logger.info({ name: template.name }, 'Notification template created');
    } else {
      logger.debug({ name: template.name }, 'Notification template already exists');
    }
  }

  logger.info('Seeding complete');
}

seed().catch((error) => {
  logger.error({ error }, 'Seeding failed');
  process.exit(1);
});
