import { z } from 'zod';

// ── Base config schema (shared across all services) ──
export const baseConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'staging', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().default(''),
  HMAC_SECRET: z.string().min(1).default('dev-hmac-secret'),
  ENCRYPTION_KEY: z.string().min(1).default('dev-encryption-key'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
});

export type BaseConfig = z.infer<typeof baseConfigSchema>;

// ── Per-service config schemas ──
export const gatewayConfigSchema = baseConfigSchema.extend({
  GATEWAY_PORT: z.coerce.number().default(3000),
  AUTH_SERVICE_URL: z.string().url().default('http://localhost:3001'),
  USER_PROVIDER_SERVICE_URL: z.string().url().default('http://localhost:3002'),
  BOOKING_SERVICE_URL: z.string().url().default('http://localhost:3003'),
  AI_CONTENT_SERVICE_URL: z.string().url().default('http://localhost:3004'),
  PAYMENT_SERVICE_URL: z.string().url().default('http://localhost:3005'),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().default(100),
});

export type GatewayConfig = z.infer<typeof gatewayConfigSchema>;

export const authConfigSchema = baseConfigSchema.extend({
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
});

export type AuthConfig = z.infer<typeof authConfigSchema>;

export const userProviderConfigSchema = baseConfigSchema.extend({
  USER_PROVIDER_SERVICE_PORT: z.coerce.number().default(3002),
  CORE_DATABASE_URL: z.string().min(1),
  AUTH_SERVICE_URL: z.string().url().default('http://localhost:3001'),
  BOOKING_SERVICE_URL: z.string().url().default('http://localhost:3003'),
  AI_CONTENT_SERVICE_URL: z.string().url().default('http://localhost:3004'),
  PAYMENT_SERVICE_URL: z.string().url().default('http://localhost:3005'),
  S3_EXPORTS_BUCKET: z.string().default('longeny-exports'),
  AWS_REGION: z.string().default('us-east-1'),
  AWS_ACCESS_KEY_ID: z.string().default('test'),
  AWS_SECRET_ACCESS_KEY: z.string().default('test'),
  AWS_ENDPOINT_URL: z.string().default('http://localhost:4566'),
});

export type UserProviderConfig = z.infer<typeof userProviderConfigSchema>;

export const bookingConfigSchema = baseConfigSchema.extend({
  BOOKING_SERVICE_PORT: z.coerce.number().default(3003),
  BOOKING_DATABASE_URL: z.string().min(1),
  GOOGLE_CALENDAR_CLIENT_ID: z.string().default(''),
  GOOGLE_CALENDAR_CLIENT_SECRET: z.string().default(''),
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().default(1025),
  SMTP_FROM: z.string().default('noreply@longeny.com'),
  TWILIO_ACCOUNT_SID: z.string().default(''),
  TWILIO_AUTH_TOKEN: z.string().default(''),
  TWILIO_PHONE_NUMBER: z.string().default(''),
});

export type BookingConfig = z.infer<typeof bookingConfigSchema>;

export const aiContentConfigSchema = baseConfigSchema.extend({
  AI_CONTENT_SERVICE_PORT: z.coerce.number().default(3004),
  AI_CONTENT_DATABASE_URL: z.string().min(1),
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
});

export type AiContentConfig = z.infer<typeof aiContentConfigSchema>;

export const paymentConfigSchema = baseConfigSchema.extend({
  PAYMENT_SERVICE_PORT: z.coerce.number().default(3005),
  PAYMENT_DATABASE_URL: z.string().min(1),
  PAYMENT_GATEWAY: z.enum(['stripe', 'razorpay']).default('stripe'),
  STRIPE_SECRET_KEY: z.string().default(''),
  STRIPE_WEBHOOK_SECRET: z.string().default(''),
  RAZORPAY_KEY_ID: z.string().default(''),
  RAZORPAY_KEY_SECRET: z.string().default(''),
  RAZORPAY_WEBHOOK_SECRET: z.string().default(''),
});

export type PaymentConfig = z.infer<typeof paymentConfigSchema>;

// ── Config loader ──
export function loadConfig<T>(schema: z.ZodSchema<T>): T {
  const result = schema.safeParse(Bun.env);

  if (!result.success) {
    const formatted = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');

    throw new Error(`Environment configuration validation failed:\n${formatted}`);
  }

  return result.data;
}
