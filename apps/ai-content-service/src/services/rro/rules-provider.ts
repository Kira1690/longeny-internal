import { RRO_PILLARS, type RroPillar, type RroState } from '@longeny/types';
import {
  RRO_CONTRACT_VERSION,
  RRO_MIN_CLASSIFIER_CONFIDENCE,
  type RroClassifierInput,
  type RroClassifierOutput,
  type RroRefusal,
  type RroSummaryInput,
  type RroSummaryOutput,
  isEmptyIntake,
} from '@longeny/validators';
import type { RroAiProvider } from './provider.js';

/**
 * Deterministic RRO baseline.
 *
 * This is not a mock. It is the implementation that runs when the model is
 * unavailable, and the reference the Week 11 eval harness scores the model
 * against. It reasons over the same taxonomy the model is asked to use:
 * how much of the intake is filled, what the answers mention, and which pillars
 * those mentions map to.
 *
 * Two properties are deliberate and must not be relaxed:
 *
 *  1. **Its confidence never reaches the transition floor.** A rules engine
 *     reading keywords is not entitled to move someone through a care pathway,
 *     so its output is advisory by construction rather than by policy — there is
 *     no configuration that lets it transition a profile.
 *  2. **It refuses rather than invents.** An intake with nothing in it produces
 *     an explicit refusal, never a confident-looking classification built from
 *     no evidence.
 */

/** Ceiling for every rules result. Below `RRO_MIN_CLASSIFIER_CONFIDENCE` by design. */
const ADVISORY_CEILING = RRO_MIN_CLASSIFIER_CONFIDENCE - 0.05;

/**
 * Terms that point at a pillar. Deliberately small and readable: this is
 * clinical vocabulary a reviewer can check, not a learned model.
 */
const PILLAR_TERMS: Record<RroPillar, readonly string[]> = {
  nutrition: [
    'diet',
    'weight',
    'sugar',
    'glucose',
    'diabet',
    'cholesterol',
    'appetite',
    'bloat',
    'digest',
    'gut',
    'nutrition',
    'eating',
    'fatty liver',
  ],
  movement: [
    'exercise',
    'walk',
    'strength',
    'stamina',
    'mobility',
    'joint',
    'stiff',
    'muscle',
    'back pain',
    'sedentary',
    'fitness',
  ],
  sleep: ['sleep', 'insomnia', 'apnea', 'snor', 'tired on waking', 'restless', 'night'],
  stress: [
    'stress',
    'anxiety',
    'anxious',
    'burnout',
    'mood',
    'depress',
    'irritab',
    'overwhelm',
    'panic',
  ],
  environment: [
    'pollution',
    'air quality',
    'toxin',
    'mould',
    'mold',
    'allergy',
    'allergen',
    'dust',
    'smoking',
    'alcohol',
    'shift work',
  ],
};

/**
 * Findings that need a clinician's eyes before anything else happens. Severity
 * is triage urgency, not a diagnosis — the platform does not name diseases.
 */
const RED_FLAG_TERMS: readonly { match: string; severity: 'urgent' | 'emergency'; why: string }[] =
  [
    { match: 'chest pain', severity: 'emergency', why: 'Chest pain requires same-day assessment' },
    {
      match: 'shortness of breath',
      severity: 'emergency',
      why: 'Breathlessness requires same-day assessment',
    },
    {
      match: 'breathless',
      severity: 'emergency',
      why: 'Breathlessness requires same-day assessment',
    },
    { match: 'fainting', severity: 'urgent', why: 'Loss of consciousness needs review' },
    { match: 'blackout', severity: 'urgent', why: 'Loss of consciousness needs review' },
    { match: 'blood in stool', severity: 'urgent', why: 'Unexplained bleeding needs review' },
    { match: 'blood in urine', severity: 'urgent', why: 'Unexplained bleeding needs review' },
    {
      match: 'coughing blood',
      severity: 'emergency',
      why: 'Haemoptysis requires same-day assessment',
    },
    {
      match: 'sudden weight loss',
      severity: 'urgent',
      why: 'Unintended weight loss needs investigation',
    },
    {
      match: 'unexplained weight loss',
      severity: 'urgent',
      why: 'Unintended weight loss needs investigation',
    },
    { match: 'suicid', severity: 'emergency', why: 'Risk to life — escalate immediately' },
    { match: 'self harm', severity: 'emergency', why: 'Risk to life — escalate immediately' },
    { match: 'numbness on one side', severity: 'emergency', why: 'Possible neurological event' },
    { match: 'slurred speech', severity: 'emergency', why: 'Possible neurological event' },
    { match: 'severe headache', severity: 'urgent', why: 'Sudden severe headache needs review' },
  ];

function corpus(intake: RroClassifierInput['intake']): string {
  return [...intake.symptoms, ...intake.goals, ...intake.conditions, ...intake.medications]
    .join(' ')
    .toLowerCase();
}

/**
 * Rank pillars: the patient's own stated priorities first, in their order, then
 * any pillar the answers point at, then the rest. The patient's ranking is
 * evidence, not noise — but it does not hide a pillar the answers raise.
 */
