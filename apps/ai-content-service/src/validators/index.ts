import { z } from 'zod';

// Re-export the shared schemas this service validates against, so routes have
// one import and the shared package stays the definition.
export { submitIntakeSchema, intakeSchema } from '@longeny/validators';
export type { SubmitIntake, Intake } from '@longeny/validators';

/**
 * POST /internal/ai/classify — the trusted-caller body.
 *
 * The intake itself is not passed in: it is read from storage by profile, so a
 * caller cannot classify one set of answers and have the result stored against
 * another. `ageBand` is the only patient attribute the model receives, and it is
 * a band rather than a date of birth on purpose (`RRO_GUARDRAILS.noIdentifiers`).
 */
export const classifyRequestSchema = z.object({
  profileId: z.string().uuid(),
  ageBand: z.enum(['under_18', '18_39', '40_59', '60_plus']).optional(),
});

/** POST /internal/ai/summary — same reasoning as above. */
export const summaryRequestSchema = z.object({
  profileId: z.string().uuid(),
});
