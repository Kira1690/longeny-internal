import type { RequestContext } from '@longeny/middleware';
import type { BenchmarkService } from '../services/benchmark.service.js';
import type { ProfileAccessService } from '../services/profile-access.service.js';
import type { ScoreService } from '../services/score.service.js';

interface ProfileCtx {
  params: { profileId: string };
  store: RequestContext;
}

interface RangesCtx {
  query: { marker?: string };
}

/**
 * Benchmarks and the reference ranges behind them.
 *
 * A profile's benchmarks are clinical data and are read the way its reports
 * are: by the owning account, or by a provider with an active booking. The
 * range table is not about anyone and is readable by any authenticated caller
 * with document access.
 */
export class BenchmarkController {
  constructor(
    private readonly benchmarks: BenchmarkService,
    private readonly profileAccess: ProfileAccessService,
    private readonly scores: ScoreService,
  ) {}

  forProfile = async ({ params, store }: ProfileCtx) => {
    await this.profileAccess.assertCanRead(store, params.profileId);
    const data = await this.benchmarks.profileBenchmarks(params.profileId);
    return {
      success: true,
      data,
      meta: {
        // Profile resolution carries no PII, so sex- and age-specific ranges
        // cannot be applied yet. Said here so a client can explain a
        // `needs_demographics` verdict rather than show a bare blank.
        demographics: 'unavailable',
        provisional: data.some((b) => b.provisional),
        timestamp: new Date().toISOString(),
      },
    };
  };

  trends = async ({ params, query, store }: ProfileCtx & { query: { marker?: string } }) => {
    await this.profileAccess.assertCanRead(store, params.profileId);
    const data = await this.benchmarks.profileTrends(params.profileId, query.marker);
    return {
      success: true,
      data,
      meta: {
        demographics: 'unavailable',
        provisional: data.some((t) => t.provisional),
        timestamp: new Date().toISOString(),
      },
    };
  };

  /** Advisory. Computing a score never moves the profile between care stages. */
  computeScore = async ({
    params,
    store,
    set,
  }: ProfileCtx & { set: { status?: number | string } }) => {
    await this.profileAccess.assertCanRead(store, params.profileId);
    const { created, data } = await this.scores.compute(params.profileId, store.userId);
    set.status = created ? 201 : 200;
    return { success: true, data, meta: { reused: !created, timestamp: new Date().toISOString() } };
  };

  latestScore = async ({ params, store }: ProfileCtx) => {
    await this.profileAccess.assertCanRead(store, params.profileId);
    const data = await this.scores.latest(params.profileId);
    return { success: true, data };
  };

  referenceRanges = async ({ query }: RangesCtx) => {
    const data = await this.benchmarks.listReferenceRanges(query.marker);
    return {
      success: true,
      data,
      meta: {
        provisional: data.some((r) => r.provisional),
        timestamp: new Date().toISOString(),
      },
    };
  };
}
