import { Elysia } from 'elysia';
import { BedrockService } from '../services/bedrock.service.js';
import { EmbeddingService } from '../services/embedding.service.js';
import { SafetyService } from '../services/safety.service.js';
import { S3Service } from '../services/s3.service.js';
import { RecommendationService } from '../services/recommendation.service.js';
import { DocumentGenService } from '../services/document-gen.service.js';
import { DocumentService } from '../services/document.service.js';
import { AdminService } from '../services/admin.service.js';
import { RecommendationController } from '../controllers/recommendation.controller.js';
import { DocumentGenController } from '../controllers/document-gen.controller.js';
import { DocumentController } from '../controllers/document.controller.js';
import { InternalController } from '../controllers/internal.controller.js';
import { AdminController } from '../controllers/admin.controller.js';
import { createRecommendationRoutes } from './recommendation.routes.js';
import { createDocumentGenRoutes } from './document-gen.routes.js';
import { createDocumentRoutes } from './document.routes.js';
import { createInternalRoutes } from './internal.routes.js';
import { createAdminRoutes } from './admin.routes.js';

export function createRoutes(): Elysia {
  // ── Initialize services (no PrismaClient — Drizzle db is module-level) ──
  const bedrockService = new BedrockService(null);
  const embeddingService = new EmbeddingService(null, bedrockService);
  const safetyService = new SafetyService(null);
  const s3Service = new S3Service();
  const recommendationService = new RecommendationService(null, bedrockService, embeddingService, safetyService);
  const documentGenService = new DocumentGenService(null, bedrockService, safetyService, s3Service);
  const documentService = new DocumentService(null, s3Service);
  const adminService = new AdminService(null, embeddingService);

  // ── Initialize controllers ──
  const recommendationController = new RecommendationController(recommendationService);
  const documentGenController = new DocumentGenController(documentGenService);
  const documentController = new DocumentController(documentService);
  const internalController = new InternalController(null, embeddingService, documentService);
  const adminController = new AdminController(embeddingService, adminService);

  return new Elysia()
    .use(createRecommendationRoutes(recommendationController))
    .use(createDocumentGenRoutes(documentGenController))
    .use(createAdminRoutes(adminController))
    .use(createDocumentRoutes(documentController))
    .use(createInternalRoutes(internalController));
}
