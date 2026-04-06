import { db } from '../db/index.js';
import { eq } from 'drizzle-orm';
import { recommendation_cache } from '../db/schema.js';
import Redis from 'ioredis';
import type { BedrockService } from './bedrock.service.js';
import type { EmbeddingService, EmbeddingEntityType } from './embedding.service.js';
import type { SafetyService } from './safety.service.js';
import { config, redisUrl } from '../config/index.js';
import { createLogger, createServiceClient } from '@longeny/utils';

const logger = createLogger('ai-content:recommendation');

const CACHE_TTL = 3600; // 1 hour in seconds

export type RecommendationType = 'providers' | 'programs' | 'products' | 'mixed';

interface UserHealthProfile {
  healthGoals?: string[];
  fitnessLevel?: string;
  medicalConditions?: string[];
  medications?: string[];
  allergies?: string[];
  preferences?: Record<string, unknown>;
  dateOfBirth?: string;
}

interface RecommendationItem {
  entityType: string;
  entityId: string;
  score: number;
  explanation: string;
  matchFactors: string[];
  metadata: Record<string, unknown>;
}

export interface RecommendationResult {
  recommendations: RecommendationItem[];
  summary: string;
  scoreBreakdown: Record<string, unknown>;
  modelUsed: string;
  isMock: boolean;
  cached: boolean;
}

const userProviderClient = createServiceClient(
  'ai-content-service',
  Bun.env.USER_PROVIDER_SERVICE_URL || 'http://localhost:3002',
  config.HMAC_SECRET,
);

export class RecommendationService {
  private redis: Redis;

  constructor(
    _prismaUnused: unknown,
    private bedrockService: BedrockService,
    private embeddingService: EmbeddingService,
    private safetyService: SafetyService,
  ) {
    this.redis = new Redis(redisUrl);
  }

