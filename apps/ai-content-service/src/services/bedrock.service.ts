import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { db } from '../db/index.js';
import { ai_requests } from '../db/schema.js';
import { config } from '../config/index.js';
import { createLogger } from '@longeny/utils';

const logger = createLogger('ai-content:bedrock');

// ── Llama 3.1 prompt format ──
function formatLlama31Prompt(system: string, user: string): string {
  return `<|begin_of_text|><|start_header_id|>system<|end_header_id|>\n${system}\n<|start_header_id|>user<|end_header_id|>\n${user}<|start_header_id|>assistant<|end_header_id|>`;
}

// ── Cost estimation (USD per 1K tokens) ──
const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  'meta.llama3-1-70b-instruct-v1:0': { input: 0.00265, output: 0.0035 },
  'meta.llama3-1-8b-instruct-v1:0': { input: 0.0003, output: 0.0006 },
  'amazon.titan-embed-text-v2:0': { input: 0.0002, output: 0 },
};

function estimateCost(modelId: string, promptTokens: number, completionTokens: number): number {
  const costs = MODEL_COSTS[modelId] || { input: 0.001, output: 0.002 };
  return (promptTokens / 1000) * costs.input + (completionTokens / 1000) * costs.output;
}

// Rough token estimation (4 chars ~ 1 token)
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

let bedrockClient: BedrockRuntimeClient | null = null;
let bedrockAvailable = true;

function getBedrockClient(): BedrockRuntimeClient {
  if (!bedrockClient) {
    bedrockClient = new BedrockRuntimeClient({
      region: config.AWS_BEDROCK_REGION,
      credentials: {
        accessKeyId: config.AWS_ACCESS_KEY_ID,
        secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
      },
      ...(config.NODE_ENV === 'development' && config.AWS_ENDPOINT_URL !== 'http://localhost:4566'
        ? { endpoint: config.AWS_ENDPOINT_URL }
        : {}),
    });
  }
  return bedrockClient;
}

export interface InvokeModelResult {
  text: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCost: number;
  isMock: boolean;
}

export interface EmbeddingResult {
  embedding: number[];
  promptTokens: number;
  isMock: boolean;
}

export class BedrockService {
  constructor(_prismaUnused: unknown) {}

  /**
   * Invoke a Bedrock model (Llama 3.1) with system + user prompt.
   * Falls back to mock response if Bedrock is unavailable.
   */
  async invokeModel(
    modelId: string,
    systemPrompt: string,
    userPrompt: string,
    maxTokens: number = 2000,
    temperature: number = 0.7,
    userId?: string,
    requestType: 'recommendation' | 'health_analysis' | 'document_gen' = 'recommendation',
    correlationId?: string,
  ): Promise<InvokeModelResult> {
    const startTime = Date.now();
    const prompt = formatLlama31Prompt(systemPrompt, userPrompt);
    const promptTokens = estimateTokens(prompt);

    // Try real Bedrock call
    if (bedrockAvailable) {
      try {
        const client = getBedrockClient();

        const body = JSON.stringify({
          prompt,
          max_gen_len: maxTokens,
          temperature,
          top_p: 0.9,
        });

        const command = new InvokeModelCommand({
          modelId,
          contentType: 'application/json',
          accept: 'application/json',
          body: new TextEncoder().encode(body),
        });

        const response = await client.send(command);
        const responseBody = JSON.parse(new TextDecoder().decode(response.body));
        const text = responseBody.generation || responseBody.completion || '';
        const completionTokens = estimateTokens(text);
        const totalTokens = promptTokens + completionTokens;
        const cost = estimateCost(modelId, promptTokens, completionTokens);
        const latency = Date.now() - startTime;

        // Track in ai_requests
        await db.insert(ai_requests).values({
          user_id: userId || null,
          request_type: requestType,
          model: modelId,
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: totalTokens,
          estimated_cost: cost.toString(),
          latency_ms: latency,
          status: 'completed',
          correlation_id: correlationId || null,
        });

        return { text, promptTokens, completionTokens, totalTokens, estimatedCost: cost, isMock: false };
      } catch (error) {
        logger.warn({ error }, 'Bedrock invocation failed, falling back to mock');
        bedrockAvailable = false;

        // Schedule re-check after 5 minutes
        setTimeout(() => {
          bedrockAvailable = true;
          logger.info('Bedrock availability re-enabled for next check');
        }, 5 * 60 * 1000);
      }
    }

    // ── Mock fallback ──
    return this.mockInvokeModel(modelId, systemPrompt, userPrompt, maxTokens, userId, requestType, correlationId, startTime);
  }

