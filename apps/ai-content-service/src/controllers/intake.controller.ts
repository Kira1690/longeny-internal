import type { RequestContext } from '@longeny/middleware';
import type { SubmitIntake } from '@longeny/validators';
import type { IntakeService } from '../services/intake.service.js';
import type { ProfileAccessService } from '../services/profile-access.service.js';

interface SubmitCtx {
  body: SubmitIntake;
  store: RequestContext;
  set: { status?: number | string };
}

interface ReadCtx {
  params: { profileId: string };
  query: { version?: string };
  store: RequestContext;
}

/**
 * RRO intake.
 *
 * `POST` writes to the profile the request is acting as — resolved from the
 * `X-Active-Profile-Id` header and ownership-checked before the handler runs.
 * `GET` names a profile in the path, so it is checked here, through the same
 * resolution call.
 */
export class IntakeController {
  constructor(
    private readonly intakeService: IntakeService,
    private readonly profileAccess: ProfileAccessService,
  ) {}

  submit = async ({ body, store, set }: SubmitCtx) => {
    const data = await this.intakeService.submit(store.activeProfileId, store.userId, body);
    set.status = 201;
    return { success: true, data };
  };

  get = async ({ params, query, store }: ReadCtx) => {
    await this.profileAccess.assertOwns(store.userId, params.profileId);
    const version = query.version === undefined ? undefined : Number(query.version);
    const data = await this.intakeService.get(params.profileId, version);
    return { success: true, data };
  };

  history = async ({ params, store }: ReadCtx) => {
    await this.profileAccess.assertOwns(store.userId, params.profileId);
    const data = await this.intakeService.history(params.profileId);
    return { success: true, data };
  };
}
