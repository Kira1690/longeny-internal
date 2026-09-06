import type {
  RroClassifierInput,
  RroClassifierOutput,
  RroRefusal,
  RroSummaryInput,
  RroSummaryOutput,
} from '@longeny/validators';

/**
 * The two implementations behind the RRO endpoints.
 *
 * `bedrock` is the model. `rules` is a deterministic baseline over the same
 * taxonomy — a real implementation, not a stand-in: it runs in production
 * whenever the model is unavailable, its output is stored with
 * `provider: 'rules'`, and its confidence is capped below the transition floor
 * so it can inform a clinician and can never move a profile on its own.
 *
 * Both return contract-valid output or an explicit refusal. Neither is
 * permitted to return something half-filled, and the caller validates whatever
 * comes back before storing it.
 */
export interface RroAiProvider {
  readonly name: 'bedrock' | 'rules';
  /** Model identifier for the audit row, or null for a provider with no model. */
  readonly modelId: string | null;
  classify(input: RroClassifierInput): Promise<RroClassifierOutput | RroRefusal>;
  summarise(input: RroSummaryInput): Promise<RroSummaryOutput | RroRefusal>;
}
