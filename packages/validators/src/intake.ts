import { RRO_PILLARS } from '@longeny/types';
import { z } from 'zod';

/**
 * The RRO intake form — the one definition.
 *
 * Two things consume this shape: the endpoint a patient submits
 * (`POST /intake`) and the classifier contract that feeds the same answers to a
 * model (`rroClassifierInputSchema.intake`). They were about to be written
 * twice, which is how a field ends up accepted by the form and ignored by the
 * classifier.
 *
 * Every list is bounded. These strings are pasted into a model prompt, so an
 * unbounded array is both a cost problem and a prompt-injection surface.
 */

/** One free-text clinical entry — a symptom, a goal, a condition, a medication. */
const entrySchema = z.string().trim().min(1).max(200);

export const intakeSchema = z.object({
  symptoms: z.array(entrySchema).max(50).default([]),
  goals: z.array(entrySchema).max(20).default([]),
  conditions: z.array(entrySchema).max(50).default([]),
  medications: z.array(entrySchema).max(50).default([]),
  /** Ranked, highest priority first. The classifier weighs but does not obey this. */
  pillarPriorities: z.array(z.enum(RRO_PILLARS)).max(RRO_PILLARS.length).default([]),
});

export type Intake = z.infer<typeof intakeSchema>;

/**
 * POST /intake — the submitted body.
 *
 * `profileId` is deliberately absent: the subject of care comes from the
 * resolved profile context (`X-Active-Profile-Id`, ownership re-checked on every
 * request), never from the body. A body-supplied profile id would be a
 * client-controlled scope, which is the whole problem the profile context
 * exists to solve.
 */
export const submitIntakeSchema = intakeSchema
  .extend({
    notes: z.string().trim().max(5000).optional(),
  })
  // Unknown keys are rejected, not dropped. Every field here has a `.default([])`,
  // so a client that wraps its answers in the wrong envelope — `{answers: {...}}`
  // instead of the flat body — had every real field stripped and still got a 201
  // with an empty intake stored against the patient. Silent field-dropping is
  // tolerable on a search filter; on a clinical form it means the patient
  // believes they submitted and the record says they said nothing.
  .strict();

export type SubmitIntake = z.infer<typeof submitIntakeSchema>;

/**
 * An intake carrying nothing to reason about. The classifier and the summary
 * both refuse rather than invent, and the endpoint says so up front instead of
 * paying for a model call that can only decline.
 */
export function isEmptyIntake(intake: Pick<Intake, 'symptoms' | 'goals' | 'conditions'>): boolean {
  return (
    intake.symptoms.length === 0 && intake.goals.length === 0 && intake.conditions.length === 0
  );
}
