import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { AppError, ServiceUnavailableError } from '@longeny/errors';
import { createLogger } from '@longeny/utils';
import type {
  RroClassifierInput,
  RroClassifierOutput,
  RroRefusal,
  RroSummaryInput,
  RroSummaryOutput,
} from '@longeny/validators';
import { config } from '../../config/index.js';
import {
  CLASSIFIER_SYSTEM_PROMPT,
  SUMMARY_SYSTEM_PROMPT,
  buildClassifierPrompt,
  buildSummaryPrompt,
} from './prompts.js';
import type { RroAiProvider } from './provider.js';

const logger = createLogger('rro-bedrock');

/**
 * The model behind the RRO endpoints.
 *
 * Unlike `BedrockService`, this provider has **no mock fallback**. That service
 * answers a failed Bedrock call with a fabricated response and a warning line,
 * which is tolerable for a content recommendation and unacceptable here: a made
 * up care-pathway classification, stored and shown to a clinician as a real one,
 * is the worst failure this system can produce. When the model cannot be
 * reached, the endpoint returns 503 and nothing is written.
 *
 * The raw text is returned to the caller, which parses it against the shared
 * contract. Parsing lives there, not here, so both providers are held to the
 * same schema.
 */
export class RroBedrockProvider implements RroAiProvider {
  readonly name = 'bedrock' as const;
  readonly modelId = config.BEDROCK_MODEL_ID_RRO;

  private client: BedrockRuntimeClient | null = null;

  private getClient(): BedrockRuntimeClient {
    if (!this.client) {
      // Only hand the SDK explicit keys when there are real ones to hand it.
      //
      // `AWS_ACCESS_KEY_ID` defaults to the literal `'test'` for LocalStack, and
      // an explicit credential — even a placeholder — wins over every other
      // source in the SDK's chain. So passing it unconditionally silently
      // disables IAM roles: the dev box was given a least-privilege instance
      // role for exactly this call and Bedrock still answered
      // `UnrecognizedClientException`, because the client was signing with the
      // word "test".
      //
      // Falling through to the default chain is what makes a role work in
      // deployment while a developer's `.env` keys still work locally. It is
      // also the safer default: no long-lived key has to sit on the box.
      const hasRealKeys =
        config.AWS_ACCESS_KEY_ID !== 'test' && config.AWS_SECRET_ACCESS_KEY !== 'test';

      this.client = new BedrockRuntimeClient({
        region: config.AWS_BEDROCK_REGION,
        ...(hasRealKeys
          ? {
              credentials: {
                accessKeyId: config.AWS_ACCESS_KEY_ID,
                secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
              },
            }
          : {}),
      });

      logger.info(
        { region: config.AWS_BEDROCK_REGION, modelId: this.modelId, explicitKeys: hasRealKeys },
        'Bedrock RRO client created',
      );
    }
    return this.client;
  }

  async classify(input: RroClassifierInput): Promise<RroClassifierOutput | RroRefusal> {
    const text = await this.invoke(CLASSIFIER_SYSTEM_PROMPT, buildClassifierPrompt(input), 1200);
    return parseJsonObject(text) as RroClassifierOutput | RroRefusal;
  }

  async summarise(input: RroSummaryInput): Promise<RroSummaryOutput | RroRefusal> {
    const text = await this.invoke(SUMMARY_SYSTEM_PROMPT, buildSummaryPrompt(input), 1600);
    return parseJsonObject(text) as RroSummaryOutput | RroRefusal;
  }

  /**
   * One Anthropic Messages call on Bedrock. Temperature is 0: the same intake
   * should classify the same way twice, and a clinical decision is not the place
   * for sampling variety.
   */
  private async invoke(system: string, user: string, maxTokens: number): Promise<string> {
    const body = JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: maxTokens,
      temperature: 0,
      system,
      messages: [{ role: 'user', content: [{ type: 'text', text: user }] }],
    });

    try {
      const response = await this.getClient().send(
        new InvokeModelCommand({
          modelId: this.modelId,
          contentType: 'application/json',
          accept: 'application/json',
          body: new TextEncoder().encode(body),
        }),
      );

      const parsed = JSON.parse(new TextDecoder().decode(response.body)) as {
        content?: { type: string; text?: string }[];
      };
      const text = parsed.content?.find((part) => part.type === 'text')?.text ?? '';
      if (!text) {
        throw new AppError('Model returned no text', 502, 'AI_INVALID_RESPONSE');
      }
      return text;
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.error({ error, modelId: this.modelId }, 'Bedrock RRO invocation failed');
      throw new ServiceUnavailableError('bedrock');
    }
  }
}

/**
 * Pull the JSON object out of a model reply.
 *
 * Models sometimes wrap JSON in a code fence or add a sentence around it even
 * when told not to. Recovering the object is fair; repairing its contents is
 * not — anything that does not parse is a 502, and the schema check that follows
 * decides whether the contents are acceptable.
 */
function parseJsonObject(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced?.[1] ?? text).trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');

  if (start === -1 || end <= start) {
    throw new AppError('Model reply contained no JSON object', 502, 'AI_INVALID_RESPONSE');
  }

  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    throw new AppError('Model reply was not valid JSON', 502, 'AI_INVALID_RESPONSE');
  }
}
