import type { RequestContext } from '@longeny/middleware';
import {
  type DeclareReport,
  type ReportTimelineQuery,
  type UpdateReport,
  reportTimelineQuerySchema,
} from '@longeny/validators';
import type { Caller, ReportService } from '../services/report.service.js';

type Set = { status?: number | string };
interface Base {
  store: RequestContext;
  request: Request;
  set: Set;
}
interface ByReport extends Base {
  params: { reportId: string };
}
interface ByProfile extends Base {
  params: { profileId: string };
}

const caller = ({ store, request }: Base): Caller & { request: Request } => ({
  userId: store.userId,
  userRole: store.userRole,
  userRoles: store.userRoles,
  request,
});

const ok = <T>(data: T, meta: Record<string, unknown> = {}) => ({
  success: true as const,
  data,
  meta: { ...meta, timestamp: new Date().toISOString() },
});

/** Thin: every decision about who may do what lives in ReportService. */
export class ReportController {
  constructor(private readonly reports: ReportService) {}

  declare = async (ctx: ByProfile & { body: DeclareReport }) => {
    const data = await this.reports.declare(caller(ctx), ctx.params.profileId, ctx.body);
    ctx.set.status = 201;
    return ok(data);
  };

  timeline = async (ctx: ByProfile & { query: ReportTimelineQuery }) => {
    // Validated by the route; parsed again so the defaults hold whichever form
    // the router hands over.
    const query = reportTimelineQuerySchema.parse(ctx.query);
    const { reports, total } = await this.reports.timeline(
      caller(ctx),
      ctx.params.profileId,
      query,
    );
    return ok(reports, {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    });
  };

  complete = async (ctx: ByReport) =>
    ok(await this.reports.complete(caller(ctx), ctx.params.reportId));

  get = async (ctx: ByReport) => ok(await this.reports.get(caller(ctx), ctx.params.reportId));

  update = async (ctx: ByReport & { body: UpdateReport }) =>
    ok(await this.reports.update(caller(ctx), ctx.params.reportId, ctx.body));

  download = async (ctx: ByReport) =>
    ok(await this.reports.download(caller(ctx), ctx.params.reportId));

  text = async (ctx: ByReport & { query: { page?: number } }) =>
    ok(await this.reports.text(caller(ctx), ctx.params.reportId, ctx.query.page), {
      machine_read: true,
      note: 'Text read by machine. Not verified values.',
    });

  retry = async (ctx: ByReport) => {
    const data = await this.reports.retry(caller(ctx), ctx.params.reportId);
    ctx.set.status = 202;
    return ok(data);
  };

  remove = async (ctx: ByReport) => {
    await this.reports.remove(caller(ctx), ctx.params.reportId);
    ctx.set.status = 204;
    return null;
  };

  accessLog = async (ctx: ByReport & { query: { page?: number; limit?: number } }) => {
    const page = ctx.query.page ?? 1;
    const limit = ctx.query.limit ?? 20;
    const { entries, total } = await this.reports.accessLog(
      caller(ctx),
      ctx.params.reportId,
      page,
      limit,
    );
    return ok(entries, { page, limit, total });
  };
}
