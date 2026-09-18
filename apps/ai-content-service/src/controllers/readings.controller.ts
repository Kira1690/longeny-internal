import { NotFoundError } from '@longeny/errors';
import type { RequestContext } from '@longeny/middleware';
import { UserRole } from '@longeny/types';
import type { CorrectReading, SubmitReadings } from '@longeny/validators';
import type { ProfileAccessService } from '../services/profile-access.service.js';
import type { ReadingsService } from '../services/readings.service.js';

interface ReportCtx {
  params: { documentId: string };
  body: SubmitReadings;
  store: RequestContext;
  set: { status?: number | string };
}

interface CorrectCtx {
  params: { readingId: string };
  body: CorrectReading;
  store: RequestContext;
  set: { status?: number | string };
}

/**
 * Readings on a report.
 *
 * Entering and correcting values is the family's act on its own record. A
 * provider can read them through an active booking but cannot write them yet:
 * clinician entry needs the care team model, which decides who on a team may
 * change a patient's record. Until then a provider's write answers 404, the
 * same as a stranger's.
 */
export class ReadingsController {
  constructor(
    private readonly readings: ReadingsService,
    private readonly profileAccess: ProfileAccessService,
  ) {}

  private async assertMayWrite(store: RequestContext, profileId: string) {
    const isProvider =
      store.userRole === UserRole.PROVIDER || (store.userRoles ?? []).includes(UserRole.PROVIDER);
    if (isProvider) throw new NotFoundError('Report');
    await this.profileAccess.assertOwns(store.userId, profileId);
  }

  submit = async ({ params, body, store, set }: ReportCtx) => {
    const report = await this.readings.findReport(params.documentId);
    await this.assertMayWrite(store, report.profileId);
    const data = await this.readings.submit(report, store.userId, body);
    set.status = 201;
    return { success: true, data };
  };

  list = async ({ params, store }: Omit<ReportCtx, 'body' | 'set'>) => {
    const report = await this.readings.findReport(params.documentId);
    await this.profileAccess.assertCanRead(store, report.profileId);
    const data = await this.readings.listForReport(report.id);
    return { success: true, data };
  };

  correct = async ({ params, body, store, set }: CorrectCtx) => {
    const { reading, report } = await this.readings.findReading(params.readingId);
    await this.assertMayWrite(store, report.profileId);
    const data = await this.readings.correct(reading, store.userId, body);
    set.status = 201;
    return { success: true, data };
  };
}
