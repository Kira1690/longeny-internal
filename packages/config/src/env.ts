import { z } from 'zod';

/**
 * Placeholder values that keep local development and tests zero-config. They are
 * committed, so anyone can sign an internal call with them — a deployment that
 * boots on one is signing with a public secret. `requireDeployedSecrets` below
 * turns each of these into a boot failure outside development and test.
 */
const DEV_SECRET_DEFAULTS = [
  ['HMAC_SECRET', 'dev-hmac-secret'],
  ['ENCRYPTION_KEY', 'dev-encryption-key'],
] as const;

// ── Base config schema (shared across all services) ──
const baseConfigShape = z.object({
  NODE_ENV: z.enum(['development', 'staging', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().default(''),
  HMAC_SECRET: z.string().min(1).default(DEV_SECRET_DEFAULTS[0][1]),
  ENCRYPTION_KEY: z.string().min(1).default(DEV_SECRET_DEFAULTS[1][1]),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
});

export type BaseConfig = z.infer<typeof baseConfigShape>;

/**
 * Applied to every exported service schema. Zod 3 turns a refined object into a
 * `ZodEffects`, which has no `.extend()`, so the refinement is applied last —
 * after each service has extended the shared shape — rather than on the base.
 */
function requireDeployedSecrets<Output extends BaseConfig, Def extends z.ZodTypeDef, Input>(
  schema: z.ZodType<Output, Def, Input>,
) {
  return schema.superRefine((cfg, ctx) => {
    if (cfg.NODE_ENV !== 'production' && cfg.NODE_ENV !== 'staging') return;

    for (const [key, devDefault] of DEV_SECRET_DEFAULTS) {
      if (cfg[key] === devDefault) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `must be set to a real secret when NODE_ENV=${cfg.NODE_ENV}; the development default is public`,
        });
      }
    }
  });
}

export const baseConfigSchema = requireDeployedSecrets(baseConfigShape);

// ── Per-service config schemas ──
export const gatewayConfigSchema = requireDeployedSecrets(
  baseConfigShape.extend({
    GATEWAY_PORT: z.coerce.number().default(3000),
    GATEWAY_PUBLIC_URL: z.string().url().optional(),
    AUTH_SERVICE_URL: z.string().url().default('http://localhost:3001'),
    USER_PROVIDER_SERVICE_URL: z.string().url().default('http://localhost:3002'),
    BOOKING_SERVICE_URL: z.string().url().default('http://localhost:3003'),
    AI_CONTENT_SERVICE_URL: z.string().url().default('http://localhost:3004'),
    PAYMENT_SERVICE_URL: z.string().url().default('http://localhost:3005'),
    RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000),
    RATE_LIMIT_MAX_REQUESTS: z.coerce.number().default(100),
  }),
);

export type GatewayConfig = z.infer<typeof gatewayConfigSchema>;

export const authConfigSchema = requireDeployedSecrets(
  baseConfigShape.extend({
    AUTH_SERVICE_PORT: z.coerce.number().default(3001),
    AUTH_DATABASE_URL: z.string().min(1),
    JWT_ACCESS_SECRET: z.string().min(1),
    JWT_REFRESH_SECRET: z.string().min(1),
    JWT_ACCESS_EXPIRY: z.string().default('15m'),
    JWT_REFRESH_EXPIRY: z.string().default('7d'),
    BCRYPT_SALT_ROUNDS: z.coerce.number().default(12),
    GOOGLE_CLIENT_ID: z.string().default(''),
    GOOGLE_CLIENT_SECRET: z.string().default(''),
    GOOGLE_CALLBACK_URL: z.string().default('http://localhost:3000/api/v1/auth/google/callback'),
    AUTH_SWAGGER_SERVERS: z.string().optional(),
    // Seed-only. Unset means the seeder falls back to its published development
    // password, which it will only do when NODE_ENV is development or test.
    SEED_ADMIN_PASSWORD: z.string().min(12).optional(),
    SEED_SUPER_ADMIN_PASSWORD: z.string().min(12).optional(),
  }),
);

export type AuthConfig = z.infer<typeof authConfigSchema>;

export const userProviderConfigSchema = requireDeployedSecrets(
  baseConfigShape.extend({
    USER_PROVIDER_SERVICE_PORT: z.coerce.number().default(3002),
    CORE_DATABASE_URL: z.string().min(1),
    AUTH_SERVICE_URL: z.string().url().default('http://localhost:3001'),
    BOOKING_SERVICE_URL: z.string().url().default('http://localhost:3003'),
    AI_CONTENT_SERVICE_URL: z.string().url().default('http://localhost:3004'),
    PAYMENT_SERVICE_URL: z.string().url().default('http://localhost:3005'),
    S3_UPLOADS_BUCKET: z.string().default('longeny-uploads'),
    S3_EXPORTS_BUCKET: z.string().default('longeny-exports'),
    // Delivery for dependent-profile notifications. This service owns the
    // targets and the log, so it owns the send.
    SMTP_HOST: z.string().default('localhost'),
    SMTP_PORT: z.coerce.number().default(1025),
    SMTP_FROM: z.string().default('noreply@longeny.com'),
    SMTP_USER: z.string().default(''),
    SMTP_PASSWORD: z.string().default(''),
    KMS_KEY_ID: z.string().default(''),
    AWS_REGION: z.string().default('us-east-1'),
    AWS_ACCESS_KEY_ID: z.string().default('test'),
    AWS_SECRET_ACCESS_KEY: z.string().default('test'),
    AWS_ENDPOINT_URL: z.string().default('http://localhost:4566'),
  }),
);

