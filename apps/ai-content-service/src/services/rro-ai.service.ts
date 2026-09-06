import { AppError, NotFoundError } from '@longeny/errors';
import type { RroState } from '@longeny/types';
import { ServiceCallError, createLogger, createServiceClient } from '@longeny/utils';
import {
  RRO_CONTRACT_VERSION,
  type RroClassifierInput,
  type RroClassifierOutput,
  type RroRefusal,
  type RroSummaryInput,
  type RroSummaryOutput,
  mayTransitionState,
  rroClassifierResponseSchema,
  rroSummaryResponseSchema,
} from '@longeny/validators';
import { desc, eq } from 'drizzle-orm';
import { config } from '../config/index.js';
import { db } from '../db/index.js';
import { rro_classifications, rro_summaries } from '../db/schema.js';
import type { IntakeService } from './intake.service.js';
import { RroBedrockProvider } from './rro/bedrock-provider.js';
import { RRO_PROMPT_VERSION } from './rro/prompts.js';
import type { RroAiProvider } from './rro/provider.js';
import { RroRulesProvider } from './rro/rules-provider.js';

const logger = createLogger('rro-ai');

/** Why a classification did not move the profile. Stored, so a refusal is explainable. */
type NotTransitionedReason =
  | 'refused'
  | 'low_confidence'
  | 'already_in_state'
  | 'invalid_transition'
  | 'transition_failed';

interface RroStateResponse {
  profileId: string;
  currentState: RroState | null;
  goal: string | null;
  history: { state: RroState; enteredAt: string; source: string }[];
}

/**
 * RRO classification and pre-consult summary.
 *
 * The order is fixed and matters:
 *
 *   1. Load the intake. No intake, nothing to classify.
 *   2. Ask the provider — the model, or the deterministic baseline.
 *   3. **Parse the answer against the shared contract.** Output that does not
 *      fit is a 502; it is never coerced and never stored. A model that invents
 *      a state is a defect to see, not one to round off.
 *   4. Store the result, including refusals and low-confidence results. Every
 *      attempt is evidence.
 *   5. Only then consider a transition, and only if the confidence floor and the
 *      taxonomy both allow it. user-provider validates the move again on its
 *      side, because it is reachable by callers other than this one.
 */
export class RroAiService {
  private readonly userProvider = createServiceClient(
    'ai-content-service',
    config.USER_PROVIDER_SERVICE_URL,
    config.HMAC_SECRET,
  );

  constructor(private readonly intakeService: IntakeService) {}

  /**
   * The configured provider.
   *
   * `bedrock` is only used when it is configured. There is deliberately no
   * automatic downgrade to `rules` on a model failure: the two produce
   * differently-trustworthy output, and silently swapping one for the other
   * would hide an outage behind results that look the same in the response.
   */
  private provider(): RroAiProvider {
    return config.RRO_AI_PROVIDER === 'bedrock' ? new RroBedrockProvider() : new RroRulesProvider();
  }

  async classify(profileId: string, ageBand?: RroClassifierInput['ageBand']) {
    const intake = await this.intakeService.latestForContract(profileId);
    if (!intake) throw new NotFoundError('Intake');

    const state = await this.fetchRroState(profileId);
    const provider = this.provider();

    const input: RroClassifierInput = {
      profileId,
      intake: intake.intake,
      history: state.history.map((h) => ({ state: h.state, enteredAt: h.enteredAt })),
      ageBand,
    };

    const started = Date.now();
    const raw = await provider.classify(input);
    const latencyMs = Date.now() - started;

    const parsed = rroClassifierResponseSchema.safeParse(raw);
    if (!parsed.success) {
      logger.error(
        { profileId, provider: provider.name, issues: parsed.error.issues },
        'Classifier output failed the contract — refusing to store it',
      );
      throw new AppError(
        'The classifier returned output that does not fit the contract',
        502,
        'AI_INVALID_RESPONSE',
      );
    }

    const output = parsed.data;
    const decision = this.transitionDecision(output, state.currentState);

    let transitioned = false;
    if (decision.allowed) {
      transitioned = await this.requestTransition(
        profileId,
        (output as RroClassifierOutput).state,
        (output as RroClassifierOutput).rationale,
      );
    }

    const [row] = await db
      .insert(rro_classifications)
      .values({
        profile_id: profileId,
        intake_id: intake.id,
        intake_version: intake.version,
        provider: provider.name,
        model_id: provider.modelId,
        contract_version: RRO_CONTRACT_VERSION,
        prompt_version: RRO_PROMPT_VERSION,
        state: 'refused' in output ? null : output.state,
        confidence: 'refused' in output ? null : output.confidence.toString(),
        pillar_priorities: 'refused' in output ? [] : output.pillarPriorities,
        rationale: 'refused' in output ? null : output.rationale,
        missing_data: 'refused' in output ? [] : output.missingData,
        refused_reason: 'refused' in output ? output.reason : null,
        refused_detail: 'refused' in output ? output.detail : null,
        transitioned,
        not_transitioned_reason: transitioned
          ? null
          : (decision.reason ?? ('transition_failed' as NotTransitionedReason)),
        latency_ms: latencyMs,
      })
      .returning();

    logger.info(
      { profileId, provider: provider.name, transitioned, reason: decision.reason },
      'Classification stored',
    );

    return { classification: this.presentClassification(row), output };
  }

