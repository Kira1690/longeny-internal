import pino from 'pino';

const PII_REDACT_PATHS = [
  'password',
  'token',
  'refreshToken',
  'phone',
  'dateOfBirth',
  'ssn',
  'medicalConditions',
  'medications',
  'allergies',
  'req.headers.authorization',
  'req.headers.cookie',
];

/**
 * Mask an email address for logging: `user@example.com` -> `u***@example.com`
 */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '***';
  return `${local[0]}***@${domain}`;
}

/**
 * Create a structured Pino logger for a service with PII redaction.
 */
export function createLogger(serviceName: string) {
  return pino({
    name: serviceName,
    level: Bun.env.LOG_LEVEL || 'info',
    redact: {
      paths: PII_REDACT_PATHS,
      censor: '[REDACTED]',
    },
    formatters: {
      level(label: string) {
        return { level: label };
      },
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}