export type UserProviderConfig = z.infer<typeof userProviderConfigSchema>;

export const bookingConfigSchema = requireDeployedSecrets(
  baseConfigShape.extend({
    BOOKING_SERVICE_PORT: z.coerce.number().default(3003),
    BOOKING_DATABASE_URL: z.string().min(1),
    // A booking names a subject of care, and profiles live in user-provider.
    USER_PROVIDER_SERVICE_URL: z.string().url().default('http://localhost:3002'),
    GOOGLE_CALENDAR_CLIENT_ID: z.string().default(''),
    GOOGLE_CALENDAR_CLIENT_SECRET: z.string().default(''),
    SMTP_HOST: z.string().default('localhost'),
    SMTP_PORT: z.coerce.number().default(1025),
    SMTP_FROM: z.string().default('noreply@longeny.com'),
    TWILIO_ACCOUNT_SID: z.string().default(''),
    TWILIO_AUTH_TOKEN: z.string().default(''),
    TWILIO_PHONE_NUMBER: z.string().default(''),
  }),
);

export type BookingConfig = z.infer<typeof bookingConfigSchema>;

export const aiContentConfigSchema = requireDeployedSecrets(
  baseConfigShape.extend({
    AI_CONTENT_SERVICE_PORT: z.coerce.number().default(3004),
    AI_CONTENT_DATABASE_URL: z.string().min(1),
    AI_AGENT_URL: z.string().url().default('http://localhost:8000'),
    // This service asks user-provider who owns a profile and booking whether a
    // provider has an active engagement with one. Both were read straight from
    // Bun.env at the call site before; a typo there failed at request time.
    USER_PROVIDER_SERVICE_URL: z.string().url().default('http://localhost:3002'),
    BOOKING_SERVICE_URL: z.string().url().default('http://localhost:3003'),
    /**
     * Which classifier/summary implementation runs. `bedrock` is the model;
     * `rules` is the deterministic baseline, whose output is advisory only and
     * can never transition a profile's RRO state. See plan/rro/week-07-ai-core.md.
     */
    RRO_AI_PROVIDER: z.enum(['bedrock', 'rules']).default('rules'),
    BEDROCK_MODEL_ID_RRO: z.string().default('anthropic.claude-3-5-sonnet-20241022-v2:0'),
    AWS_BEDROCK_REGION: z.string().default('us-east-1'),
    BEDROCK_MODEL_ID_PRIMARY: z.string().default('meta.llama3-1-70b-instruct-v1:0'),
    BEDROCK_MODEL_ID_LIGHT: z.string().default('meta.llama3-1-8b-instruct-v1:0'),
    BEDROCK_EMBEDDING_MODEL_ID: z.string().default('amazon.titan-embed-text-v2:0'),
    AWS_REGION: z.string().default('us-east-1'),
    AWS_ACCESS_KEY_ID: z.string().default('test'),
    AWS_SECRET_ACCESS_KEY: z.string().default('test'),
    AWS_ENDPOINT_URL: z.string().default('http://localhost:4566'),
    S3_UPLOADS_BUCKET: z.string().default('longeny-uploads'),
    S3_DOCUMENTS_BUCKET: z.string().default('longeny-documents'),
  }),
);

export type AiContentConfig = z.infer<typeof aiContentConfigSchema>;

export const paymentConfigSchema = requireDeployedSecrets(
  baseConfigShape.extend({
    PAYMENT_SERVICE_PORT: z.coerce.number().default(3005),
    PAYMENT_DATABASE_URL: z.string().min(1),
    // An order records which subject of care it was for; profiles live in user-provider.
    USER_PROVIDER_SERVICE_URL: z.string().url().default('http://localhost:3002'),
    PAYMENT_GATEWAY: z.enum(['stripe', 'razorpay']).default('stripe'),
    STRIPE_SECRET_KEY: z.string().default(''),
    STRIPE_WEBHOOK_SECRET: z.string().default(''),
    RAZORPAY_KEY_ID: z.string().default(''),
    RAZORPAY_KEY_SECRET: z.string().default(''),
    RAZORPAY_WEBHOOK_SECRET: z.string().default(''),
  }),
);

export type PaymentConfig = z.infer<typeof paymentConfigSchema>;

// ── Config loader ──
export function loadConfig<S extends z.ZodType>(schema: S): z.infer<S> {
  // z.infer (output type) rather than a bare generic: fields with defaults are
  // optional on the way in and always present on the way out, and a bare T
  // resolved to the input type, leaking `| undefined` into every service config.
  const result = schema.safeParse(Bun.env);

  if (!result.success) {
    const formatted = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');

    throw new Error(`Environment configuration validation failed:\n${formatted}`);
  }

  return result.data;
}
