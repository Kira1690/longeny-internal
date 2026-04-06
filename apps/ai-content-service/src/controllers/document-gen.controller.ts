import type { DocumentGenService } from '../services/document-gen.service.js';
import { BadRequestError } from '@longeny/errors';
import { buildPaginationMeta } from '@longeny/utils';

type AiDocumentType = 'prescription' | 'nutrition_plan' | 'training_plan';
type AiDocumentStatus = 'draft' | 'pending_review' | 'approved' | 'rejected';

export class DocumentGenController {
  constructor(private documentGenService: DocumentGenService) {}

  /**
   * POST /ai/documents/prescription
   */
  generatePrescription = async (ctx: any) => {
    return this.generateDocument(ctx, 'prescription');
  };

  /**
   * POST /ai/documents/nutrition-plan
   */
  generateNutritionPlan = async (ctx: any) => {
    return this.generateDocument(ctx, 'nutrition_plan');
  };

  /**
   * POST /ai/documents/training-plan
   */
  generateTrainingPlan = async (ctx: any) => {
    return this.generateDocument(ctx, 'training_plan');
  };

  /**
   * GET /ai/documents
   */
  listDocuments = async ({ store, query }: any) => {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const status = query.status as AiDocumentStatus | undefined;
    const documentType = query.documentType as AiDocumentType | undefined;

    const { documents, total } = await this.documentGenService.listDocuments(
      store.userId,
      { status, documentType, page, limit },
    );

    return {
      success: true,
      data: documents,
      pagination: buildPaginationMeta(total, page, limit),
      meta: { timestamp: new Date().toISOString() },
    };
  };

  /**
   * GET /ai/documents/:id
   */
  getDocument = async ({ store, params }: any) => {
    const doc = await this.documentGenService.getDocument(params.id, store.userId);

    return {
      success: true,
      data: doc,
      meta: { timestamp: new Date().toISOString() },
    };
  };

  /**
   * PATCH /ai/documents/:id/finalize
   */
  finalizeDocument = async ({ store, params, body }: any) => {
    const doc = await this.documentGenService.finalizeDocument(
      params.id,
      store.userId,
      body?.reviewNotes,
    );

    return {
      success: true,
      data: doc,
      meta: { timestamp: new Date().toISOString() },
    };
  };

  /**
   * POST /ai/documents/:id/share
   */
  shareDocument = async ({ store, params }: any) => {
    const result = await this.documentGenService.shareWithPatient(params.id, store.userId);

    return {
      success: true,
      data: result,
      meta: { timestamp: new Date().toISOString() },
    };
  };

  /**
   * GET /ai/documents/:id/download
   */
  downloadDocument = async ({ store, params }: any) => {
    const result = await this.documentGenService.getDownloadUrl(params.id, store.userId);

    return {
      success: true,
      data: result,
      meta: { timestamp: new Date().toISOString() },
    };
  };

  private async generateDocument(ctx: any, documentType: AiDocumentType) {
    const { store, body, set } = ctx;

    if (!body.userId) throw new BadRequestError('userId is required');
    if (!body.title) throw new BadRequestError('title is required');
    if (!body.patientContext || typeof body.patientContext !== 'object') {
      throw new BadRequestError('patientContext object is required');
    }

    const result = await this.documentGenService.generate(
      {
        userId: body.userId,
        providerId: store.userId,
        documentType,
        title: body.title,
        patientContext: body.patientContext,
        providerNotes: body.providerNotes,
      },
    );

    set.status = 201;
    return {
      success: true,
      data: result,
      meta: { timestamp: new Date().toISOString() },
    };
  }
}