  /**
   * May this classification move the profile on its own?
   *
   * Three separate gates, each with its own recorded reason, in this order:
   *  - a refusal never moves anything;
   *  - a result naming the state the profile is already in is not a move at all,
   *    whatever its confidence — this is checked before the floor, because
   *    recording `low_confidence` here would imply a better classifier would
   *    have moved the profile, and nothing would have;
   *  - confidence below the floor is advisory. This is what caps the rules
   *    provider, which cannot reach the floor by construction.
   *
   * The taxonomy's own check happens on the other side of the transition call,
   * in user-provider, because a clinician action reaches it too.
   */
  private transitionDecision(
    output: RroClassifierOutput | RroRefusal,
    currentState: RroState | null,
  ): { allowed: boolean; reason?: NotTransitionedReason } {
    if ('refused' in output) return { allowed: false, reason: 'refused' };
    if (currentState === output.state) return { allowed: false, reason: 'already_in_state' };
    if (!mayTransitionState(output)) return { allowed: false, reason: 'low_confidence' };
    return { allowed: true };
  }

  /**
   * Ask user-provider to record the move. It validates the transition again —
   * that route is reachable by a clinician action too — so a 422 here means the
   * taxonomy refused it, which is stored rather than raised: the classification
   * itself is still valid output and worth keeping.
   */
  private async requestTransition(
    profileId: string,
    toState: RroState,
    reason: string,
  ): Promise<boolean> {
    try {
      await this.userProvider.post('/internal/rro-state/transition', {
        profileId,
        toState,
        reason: reason.slice(0, 1000),
        source: 'ai_classifier',
      });
      return true;
    } catch (error) {
      if (error instanceof ServiceCallError && error.status === 422) {
        logger.warn({ profileId, toState }, 'Taxonomy refused the classifier’s transition');
        return false;
      }
      logger.error({ error, profileId, toState }, 'Transition call failed');
      return false;
    }
  }

  async summarise(profileId: string) {
    const intake = await this.intakeService.latestForContract(profileId);
    if (!intake) throw new NotFoundError('Intake');

    const state = await this.fetchRroState(profileId);
    const provider = this.provider();

    const input: RroSummaryInput = {
      profileId,
      intake: intake.intake,
      currentState: state.currentState ?? 'intake',
      reports: [],
    };

    const started = Date.now();
    const raw = await provider.summarise(input);
    const latencyMs = Date.now() - started;

    const parsed = rroSummaryResponseSchema.safeParse(raw);
    if (!parsed.success) {
      logger.error(
        { profileId, provider: provider.name, issues: parsed.error.issues },
        'Summary output failed the contract — refusing to store it',
      );
      throw new AppError(
        'The summariser returned output that does not fit the contract',
        502,
        'AI_INVALID_RESPONSE',
      );
    }

    const output = parsed.data;
    const refused = 'refused' in output;

    const [row] = await db
      .insert(rro_summaries)
      .values({
        profile_id: profileId,
        intake_id: intake.id,
        intake_version: intake.version,
        provider: provider.name,
        model_id: provider.modelId,
        contract_version: RRO_CONTRACT_VERSION,
        prompt_version: RRO_PROMPT_VERSION,
        current_state: state.currentState,
        concerns: refused ? [] : (output as RroSummaryOutput).concerns,
        missing_data: refused ? [] : (output as RroSummaryOutput).missingData,
        red_flags: refused ? [] : (output as RroSummaryOutput).redFlags,
        suggested_questions: refused ? [] : (output as RroSummaryOutput).suggestedQuestions,
        // A refusal is stored as insufficient data, which is exactly what it is.
        sufficient_data: refused ? false : (output as RroSummaryOutput).sufficientData,
        refused_reason: refused ? (output as RroRefusal).reason : null,
        refused_detail: refused ? (output as RroRefusal).detail : null,
        latency_ms: latencyMs,
      })
      .returning();

    return { summary: row, output };
  }

  /** Latest stored classification for a profile, or null. */
  async latestClassification(profileId: string) {
    const [row] = await db
      .select()
      .from(rro_classifications)
      .where(eq(rro_classifications.profile_id, profileId))
      .orderBy(desc(rro_classifications.created_at))
      .limit(1);
    return row ? this.presentClassification(row) : null;
  }

  /**
   * Latest stored summary for a profile, or null.
   *
   * `stale` says whether the intake has moved on since it was generated. The
   * workspace needs to know it is reading a summary of answers that have since
   * changed; deciding that here keeps every consumer from re-deriving it.
   */
  async latestSummary(profileId: string) {
    const [row] = await db
      .select()
      .from(rro_summaries)
      .where(eq(rro_summaries.profile_id, profileId))
      .orderBy(desc(rro_summaries.generated_at))
      .limit(1);
    if (!row) return null;

    const intake = await this.intakeService.latestForContract(profileId);
    return {
      ...row,
      stale: intake !== null && intake.version !== row.intake_version,
    };
  }

  /** Confidence is stored as numeric and comes back as a string; callers want a number. */
  private presentClassification(row: typeof rro_classifications.$inferSelect) {
    return {
      ...row,
      confidence: row.confidence === null ? null : Number(row.confidence),
    };
  }

  private async fetchRroState(profileId: string): Promise<RroStateResponse> {
    try {
      const response = await this.userProvider.get<{ data: RroStateResponse }>(
        `/internal/profiles/${profileId}/rro-state`,
      );
      return response.data;
    } catch (error) {
      if (error instanceof ServiceCallError && error.status === 404) {
        throw new NotFoundError('Profile');
      }
      throw error;
    }
  }
}
