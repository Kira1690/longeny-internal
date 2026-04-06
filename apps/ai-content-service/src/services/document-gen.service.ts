import { db } from '../db/index.js';
import { eq, and, sql } from 'drizzle-orm';
import { generated_documents, prompt_templates, documents } from '../db/schema.js';
import type { BedrockService } from './bedrock.service.js';
import type { SafetyService } from './safety.service.js';
import type { S3Service } from './s3.service.js';
import { config } from '../config/index.js';
import { createLogger, createServiceClient } from '@longeny/utils';
import { NotFoundError, ForbiddenError, BadRequestError } from '@longeny/errors';

const logger = createLogger('ai-content:document-gen');

const userProviderClient = createServiceClient(
  'ai-content-service',
  Bun.env.USER_PROVIDER_SERVICE_URL || 'http://localhost:3002',
  config.HMAC_SECRET,
);

// ── Default prompt templates for each document type ──
const DEFAULT_PROMPTS: Record<string, { system: string; user: string }> = {
  prescription: {
    system: `You are a clinical documentation assistant. Generate a structured prescription document based on provider input.
Output MUST be valid JSON with: { "sections": [...], "recommendations": [...], "disclaimers": [...] }
Each section: { "title": string, "content": string }
Never make independent medical decisions. Only structure the information provided by the healthcare provider.`,
    user: `Generate a prescription document with the following context:
Patient age range: {ageRange}
Provider specialty: {providerSpecialty}
Chief concern: {chiefConcern}
Provider notes: {providerNotes}
Additional context: {additionalContext}`,
  },
  nutrition_plan: {
    system: `You are a nutrition planning assistant. Generate a structured nutrition plan based on provider input and patient context.
Output MUST be valid JSON with: { "sections": [...], "recommendations": [...], "disclaimers": [...] }
Each section: { "title": string, "content": string }
Include daily/weekly structure, macronutrient guidelines, and meal suggestions.`,
    user: `Generate a nutrition plan with the following context:
Patient age range: {ageRange}
Health goals: {healthGoals}
Dietary restrictions: {dietaryRestrictions}
Fitness level: {fitnessLevel}
Provider notes: {providerNotes}
Additional context: {additionalContext}`,
  },
  training_plan: {
    system: `You are a fitness and training plan assistant. Generate a structured training plan based on provider input and patient context.
Output MUST be valid JSON with: { "sections": [...], "recommendations": [...], "disclaimers": [...] }
Each section: { "title": string, "content": string }
Include weekly schedule, exercise descriptions, progression plan, and safety guidelines.`,
    user: `Generate a training plan with the following context:
Patient age range: {ageRange}
Fitness level: {fitnessLevel}
Health goals: {healthGoals}
Medical considerations: {medicalConsiderations}
Equipment available: {equipment}
Provider notes: {providerNotes}
Additional context: {additionalContext}`,
  },
};

type AiDocumentType = 'prescription' | 'nutrition_plan' | 'training_plan';
type AiDocumentStatus = 'draft' | 'pending_review' | 'approved' | 'rejected';

interface GenerateDocumentInput {
  userId: string;
  providerId: string;
  documentType: AiDocumentType;
  title: string;
  patientContext: Record<string, string>;
  providerNotes?: string;
}

interface DocumentContent {
  sections: Array<{ title: string; content: string }>;
  recommendations: string[];
  disclaimers: string[];
}

export class DocumentGenService {
  constructor(
    _prismaUnused: unknown,
    private bedrockService: BedrockService,
    private safetyService: SafetyService,
    private s3Service: S3Service,
  ) {}

