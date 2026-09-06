import { RRO_PILLARS, RRO_STATES } from '@longeny/types';
import { z } from 'zod';
import { uuidSchema } from './common.js';
import { intakeSchema } from './intake.js';

/**
 * AI contracts for the RRO track (plan item A6).
 *
 * These are the boundary between the backend and the model. Both sides validate
 * against the same schema: the AI service parses its own output before
 * returning it, and the backend parses again before storing. A response that
 * does not fit is rejected, never coerced and never persisted — a model that
 * invents a state is a bug we want to see, not one to round off.
 *
 * States and pillars come from `@longeny/types`, so adding one to the care model
 * updates the database enum, the validators and these contracts together.
 *
 * Contracts are versioned. When a shape changes incompatibly, add v2 beside v1
 * rather than editing v1 — stored outputs must stay readable.
 */

export const RRO_CONTRACT_VERSION = 'v1' as const;

const rroStateSchema = z.enum(RRO_STATES);
const rroPillarSchema = z.enum(RRO_PILLARS);

/** 0–1. Below `RRO_MIN_CLASSIFIER_CONFIDENCE` the result must not transition state. */
const confidenceSchema = z.number().min(0).max(1);

/**
 * A classification below this is advisory only: it may be shown to a clinician,
 * it may not move a profile between states on its own.
 */
export const RRO_MIN_CLASSIFIER_CONFIDENCE = 0.7;

// ── Classifier ───────────────────────────────────────────────────────────────

export const rroClassifierInputSchema = z.object({
  profileId: uuidSchema,
  /**
   * The submitted intake answers, in the shape the intake form defines. Imported
   * rather than restated: the form and the contract must not be able to disagree
   * about what an answer looks like.
   */
  intake: intakeSchema,
  /** Prior states, oldest first, so the model can see a regression. */
  history: z
    .array(
      z.object({
        state: rroStateSchema,
        enteredAt: z.string().datetime(),
      }),
    )
    .max(50)
    .default([]),
  /** Age band, never a date of birth — the model never receives an identifier. */
  ageBand: z.enum(['under_18', '18_39', '40_59', '60_plus']).optional(),
});

export const rroClassifierOutputSchema = z.object({
  contractVersion: z.literal(RRO_CONTRACT_VERSION),
  state: rroStateSchema,
  confidence: confidenceSchema,
  /** Highest priority first. Every pillar the model considered relevant. */
  pillarPriorities: z.array(rroPillarSchema).min(1).max(RRO_PILLARS.length),
  /** Why, in language a clinician can check. Not shown to the patient unedited. */
  rationale: z.string().min(1).max(2000),
  /** What the model would need to be more certain. Drives the intake follow-up. */
  missingData: z.array(z.string().max(200)).max(20).default([]),
});

export type RroClassifierInput = z.infer<typeof rroClassifierInputSchema>;
export type RroClassifierOutput = z.infer<typeof rroClassifierOutputSchema>;

// ── Pre-consult summary ──────────────────────────────────────────────────────

const redFlagSchema = z.object({
  finding: z.string().min(1).max(500),
  /** Urgency for triage. `emergency` means the UI must surface it immediately. */
  severity: z.enum(['routine', 'urgent', 'emergency']),
  basis: z.string().min(1).max(500),
});

export const rroSummaryInputSchema = z.object({
  profileId: uuidSchema,
  intake: rroClassifierInputSchema.shape.intake,
  currentState: rroStateSchema,
  /** Report titles and dates only — never the document contents. */
  reports: z
    .array(z.object({ title: z.string().max(300), reportedAt: z.string().datetime() }))
    .max(100)
    .default([]),
});

export const rroSummaryOutputSchema = z.object({
  contractVersion: z.literal(RRO_CONTRACT_VERSION),
  /** Empty when the intake carries too little to summarise — see `sufficientData`. */
  concerns: z.array(z.string().max(500)).max(20),
  missingData: z.array(z.string().max(200)).max(20),
  redFlags: z.array(redFlagSchema).max(20),
  suggestedQuestions: z.array(z.string().max(300)).max(20),
  /**
   * False means the model declined to summarise for lack of input. The backend
   * stores the refusal as-is; it must never be presented as a clinical finding.
   */
  sufficientData: z.boolean(),
});

export type RroSummaryInput = z.infer<typeof rroSummaryInputSchema>;
export type RroSummaryOutput = z.infer<typeof rroSummaryOutputSchema>;

// ── Guardrails ───────────────────────────────────────────────────────────────

/**
 * What the model is not allowed to do, in a form the eval harness can assert.
 * These are contract terms, not prompt suggestions: a response that breaches one
 * is rejected by the backend even if it parses.
 */
export const RRO_GUARDRAILS = {
  /** No diagnosis. The platform classifies care state; it does not name diseases. */
  noDiagnosis: true,
  /** No prescription, dose or medication change without a clinician's approval. */
  noPrescribing: true,
  /** No identifiers in, no identifiers out — the model sees an age band, not a DOB. */
  noIdentifiers: true,
  /** Below the confidence floor the output is advisory and cannot transition state. */
  minConfidence: RRO_MIN_CLASSIFIER_CONFIDENCE,
} as const;

/** Shape a model returns when it declines. Valid output, not an error. */
export const rroRefusalSchema = z.object({
  contractVersion: z.literal(RRO_CONTRACT_VERSION),
  refused: z.literal(true),
  reason: z.enum(['insufficient_data', 'out_of_scope', 'safety_guardrail']),
  detail: z.string().max(1000),
});

export type RroRefusal = z.infer<typeof rroRefusalSchema>;

/** Either a classification or an explicit refusal — never a half-filled object. */
export const rroClassifierResponseSchema = z.union([rroClassifierOutputSchema, rroRefusalSchema]);

export const rroSummaryResponseSchema = z.union([rroSummaryOutputSchema, rroRefusalSchema]);

/** True when a classification may move the profile's state on its own. */
export function mayTransitionState(
  output: RroClassifierOutput | RroRefusal,
): output is RroClassifierOutput {
  return !('refused' in output) && output.confidence >= RRO_MIN_CLASSIFIER_CONFIDENCE;
}