  /**
   * Generate embedding using Amazon Titan Embeddings V2.
   * Returns 1024-dimension vector.
   */
  async generateEmbedding(
    text: string,
    userId?: string,
    correlationId?: string,
  ): Promise<EmbeddingResult> {
    const modelId = config.BEDROCK_EMBEDDING_MODEL_ID;
    const promptTokens = estimateTokens(text);

    if (bedrockAvailable) {
      try {
        const client = getBedrockClient();

        const body = JSON.stringify({
          inputText: text,
          dimensions: 1024,
          normalize: true,
        });

        const command = new InvokeModelCommand({
          modelId,
          contentType: 'application/json',
          accept: 'application/json',
          body: new TextEncoder().encode(body),
        });

        const response = await client.send(command);
        const responseBody = JSON.parse(new TextDecoder().decode(response.body));
        const embedding: number[] = responseBody.embedding;
        const cost = estimateCost(modelId, promptTokens, 0);

        await db.insert(ai_requests).values({
          user_id: userId || null,
          request_type: 'embedding',
          model: modelId,
          prompt_tokens: promptTokens,
          completion_tokens: 0,
          total_tokens: promptTokens,
          estimated_cost: cost.toString(),
          status: 'completed',
          correlation_id: correlationId || null,
        });

        return { embedding, promptTokens, isMock: false };
      } catch (error) {
        logger.warn({ error }, 'Bedrock embedding failed, falling back to mock');
        bedrockAvailable = false;

        setTimeout(() => {
          bedrockAvailable = true;
        }, 5 * 60 * 1000);
      }
    }

    // ── Mock fallback: generate deterministic pseudo-random 1024-dim vector ──
    return this.mockGenerateEmbedding(text, modelId, promptTokens, userId, correlationId);
  }

  private async mockInvokeModel(
    modelId: string,
    systemPrompt: string,
    userPrompt: string,
    maxTokens: number,
    userId?: string,
    requestType: 'recommendation' | 'health_analysis' | 'document_gen' = 'recommendation',
    correlationId?: string,
    startTime?: number,
  ): Promise<InvokeModelResult> {
    const start = startTime || Date.now();
    const promptTokens = estimateTokens(systemPrompt + userPrompt);

    const mockResponse = this.generateMockResponse(requestType, userPrompt);
    const completionTokens = estimateTokens(mockResponse);
    const totalTokens = promptTokens + completionTokens;
    const latency = Date.now() - start;

    await db.insert(ai_requests).values({
      user_id: userId || null,
      request_type: requestType,
      model: `mock-${modelId}`,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: totalTokens,
      estimated_cost: '0',
      latency_ms: latency,
      status: 'completed',
      correlation_id: correlationId || null,
    });

    logger.info({ modelId, requestType, isMock: true }, 'Returned mock AI response');

    return {
      text: mockResponse,
      promptTokens,
      completionTokens,
      totalTokens,
      estimatedCost: 0,
      isMock: true,
    };
  }

  private async mockGenerateEmbedding(
    text: string,
    modelId: string,
    promptTokens: number,
    userId?: string,
    correlationId?: string,
  ): Promise<EmbeddingResult> {
    // Generate deterministic pseudo-random embedding from text hash
    const embedding = new Array(1024).fill(0).map((_, i) => {
      let hash = 0;
      const seed = text + i.toString();
      for (let j = 0; j < seed.length; j++) {
        const char = seed.charCodeAt(j);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
      }
      return (hash % 10000) / 10000; // Normalize to [-1, 1] range approx
    });

    // Normalize the vector
    const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    const normalized = embedding.map((val) => val / (magnitude || 1));

    await db.insert(ai_requests).values({
      user_id: userId || null,
      request_type: 'embedding',
      model: `mock-${modelId}`,
      prompt_tokens: promptTokens,
      completion_tokens: 0,
      total_tokens: promptTokens,
      estimated_cost: '0',
      status: 'completed',
      correlation_id: correlationId || null,
    });

    logger.info({ isMock: true }, 'Returned mock embedding');

    return { embedding: normalized, promptTokens, isMock: true };
  }

  private generateMockResponse(requestType: string, userPrompt: string): string {
    const disclaimer = '[MOCK RESPONSE - Bedrock unavailable in local development]';

    switch (requestType) {
      case 'recommendation':
        return JSON.stringify({
          _disclaimer: disclaimer,
          recommendations: [
            {
              rank: 1,
              entityId: 'mock-entity-1',
              score: 0.92,
              explanation: 'Highly relevant based on your health profile and goals. This provider specializes in areas matching your needs.',
              matchFactors: ['specialty_match', 'location', 'availability'],
            },
            {
              rank: 2,
              entityId: 'mock-entity-2',
              score: 0.85,
              explanation: 'Strong match for your wellness objectives with excellent patient reviews.',
              matchFactors: ['specialty_match', 'reviews', 'experience'],
            },
            {
              rank: 3,
              entityId: 'mock-entity-3',
              score: 0.78,
              explanation: 'Good overall fit with competitive pricing and flexible scheduling.',
              matchFactors: ['price', 'availability', 'specialty_match'],
            },
          ],
          summary: 'Based on your profile, we found 3 strong matches. The top recommendation excels in your primary health focus areas.',
        });

      case 'document_gen':
        return JSON.stringify({
          _disclaimer: disclaimer,
          sections: [
            {
              title: 'Overview',
              content: 'This document has been generated based on the provided patient context and clinical parameters.',
            },
            {
              title: 'Recommendations',
              content: 'Based on the available information, the following recommendations are provided for consideration by the supervising healthcare provider.',
            },
            {
              title: 'Notes',
              content: 'This AI-generated content requires provider review and approval before sharing with the patient.',
            },
          ],
          recommendations: [
            'Recommendation 1: Follow up with primary care provider',
            'Recommendation 2: Continue current treatment plan',
            'Recommendation 3: Schedule follow-up in 4 weeks',
          ],
          disclaimers: [
            'This document was AI-generated and must be reviewed by a licensed healthcare provider.',
            'This does not constitute medical advice or a clinical diagnosis.',
          ],
        });

      default:
        return JSON.stringify({
          _disclaimer: disclaimer,
          response: 'Mock response for development. Connect AWS Bedrock for production AI capabilities.',
        });
    }
  }
}