  /**
   * Generate an AI document (prescription, nutrition plan, or training plan).
   */
  async generate(input: GenerateDocumentInput, correlationId?: string): Promise<{
    id: string;
    content: DocumentContent;
    isMock: boolean;
  }> {
    const { userId, providerId, documentType, title, patientContext, providerNotes } = input;

    // 1. Load prompt template (DB or defaults)
    const template = await this.getPromptTemplate(documentType);

    // 2. Build prompt with PII stripped
    const contextStr = Object.entries(patientContext)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n');
    const fullContext = providerNotes
      ? `${contextStr}\nProvider notes: ${providerNotes}`
      : contextStr;

    const { sanitized, safetyLogId } = await this.safetyService.processInput(
      fullContext,
      userId,
      undefined,
      { dateOfBirth: patientContext.dateOfBirth },
    );

    // 3. Fill in template variables
    const userPrompt = this.fillTemplate(template.user, {
      ...patientContext,
      providerNotes: providerNotes || 'None provided',
      additionalContext: sanitized,
    });

    // 4. Call Bedrock
    const modelId = config.BEDROCK_MODEL_ID_PRIMARY;
    const aiResult = await this.bedrockService.invokeModel(
      modelId,
      template.system,
      userPrompt,
      3000,
      0.6,
      userId,
      'document_gen',
      correlationId,
    );

    // 5. Process output through safety
    const { processed } = await this.safetyService.processOutput(aiResult.text, safetyLogId);

    // 6. Parse structured response
    const content = this.parseDocumentContent(processed);

    // 7. Create GeneratedDocument record
    const [doc] = await db.insert(generated_documents).values({
      user_id: userId,
      provider_id: providerId,
      document_type: documentType,
      title,
      content: content as unknown as Record<string, unknown>,
      raw_ai_response: aiResult.text,
      status: 'draft',
      ai_model: aiResult.isMock ? `mock-${modelId}` : modelId,
    }).returning();

    logger.info(
      { docId: doc.id, documentType, providerId, isMock: aiResult.isMock },
      'AI document generated',
    );

    return { id: doc.id, content, isMock: aiResult.isMock };
  }

  /**
   * List generated documents for a provider.
   */
  async listDocuments(
    providerId: string,
    filters: { status?: AiDocumentStatus; documentType?: AiDocumentType; page: number; limit: number },
  ) {
    const conditions = [eq(generated_documents.provider_id, providerId)];

    if (filters.status) {
      conditions.push(eq(generated_documents.status, filters.status));
    }
    if (filters.documentType) {
      conditions.push(eq(generated_documents.document_type, filters.documentType));
    }

    const whereClause = and(...conditions);

    const [rows, [{ count }]] = await Promise.all([
      db
        .select({
          id: generated_documents.id,
          user_id: generated_documents.user_id,
          document_type: generated_documents.document_type,
          title: generated_documents.title,
          status: generated_documents.status,
          ai_model: generated_documents.ai_model,
          created_at: generated_documents.created_at,
          updated_at: generated_documents.updated_at,
          reviewed_at: generated_documents.reviewed_at,
          approved_at: generated_documents.approved_at,
        })
        .from(generated_documents)
        .where(whereClause)
        .orderBy(generated_documents.created_at)
        .limit(filters.limit)
        .offset((filters.page - 1) * filters.limit),
      db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(generated_documents)
        .where(whereClause),
    ]);

    return { documents: rows, total: count };
  }

  /**
   * Get document detail.
   */
  async getDocument(id: string, providerId: string) {
    const [doc] = await db
      .select()
      .from(generated_documents)
      .where(eq(generated_documents.id, id))
      .limit(1);

    if (!doc) throw new NotFoundError('GeneratedDocument', id);
    if (doc.provider_id !== providerId) throw new ForbiddenError('Access denied to this document');

    return doc;
  }

  /**
   * Provider approves a document (finalize).
   */
  async finalizeDocument(
    id: string,
    providerId: string,
    reviewNotes?: string,
  ) {
    const [doc] = await db
      .select()
      .from(generated_documents)
      .where(eq(generated_documents.id, id))
      .limit(1);

    if (!doc) throw new NotFoundError('GeneratedDocument', id);
    if (doc.provider_id !== providerId) throw new ForbiddenError('Access denied to this document');
    if (doc.status !== 'draft' && doc.status !== 'pending_review') {
      throw new BadRequestError('Document can only be finalized from draft or pending_review status');
    }

    const [updated] = await db
      .update(generated_documents)
      .set({
        status: 'approved',
        reviewed_by: providerId,
        reviewed_at: new Date(),
        review_notes: reviewNotes || null,
        approved_at: new Date(),
        updated_at: new Date(),
      })
      .where(eq(generated_documents.id, id))
      .returning();

    logger.info({ docId: id, providerId }, 'Document finalized/approved');
    return updated;
  }

