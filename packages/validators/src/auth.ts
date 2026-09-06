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

/**
 * Google sign-in takes an id_token from client-side Sign-In, or an auth code
 * from a server-side redirect — exactly one of them. Without a schema the route
 * accepted an empty body and the handler read a field off `undefined`, which
 * surfaced as a 500 on a security endpoint.
 */
export const googleAuthSchema = z
  .object({
    idToken: z.string().min(1).optional(),
    code: z.string().min(1).optional(),
    redirectUri: z.string().url().optional(),
  })
  .superRefine((value, ctx) => {
    const provided = [value.idToken, value.code].filter(Boolean).length;
    if (provided === 1) return;

    // Reported against both field names, not the object root: a client reading
    // the error should see which parameters it is choosing between.
    const message =
      provided === 0
        ? 'Provide either idToken (client-side Google Sign-In) or code (server-side redirect)'
        : 'Provide only one of idToken or code, not both';
    for (const path of ['idToken', 'code'] as const) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
    }
  });
