/**
 * RRO taxonomy — the one definition.
 *
 * The care model has four states and five pillars. Before this file they were
 * about to be written down three times: a Postgres enum, a Zod validator, and
 * the AI prompt contract. Everything derives from here instead, so a state added
 * to the model cannot be added to two of the three and forgotten in the last.
 */

/** Where a profile sits in the care journey. Order is the intended progression. */
export const RRO_STATES = ['intake', 'reverse', 'restore', 'optimise'] as const;
export type RroState = (typeof RRO_STATES)[number];

/**
 * The lifestyle pillars a care plan works across. The classifier ranks these
 * per profile; a care plan targets one or more.
 */
export const RRO_PILLARS = ['nutrition', 'movement', 'sleep', 'stress', 'environment'] as const;
export type RroPillar = (typeof RRO_PILLARS)[number];

/** Who or what caused a state transition. Every transition records one. */
export const RRO_TRANSITION_SOURCES = [
  'system',
  'ai_classifier',
  'clinician',
  'patient',
  'admin',
] as const;
export type RroTransitionSource = (typeof RRO_TRANSITION_SOURCES)[number];

/** How a profile relates to the account that owns it. */
export const PROFILE_RELATIONS = [
  'self',
  'father',
  'mother',
  'spouse',
  'child',
  'sibling',
  'other',
] as const;
export type ProfileRelation = (typeof PROFILE_RELATIONS)[number];

/** Channels a dependent profile can be reached on. They have no login. */
export const NOTIFICATION_CHANNELS = ['sms', 'email', 'calendar'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/**
 * Transitions the model permits. Care can move forward, hold, or fall back a
 * step when a profile regresses — it cannot skip from intake to optimise.
 */
const ALLOWED_TRANSITIONS: Record<RroState, readonly RroState[]> = {
  intake: ['reverse'],
  reverse: ['restore', 'intake'],
  restore: ['optimise', 'reverse'],
  optimise: ['restore'],
};

export function isValidRroTransition(from: RroState, to: RroState): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** The next state in the intended progression, or null at the end of it. */
export function nextRroState(current: RroState): RroState | null {
  const index = RRO_STATES.indexOf(current);
  return index >= 0 && index < RRO_STATES.length - 1 ? (RRO_STATES[index + 1] as RroState) : null;
}