  /**
   * Share document with patient by creating a Document vault entry.
   */
  async shareWithPatient(
    id: string,
    providerId: string,
  ) {
    const [doc] = await db
      .select()
      .from(generated_documents)
      .where(eq(generated_documents.id, id))
      .limit(1);

    if (!doc) throw new NotFoundError('GeneratedDocument', id);
    if (doc.provider_id !== providerId) throw new ForbiddenError('Access denied to this document');
    if (doc.status !== 'approved') {
      throw new BadRequestError('Only approved documents can be shared');
    }

    // Generate an S3 key for the document
    const s3Key = this.s3Service.buildGeneratedDocumentKey(providerId, doc.document_type, id);

    // Create a Document vault entry for the patient
    const [vaultDoc] = await db.insert(documents).values({
      owner_id: doc.user_id,
      owner_type: 'user',
      document_type: 'prescription',
      title: doc.title,
      description: `AI-generated ${doc.document_type.replace('_', ' ')} by provider`,
      file_key: s3Key,
      file_name: `${doc.title.replace(/\s+/g, '_')}.pdf`,
      file_size: BigInt(0), // Will be updated when PDF is actually generated
      mime_type: 'application/pdf',
      tags: JSON.stringify([doc.document_type, 'ai-generated']),
      ai_generated: true,
      ai_document_id: id,
      status: 'active',
    }).returning();

    // Update generated document with S3 key
    await db
      .update(generated_documents)
      .set({ s3_file_key: s3Key, updated_at: new Date() })
      .where(eq(generated_documents.id, id));

    logger.info({ docId: id, vaultDocId: vaultDoc.id, userId: doc.user_id }, 'Document shared with patient');
    return { vaultDocumentId: vaultDoc.id, s3Key };
  }

  /**
   * Get a presigned download URL for the document PDF.
   */
  async getDownloadUrl(id: string, providerId: string) {
    const [doc] = await db
      .select()
      .from(generated_documents)
      .where(eq(generated_documents.id, id))
      .limit(1);

    if (!doc) throw new NotFoundError('GeneratedDocument', id);
    if (doc.provider_id !== providerId) throw new ForbiddenError('Access denied to this document');

    if (!doc.s3_file_key) {
      // If no S3 key exists yet, return the content as JSON download
      return { content: doc.content, format: 'json' };
    }

    const { downloadUrl, expiresIn } = await this.s3Service.generateDownloadUrl(doc.s3_file_key);
    return { downloadUrl, expiresIn, format: 'pdf' };
  }

  private async getPromptTemplate(documentType: AiDocumentType): Promise<{ system: string; user: string }> {
    // Try to load from DB
    const [template] = await db
      .select()
      .from(prompt_templates)
      .where(
        and(
          eq(prompt_templates.category, documentType),
          eq(prompt_templates.status, 'active'),
        ),
      )
      .orderBy(prompt_templates.version)
      .limit(1);

    if (template) {
      return {
        system: template.system_prompt,
        user: template.user_prompt_template,
      };
    }

    // Fall back to defaults
    return DEFAULT_PROMPTS[documentType] || DEFAULT_PROMPTS.prescription;
  }

  private fillTemplate(template: string, variables: Record<string, string>): string {
    let result = template;
    for (const [key, value] of Object.entries(variables)) {
      result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value || 'Not provided');
    }
    // Replace any unfilled variables
    result = result.replace(/\{[a-zA-Z]+\}/g, 'Not provided');
    return result;
  }

  private parseDocumentContent(text: string): DocumentContent {
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          sections: Array.isArray(parsed.sections) ? parsed.sections : [],
          recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : [],
          disclaimers: Array.isArray(parsed.disclaimers)
            ? parsed.disclaimers
            : ['This document was AI-generated and requires professional review.'],
        };
      }
    } catch {
      logger.warn('Failed to parse document content as JSON');
    }

    // Fallback: treat as single-section document
    return {
      sections: [{ title: 'Content', content: text }],
      recommendations: [],
      disclaimers: ['This document was AI-generated and requires professional review.'],
    };
  }
}