function rankPillars(intake: RroClassifierInput['intake']): RroPillar[] {
  const text = corpus(intake);
  const stated = intake.pillarPriorities as RroPillar[];

  const scored = RRO_PILLARS.map((pillar) => ({
    pillar,
    hits: PILLAR_TERMS[pillar].filter((term) => text.includes(term)).length,
  }))
    .filter((entry) => entry.hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .map((entry) => entry.pillar);

  const ranked: RroPillar[] = [];
  for (const pillar of [...stated, ...scored, ...RRO_PILLARS]) {
    if (!ranked.includes(pillar)) ranked.push(pillar);
  }
  return ranked;
}

/**
 * Where the intake suggests the profile sits.
 *
 * A diagnosed condition or several symptoms means there is something to
 * reverse. A symptom or two with no condition means restoring function. Goals
 * with no symptoms and no conditions means optimising what already works.
 */
function deriveState(intake: RroClassifierInput['intake']): RroState {
  if (intake.conditions.length > 0 || intake.symptoms.length >= 3) return 'reverse';
  if (intake.symptoms.length > 0) return 'restore';
  return 'optimise';
}

/** What the intake did not say. Drives the follow-up questions. */
function missingFrom(intake: RroClassifierInput['intake']): string[] {
  const missing: string[] = [];
  if (intake.symptoms.length === 0) missing.push('Current symptoms');
  if (intake.goals.length === 0) missing.push('Health goals');
  if (intake.conditions.length === 0) missing.push('Diagnosed conditions');
  if (intake.medications.length === 0) missing.push('Current medications');
  if (intake.pillarPriorities.length === 0) missing.push('Pillar priorities');
  return missing;
}

/** How complete the intake is, 0–1, scaled into the advisory band. */
function confidenceFor(intake: RroClassifierInput['intake']): number {
  const filled = 5 - missingFrom(intake).length;
  const completeness = filled / 5;
  // Floor of 0.3 so a sparse but non-empty intake is still a usable signal.
  const scaled = 0.3 + completeness * (ADVISORY_CEILING - 0.3);
  return Math.round(scaled * 1000) / 1000;
}

export class RroRulesProvider implements RroAiProvider {
  readonly name = 'rules' as const;
  readonly modelId = null;

  async classify(input: RroClassifierInput): Promise<RroClassifierOutput | RroRefusal> {
    if (isEmptyIntake(input.intake)) {
      return {
        contractVersion: RRO_CONTRACT_VERSION,
        refused: true,
        reason: 'insufficient_data',
        detail:
          'The intake records no symptoms, goals or conditions. There is nothing to classify.',
      };
    }

    const state = deriveState(input.intake);
    const pillars = rankPillars(input.intake);
    const missing = missingFrom(input.intake);

    const basis: string[] = [];
    if (input.intake.conditions.length > 0) {
      basis.push(`${input.intake.conditions.length} reported condition(s)`);
    }
    if (input.intake.symptoms.length > 0) {
      basis.push(`${input.intake.symptoms.length} reported symptom(s)`);
    }
    if (input.intake.goals.length > 0) {
      basis.push(`${input.intake.goals.length} stated goal(s)`);
    }

    return {
      contractVersion: RRO_CONTRACT_VERSION,
      state,
      confidence: confidenceFor(input.intake),
      pillarPriorities: pillars.slice(0, RRO_PILLARS.length),
      rationale: `Deterministic baseline: ${basis.join(', ')} place this profile in '${state}'. Pillars ranked from the patient's stated priorities and terms found in the intake. Advisory only — this classifier cannot transition a profile.`,
      missingData: missing,
    };
  }

  async summarise(input: RroSummaryInput): Promise<RroSummaryOutput | RroRefusal> {
    if (isEmptyIntake(input.intake)) {
      return {
        contractVersion: RRO_CONTRACT_VERSION,
        concerns: [],
        missingData: missingFrom(input.intake),
        redFlags: [],
        suggestedQuestions: [
          'What symptoms brought you here, and when did they start?',
          'What would you most like to change about your health?',
        ],
        sufficientData: false,
      };
    }

    const text = corpus(input.intake);
    const redFlags = RED_FLAG_TERMS.filter((flag) => text.includes(flag.match)).map((flag) => ({
      finding: flag.match,
      severity: flag.severity,
      basis: flag.why,
    }));

    const concerns = [
      ...input.intake.conditions.map((c) => `Diagnosed: ${c}`),
      ...input.intake.symptoms.slice(0, 10).map((s) => `Reported: ${s}`),
    ].slice(0, 20);

    const pillars = rankPillars(input.intake).slice(0, 3);
    const questions = [
      'How long has the main concern been present, and what changes it?',
      `What has already been tried for ${pillars[0]}?`,
      input.intake.medications.length > 0
        ? 'Are the listed medications being taken as prescribed?'
        : 'Are any medications or supplements being taken?',
      `Current state is '${input.currentState}' — what would progress look like to the patient?`,
    ];

    return {
      contractVersion: RRO_CONTRACT_VERSION,
      concerns,
      missingData: missingFrom(input.intake),
      redFlags,
      suggestedQuestions: questions,
      sufficientData: true,
    };
  }
}
