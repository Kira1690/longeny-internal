import { z } from 'zod';
import { emailSchema, passwordSchema } from './common.js';

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  firstName: z.string().min(1).max(100).trim(),
  lastName: z.string().min(1).max(100).trim(),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1),
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1),
});

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: passwordSchema,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});

export const consentTypeEnum = z.enum([
  'terms_of_service',
  'privacy_policy',
  'health_data_processing',
  'ai_profiling',
  'data_sharing_providers',
  'marketing_email',
  'marketing_sms',
]);

export const consentSchema = z.object({
  consentType: consentTypeEnum,
  granted: z.boolean(),
  version: z.string().default('1.0'),
});
