import { NotFoundError } from '@longeny/errors';
import type { RequestContext } from '@longeny/middleware';
import type { ProfileAccessService } from '../services/profile-access.service.js';
import type { RroAiService } from '../services/rro-ai.service.js';

interface ClassifyCtx {
  body: { profileId: string; ageBand?: 'under_18' | '18_39' | '40_59' | '60_plus' };
}

interface SummaryCtx {
  body: { profileId: string };
}

interface ReadCtx {
  params: { profileId: string };
  store: RequestContext;
}

/**
 * RRO classifier and pre-consult summary.
 *
 * Generating is service-to-service (HMAC): it costs a model call and it can move
 * a profile through the care pathway, so it is not something a browser triggers
 * directly. Reading the stored result is account-scoped, and the profile named
 * in the path is ownership-checked here.
 */
export class RroAiController {
  constructor(
    private readonly rroAi: RroAiService,
    private readonly profileAccess: ProfileAccessService,
  ) {}

  classify = async ({ body }: ClassifyCtx) => {
    const { classification } = await this.rroAi.classify(body.profileId, body.ageBand);
    return { success: true, data: classification };
  };

  summarise = async ({ body }: SummaryCtx) => {
    const { summary } = await this.rroAi.summarise(body.profileId);
    return { success: true, data: summary };
  };

  getClassification = async ({ params, store }: ReadCtx) => {
    await this.profileAccess.assertOwns(store.userId, params.profileId);
    const data = await this.rroAi.latestClassification(params.profileId);
    if (!data) throw new NotFoundError('Classification');
    return { success: true, data };
  };

  getSummary = async ({ params, store }: ReadCtx) => {
    await this.profileAccess.assertOwns(store.userId, params.profileId);
    const data = await this.rroAi.latestSummary(params.profileId);
    if (!data) throw new NotFoundError('Summary');
    return { success: true, data };
  };
}
