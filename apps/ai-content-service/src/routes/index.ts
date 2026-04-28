import { Elysia } from 'elysia';
import { BedrockService } from '../services/bedrock.service.js';
import { EmbeddingService } from '../services/embedding.service.js';
import { SafetyService } from '../services/safety.service.js';
import { S3Service } from '../services/s3.service.js';
import { RecommendationService } from '../services/recommendation.service.js';
import { DocumentGenService } from '../services/document-gen.service.js';
import { DocumentService } from '../services/document.service.js';
import { AdminService } from '../services/admin.service.js';
import { OnboardingAgentService } from '../services/onboarding-agent.service.js';
import { SessionService } from '../services/session.service.js';
import { ProviderProfileService } from '../services/provider-profile.service.js';
import { RecommendationController } from '../controllers/recommendation.controller.js';
import { DocumentGenController } from '../controllers/document-gen.controller.js';
import { DocumentController } from '../controllers/document.controller.js';
import { InternalController } from '../controllers/internal.controller.js';
import { AdminController } from '../controllers/admin.controller.js';
import { OnboardingController } from '../controllers/onboarding.controller.js';
import { SessionController } from '../controllers/session.controller.js';
import { ProviderController } from '../controllers/provider.controller.js';
import { KbController } from '../controllers/kb.controller.js';
import { RagController } from '../controllers/rag.controller.js';
import { KbUploadService } from '../services/kb-upload.service.js';
import { createRecommendationRoutes } from './recommendation.routes.js';
import { createDocumentGenRoutes } from './document-gen.routes.js';
import { createDocumentRoutes } from './document.routes.js';
import { createInternalRoutes } from './internal.routes.js';
import { createAdminRoutes } from './admin.routes.js';
import { createOnboardingRoutes } from './onboarding.routes.js';
import { createSessionRoutes } from './session.routes.js';
import { createProviderRoutes } from './provider.routes.js';
import { createKbRoutes } from './kb.routes.js';
import { createRagRoutes } from './rag.routes.js';
import { MatchingService } from '../services/matching.service.js';
import { PostOnboardingService } from '../services/post-onboarding.service.js';
import { SchedulingService } from '../services/scheduling.service.js';
import { NotificationService } from '../services/notification.service.js';
import { MatchingController } from '../controllers/matching.controller.js';
import { PostOnboardingController } from '../controllers/post-onboarding.controller.js';
import { SchedulingController } from '../controllers/scheduling.controller.js';
import { NotificationController } from '../controllers/notification.controller.js';
import { createMatchingRoutes } from './matching.routes.js';
import { createPostOnboardingRoutes } from './post-onboarding.routes.js';
import { createSchedulingRoutes } from './scheduling.routes.js';
import { createNotificationRoutes } from './notification.routes.js';

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
  const onboardingAgentService = new OnboardingAgentService();
  const sessionService = new SessionService();
  const providerProfileService = new ProviderProfileService();
  const kbUploadService = new KbUploadService(s3Service);
  const matchingService = new MatchingService();
  const postOnboardingService = new PostOnboardingService();
  const schedulingService = new SchedulingService();
  const notificationService = new NotificationService();

  // ── Initialize controllers ──
  const recommendationController = new RecommendationController(recommendationService);
  const documentGenController = new DocumentGenController(documentGenService);
  const documentController = new DocumentController(documentService);
  const internalController = new InternalController(null, embeddingService, documentService);
  const adminController = new AdminController(embeddingService, adminService);
  const onboardingController = new OnboardingController(onboardingAgentService);
  const sessionController = new SessionController(sessionService);
  const providerController = new ProviderController(providerProfileService);
  const kbController = new KbController(kbUploadService);
  const ragController = new RagController();
  const matchingController = new MatchingController(matchingService);
  const postOnboardingController = new PostOnboardingController(postOnboardingService);
  const schedulingController = new SchedulingController(schedulingService);
  const notificationController = new NotificationController(notificationService);

  return new Elysia()
    .use(createOnboardingRoutes(onboardingController))
    .use(createSessionRoutes(sessionController))
    .use(createProviderRoutes(providerController))
    .use(createKbRoutes(kbController))
    .use(createRagRoutes(ragController))
    .use(createRecommendationRoutes(recommendationController))
    .use(createDocumentGenRoutes(documentGenController))
    .use(createAdminRoutes(adminController))
    .use(createDocumentRoutes(documentController))
    .use(createInternalRoutes(internalController))
    .use(createMatchingRoutes(matchingController))
    .use(createPostOnboardingRoutes(postOnboardingController))
    .use(createSchedulingRoutes(schedulingController))
    .use(createNotificationRoutes(notificationController));
}