  /**
   * Get personalized recommendations (RAG pipeline).
   */
  async getRecommendations(
    userId: string,
    type: RecommendationType,
    limit: number = 10,
    correlationId?: string,
  ): Promise<RecommendationResult> {
    // 1. Check Redis cache
    const cacheKey = `recommendations:${userId}:${type}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      logger.debug({ userId, type }, 'Returning cached recommendations');
      const parsed = JSON.parse(cached) as RecommendationResult;
      return { ...parsed, cached: true };
    }

    // 2. Fetch user health profile via HMAC call
    const userProfile = await this.fetchUserProfile(userId);

    // 3. Build query text from profile
    const queryText = this.buildQueryText(userProfile, type);

    // 4. Strip PII from query text
    const { sanitized } = await this.safetyService.processInput(
      queryText,
      userId,
      undefined,
      { dateOfBirth: userProfile.dateOfBirth },
    );

    // 5. Generate query embedding
    const embeddingResult = await this.bedrockService.generateEmbedding(sanitized, userId, correlationId);

    // 6. Similarity search
    const entityType = this.mapRecommendationTypeToEntityType(type);
    const similarResults = await this.embeddingService.similaritySearch(
      embeddingResult.embedding,
      entityType,
      limit * 2, // Fetch more for re-ranking
    );

    // 7. Build LLM prompt with search results as context
    const systemPrompt = `You are a healthcare recommendation assistant. Based on the user's health profile and the candidate ${type}, provide personalized recommendations with explanations.
Always respond in valid JSON format with the following structure:
{
  "recommendations": [{ "rank": number, "entityId": string, "score": number, "explanation": string, "matchFactors": string[] }],
  "summary": string
}
Never provide medical diagnoses. Focus on matching user preferences and goals to available options.`;

    const contextStr = similarResults
      .map((r, i) => `${i + 1}. [${r.entity_id}] Similarity: ${Number(r.similarity).toFixed(3)} | ${JSON.stringify(r.metadata)}`)
      .join('\n');

    const userPrompt = `User Profile (anonymized): ${sanitized}

Available ${type} (ranked by initial similarity):
${contextStr}

Please re-rank and explain the top ${limit} recommendations for this user.`;

    // 8. Call Bedrock for re-ranking
    const modelId = config.BEDROCK_MODEL_ID_PRIMARY;
    const aiResult = await this.bedrockService.invokeModel(
      modelId,
      systemPrompt,
      userPrompt,
      2000,
      0.5,
      userId,
      'recommendation',
      correlationId,
    );

    // 9. Parse LLM response
    const { processed } = await this.safetyService.processOutput(aiResult.text);
    const recommendations = this.parseRecommendations(processed, similarResults, limit);

    // 10. Build result
    const result: RecommendationResult = {
      recommendations: recommendations.items,
      summary: recommendations.summary,
      scoreBreakdown: {
        profileMatch: 'based on health goals and preferences',
        similarityWeighted: true,
        llmReranked: !aiResult.isMock,
      },
      modelUsed: modelId,
      isMock: aiResult.isMock,
      cached: false,
    };

    // 11. Cache in Redis
    await this.redis.set(cacheKey, JSON.stringify(result), 'EX', CACHE_TTL);

    // 12. Persist in recommendation_cache table (upsert pattern)
    const expiresAt = new Date(Date.now() + CACHE_TTL * 1000);

    const [existingCache] = await db
      .select()
      .from(recommendation_cache)
      .where(
        eq(recommendation_cache.user_id, userId),
      )
      .limit(1);

    const cacheData = {
      results: recommendations.items as unknown as Record<string, unknown>[],
      score_breakdown: result.scoreBreakdown,
      query_context: { type, sanitizedQuery: sanitized.substring(0, 200) },
      model_used: modelId,
      generated_at: new Date(),
      expires_at: expiresAt,
    };

    if (existingCache && (existingCache.recommendation_type as string) === type) {
      await db
        .update(recommendation_cache)
        .set(cacheData)
        .where(eq(recommendation_cache.id, existingCache.id));
    } else {
      await db
        .insert(recommendation_cache)
        .values({
          user_id: userId,
          recommendation_type: type,
          ...cacheData,
        })
        .onConflictDoUpdate({
          target: [recommendation_cache.user_id, recommendation_cache.recommendation_type],
          set: cacheData,
        });
    }

    logger.info(
      { userId, type, count: recommendations.items.length, isMock: aiResult.isMock },
      'Recommendations generated',
    );

    return result;
  }

  /**
   * Submit feedback on a recommendation.
   */
  async submitFeedback(
    userId: string,
    recommendationId: string,
    feedback: { rating: number; helpful: boolean; comment?: string },
  ): Promise<void> {
    const [cache] = await db
      .select()
      .from(recommendation_cache)
      .where(eq(recommendation_cache.id, recommendationId))
      .limit(1);

    if (!cache || cache.user_id !== userId) {
      throw new Error('Recommendation not found');
    }

    // Update the score_breakdown with feedback
    const scoreBreakdown = (cache.score_breakdown as Record<string, unknown>) || {};
    scoreBreakdown.userFeedback = {
      rating: feedback.rating,
      helpful: feedback.helpful,
      comment: feedback.comment,
      submittedAt: new Date().toISOString(),
    };

    await db
      .update(recommendation_cache)
      .set({ score_breakdown: scoreBreakdown })
      .where(eq(recommendation_cache.id, recommendationId));

    // Invalidate cache so next request regenerates
    await this.redis.del(`recommendations:${userId}:${cache.recommendation_type}`);

    logger.info({ userId, recommendationId, rating: feedback.rating }, 'Recommendation feedback submitted');
  }

  private async fetchUserProfile(userId: string): Promise<UserHealthProfile> {
    try {
      const profile = await userProviderClient.get<{ data: UserHealthProfile }>(
        `/internal/users/${userId}/health-profile`,
      );
      return profile.data || {};
    } catch (error) {
      logger.warn({ userId, error }, 'Failed to fetch user health profile, using empty profile');
      return {};
    }
  }

  private buildQueryText(profile: UserHealthProfile, type: RecommendationType): string {
    const parts: string[] = [];

    if (profile.healthGoals?.length) {
      parts.push(`Health goals: ${profile.healthGoals.join(', ')}`);
    }
    if (profile.fitnessLevel) {
      parts.push(`Fitness level: ${profile.fitnessLevel}`);
    }
    if (profile.preferences) {
      parts.push(`Preferences: ${JSON.stringify(profile.preferences)}`);
    }

    parts.push(`Looking for: ${type}`);

    return parts.join('. ') || `General ${type} recommendations`;
  }

  private mapRecommendationTypeToEntityType(type: RecommendationType): EmbeddingEntityType {
    switch (type) {
      case 'providers': return 'provider';
      case 'programs': return 'program';
      case 'products': return 'product';
      default: return 'provider';
    }
  }

  private parseRecommendations(
    llmResponse: string,
    similarResults: Array<{ entity_id: string; entity_type: string; similarity: number; metadata: unknown }>,
    limit: number,
  ): { items: RecommendationItem[]; summary: string } {
    try {
      // Try to extract JSON from the response
      const jsonMatch = llmResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        const recs = (parsed.recommendations || []).slice(0, limit).map((rec: Record<string, unknown>, index: number) => {
          const similarMatch = similarResults.find((s) => s.entity_id === rec.entityId);
          return {
            entityType: similarMatch?.entity_type || 'unknown',
            entityId: (rec.entityId as string) || similarResults[index]?.entity_id || 'unknown',
            score: Number(rec.score) || Number(similarMatch?.similarity) || 0,
            explanation: (rec.explanation as string) || 'Matched based on similarity search.',
            matchFactors: (rec.matchFactors as string[]) || ['similarity'],
            metadata: (similarMatch?.metadata as Record<string, unknown>) || {},
          };
        });

        return {
          items: recs,
          summary: (parsed.summary as string) || 'Recommendations generated based on your profile.',
        };
      }
    } catch {
      logger.warn('Failed to parse LLM recommendation response, using similarity results');
    }

    // Fallback: use similarity results directly
    const items = similarResults.slice(0, limit).map((r) => ({
      entityType: r.entity_type,
      entityId: r.entity_id,
      score: Number(r.similarity),
      explanation: 'Matched based on profile similarity.',
      matchFactors: ['similarity'],
      metadata: (r.metadata as Record<string, unknown>) || {},
    }));

    return {
      items,
      summary: 'Recommendations based on similarity matching.',
    };
  }

  async disconnect(): Promise<void> {
    await this.redis.quit();
  }
}
