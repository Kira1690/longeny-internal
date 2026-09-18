import { auditLog, permissionGuard, rateLimit, requireAuth } from '@longeny/middleware';
import { REPORT_PROCESSING_STATUSES, REPORT_READ_METHODS, RRO_STATES } from '@longeny/types';
import {
  DOCUMENT_TYPES,
  UPLOAD_MIME_TYPES,
  declareReportSchema,
  reportTimelineQuerySchema,
  updateReportSchema,
} from '@longeny/validators';
import { Elysia, t } from 'elysia';
import type { ReportController } from '../controllers/report.controller.js';
import { writePhiAccessLog } from '../services/phi-audit.service.js';
import { type OpenApiFragment, bodyDoc, documented, errorDoc, okDoc } from './swagger-helpers.js';

const bearer = { security: [{ BearerAuth: [] }] };
const TAGS = ['reports'];
const reportIdParam = t.Object({ reportId: t.String({ format: 'uuid' }) });
const profileIdParam = t.Object({ profileId: t.String({ format: 'uuid' }) });

const REPORT_SHAPE: OpenApiFragment = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    profile_id: { type: 'string', format: 'uuid', description: 'The person the report is about' },
    title: { type: 'string' },
    document_type: { type: 'string', enum: [...DOCUMENT_TYPES] },
    file_name: { type: 'string' },
    file_size: { type: 'integer', description: 'Bytes' },
    mime_type: { type: 'string', enum: [...UPLOAD_MIME_TYPES] },
    reported_at: {
      type: 'string',
      format: 'date-time',
      nullable: true,
      description: 'When the lab produced the report — not when it was uploaded',
    },
    rro_state_at_upload: {
      type: 'string',
      enum: [...RRO_STATES],
      nullable: true,
      description: 'The person’s care stage when the report was uploaded. Never changes.',
    },
    processing_status: {
      type: 'string',
      enum: [...REPORT_PROCESSING_STATUSES],
      description:
        '`awaiting_upload` → `uploaded` → `reading` → `read` or `failed`. Medical imaging (DICOM) is `not_applicable`: stored, never read.',
    },
    read_method: {
      type: 'string',
      enum: [...REPORT_READ_METHODS],
      nullable: true,
      description:
        '`text_layer`: the PDF carried its own text. `ocr`: read from an image (scan, screenshot, photo). `mixed`: both.',
    },
    processing_error: {
      type: 'string',
      nullable: true,
      description: 'Why a read failed, safe to show the person',
    },
    processing_note: {
      type: 'string',
      nullable: true,
      description: 'Something to know about a successful read, e.g. pages with no readable text',
    },
    page_count: { type: 'integer', nullable: true },
    processed_at: { type: 'string', format: 'date-time', nullable: true },
    created_at: { type: 'string', format: 'date-time' },
    updated_at: { type: 'string', format: 'date-time' },
  },
};

const REPORT_EXAMPLE = {
  id: '0e7c8f5d-3a2b-4c1d-9e8f-7a6b5c4d3e2f',
  profile_id: 'df864dbd-4eb5-4785-8299-28bb09a69246',
  title: 'HbA1c and lipid panel',
  document_type: 'lab_report',
  file_name: 'panel-2026-09-01.pdf',
  file_size: 184320,
  mime_type: 'application/pdf',
  reported_at: '2026-09-01T00:00:00.000Z',
  rro_state_at_upload: 'reverse',
  processing_status: 'read',
  read_method: 'mixed',
  processing_error: null,
  processing_note: null,
  page_count: 3,
  processed_at: '2026-09-18T10:02:11.000Z',
  created_at: '2026-09-18T10:01:40.000Z',
  updated_at: '2026-09-18T10:02:11.000Z',
};

const e401 = errorDoc('Missing or invalid token', 'UNAUTHORIZED');
const e403 = errorDoc('Token lacks the required permission', 'FORBIDDEN');
const e404 = errorDoc(
  'No such report, a deleted one, or one this caller may not see — deliberately indistinguishable',
  'NOT_FOUND',
);
const e503 = errorDoc(
  'Ownership, storage or the audit trail could not be reached',
  'SERVICE_UNAVAILABLE',
);
const e429 = errorDoc('Too many requests from this account', 'RATE_LIMITED');

const READ_RULE =
  'Readable by the account that owns the report’s profile (its own or a family member it manages), or by a provider with an active booking for that profile. Anyone else gets 404.';
const WRITE_RULE =
  'Only the account that owns the report’s profile. Anyone else — including a provider — gets 404.';

/**
 * One group per audited action. Elysia applies a plugin's hooks to every route
 * registered after it on the same instance, so actions that share an instance
 * would write each other's audit rows.
 */
function group(action: string, opts: { recordSuccess?: boolean; limit?: number } = {}) {
  const base = new Elysia({ prefix: '/reports' })
    .use(requireAuth({ onRevocationCheckFailure: 'closed' }))
    .use(
      auditLog({
        action,
        resourceType: 'report',
        resourceParam: 'reportId',
        purpose: 'care_delivery',
        sink: writePhiAccessLog,
        recordSuccess: opts.recordSuccess,
      }),
    );
  return opts.limit
    ? base.use(rateLimit({ windowMs: 60_000, max: opts.limit, keyPrefix: action, by: 'account' }))
    : base;
}

export function createReportRoutes(controller: ReportController) {
  // ── Under a profile ──

  const declare = new Elysia({ prefix: '/profiles' })
    .use(requireAuth({ onRevocationCheckFailure: 'closed' }))
    .use(
      auditLog({
        action: 'reports.declare',
        resourceType: 'report',
        purpose: 'care_delivery',
        sink: writePhiAccessLog,
      }),
    )
    .use(rateLimit({ windowMs: 60_000, max: 10, keyPrefix: 'reports.declare', by: 'account' }))
    .post('/:profileId/reports', controller.declare, {
      beforeHandle: permissionGuard('documents:write'),
      params: profileIdParam,
      body: documented(declareReportSchema, {
        title: 'HbA1c and lipid panel',
        fileName: 'panel-2026-09-01.pdf',
        fileSize: 184320,
        mimeType: 'application/pdf',
        documentType: 'lab_report',
        reportedAt: '2026-09-01',
      }),
      detail: {
        tags: TAGS,
        summary: 'Start a report upload',
        description: `Creates the report, records the person’s current care stage on it, and returns a link to upload the file to.\n\n**Upload the file** with a \`PUT\` to \`upload.url\`, sending exactly the \`upload.headers\`. Size and type are signed into the link: a different size or type is refused by storage itself. The link lasts 10 minutes.\n\n**Then call** \`POST /reports/{id}/complete\`. Until then the report is \`awaiting_upload\` and is not read.\n\nAccepted: PDF, JPEG, PNG, TIFF (read for text) and DICOM (stored only), up to 50 MB. Convert iPhone HEIC photos to JPEG first.\n\n${WRITE_RULE}`,
        ...bearer,
        requestBody: bodyDoc(declareReportSchema),
        responses: {
          201: okDoc(
            'Report created; upload the file next',
            {
              type: 'object',
              properties: {
                report: REPORT_SHAPE,
                upload: {
                  type: 'object',
                  properties: {
                    url: { type: 'string' },
                    method: { type: 'string', enum: ['PUT'] },
                    headers: { type: 'object', additionalProperties: { type: 'string' } },
                    expires_in: { type: 'integer', description: 'Seconds' },
                  },
                },
              },
            },
            {
              report: {
                ...REPORT_EXAMPLE,
                processing_status: 'awaiting_upload',
                read_method: null,
              },
              upload: {
                url: 'https://longeny-reports….s3.ap-south-1.amazonaws.com/reports/…?X-Amz-Signature=…',
                method: 'PUT',
                headers: { 'Content-Type': 'application/pdf', 'Content-Length': '184320' },
                expires_in: 600,
              },
            },
          ),
          400: errorDoc(
            'Body failed validation: size, type, date, unknown field',
            'VALIDATION_ERROR',
          ),
          401: e401,
          403: e403,
          404: errorDoc('No such profile, or not this account’s', 'NOT_FOUND'),
          429: e429,
          503: e503,
        },
      },
    });

  const timeline = new Elysia({ prefix: '/profiles' })
    .use(requireAuth({ onRevocationCheckFailure: 'closed' }))
    .use(
      auditLog({
        action: 'reports.timeline',
        resourceType: 'document',
        purpose: 'care_delivery',
        sink: writePhiAccessLog,
      }),
    )
    .get('/:profileId/reports', controller.timeline, {
      beforeHandle: permissionGuard('documents:read'),
      params: profileIdParam,
      query: documented(reportTimelineQuerySchema),
      detail: {
        tags: TAGS,
        summary: 'A person’s reports, newest test first',
        description: `Ordered by when the test happened (\`reported_at\`, or the upload date when unknown), newest first. Each report carries the care stage at upload and how far reading has got.\n\nFilters, all optional: \`documentType\`, \`status\` (a processing status), \`from\` and \`to\` (dates, inclusive). A declared upload that never arrived is hidden after 24 hours.\n\n${READ_RULE}`,
        ...bearer,
        responses: {
          200: okDoc('Reports', { type: 'array', items: REPORT_SHAPE }, [REPORT_EXAMPLE]),
          400: errorDoc('A filter is invalid', 'VALIDATION_ERROR'),
          401: e401,
          403: e403,
          404: errorDoc(
            'No such profile, not this account’s, or no active booking for this provider',
            'NOT_FOUND',
          ),
          503: e503,
        },
      },
    });

  // ── Under a report ──

  const complete = group('reports.complete', { limit: 20 }).post(
    '/:reportId/complete',
    controller.complete,
    {
      beforeHandle: permissionGuard('documents:write'),
      params: reportIdParam,
      detail: {
        tags: TAGS,
        summary: 'Confirm the file was uploaded',
        description: `Checks storage: the file must be there with exactly the declared size and type. Then the report is queued to be read (\`uploaded\`), or for DICOM marked \`not_applicable\`.\n\n409 when the file is missing or different (\`UPLOAD_MISSING\`, \`UPLOAD_MISMATCH\`) — upload it and call again — or when the report was already confirmed (\`REPORT_STATE\`).\n\n${WRITE_RULE}`,
        ...bearer,
        responses: {
          200: okDoc('Confirmed', REPORT_SHAPE, {
            ...REPORT_EXAMPLE,
            processing_status: 'uploaded',
            read_method: null,
          }),
          401: e401,
          403: e403,
          404: e404,
          409: errorDoc(
            'File missing, file different from the declaration, or already confirmed',
            'UPLOAD_MISSING',
          ),
          429: e429,
          503: e503,
        },
      },
    },
  );

  const view = group('reports.view').get('/:reportId', controller.get, {
    beforeHandle: permissionGuard('documents:read'),
    params: reportIdParam,
    detail: {
      tags: TAGS,
      summary: 'One report',
      description: `Details, the care stage at upload and how far reading has got. Poll this after \`complete\` until \`processing_status\` is \`read\` or \`failed\`.\n\n${READ_RULE}`,
      ...bearer,
      responses: {
        200: okDoc('Report', REPORT_SHAPE, REPORT_EXAMPLE),
        401: e401,
        403: e403,
        404: e404,
        503: e503,
      },
    },
  });

  const update = group('reports.update').patch('/:reportId', controller.update, {
    beforeHandle: permissionGuard('documents:write'),
    params: reportIdParam,
    body: documented(updateReportSchema, { reportedAt: '2026-08-28' }),
    detail: {
      tags: TAGS,
      summary: 'Correct a report’s title, date or type',
      description: `At least one of \`title\`, \`reportedAt\` (or null), \`documentType\`. The person a report belongs to, the care stage recorded at upload and the file cannot be changed. Changing the type does not re-read the report.\n\n${WRITE_RULE}`,
      ...bearer,
      requestBody: bodyDoc(updateReportSchema),
      responses: {
        200: okDoc('Updated', REPORT_SHAPE, REPORT_EXAMPLE),
        400: errorDoc('Empty body, unknown field or bad value', 'VALIDATION_ERROR'),
        401: e401,
        403: e403,
        404: e404,
        503: e503,
      },
    },
  });

  // The handler writes the success row itself, before the link is handed out.
  const download = group('reports.download', { recordSuccess: false, limit: 30 }).get(
    '/:reportId/download',
    controller.download,
    {
      beforeHandle: permissionGuard('documents:read'),
      params: reportIdParam,
      detail: {
        tags: TAGS,
        summary: 'A short-lived link to the file',
        description: `A link valid for 5 minutes that downloads the file under its original name. The access is recorded before the link is returned; if it cannot be recorded, no link is given (503).\n\n409 while nothing has been uploaded.\n\n${READ_RULE}`,
        ...bearer,
        responses: {
          200: okDoc(
            'Download link',
            {
              type: 'object',
              properties: {
                url: { type: 'string' },
                expires_in: { type: 'integer' },
                file_name: { type: 'string' },
                mime_type: { type: 'string' },
              },
            },
            {
              url: 'https://…?X-Amz-Signature=…',
              expires_in: 300,
              file_name: 'panel.pdf',
              mime_type: 'application/pdf',
            },
          ),
          401: e401,
          403: e403,
          404: e404,
          409: errorDoc('Nothing uploaded yet', 'REPORT_STATE'),
          429: e429,
          503: e503,
        },
      },
    },
  );

  const text = group('reports.text').get('/:reportId/text', controller.text, {
    beforeHandle: permissionGuard('documents:read'),
    params: reportIdParam,
    query: t.Object({ page: t.Optional(t.Numeric({ minimum: 1, maximum: 10_000 })) }),
    detail: {
      tags: TAGS,
      summary: 'The text read from the report',
      description: `Page by page, with tables as rows of cells. \`method\` says how each page was read; \`ocr_confidence\` (0–100) is set for pages read from an image.\n\n**Machine-read.** This is text, not confirmed values: OCR can misread a digit. Never show it as a verified result.\n\nBefore the report is \`read\`, answers 200 with no pages and the current status, so it can be polled. \`page\` returns one page.\n\n${READ_RULE}`,
      ...bearer,
      responses: {
        200: okDoc(
          'Text',
          {
            type: 'object',
            properties: {
              report_id: { type: 'string', format: 'uuid' },
              processing_status: { type: 'string', enum: [...REPORT_PROCESSING_STATUSES] },
              read_method: { type: 'string', enum: [...REPORT_READ_METHODS], nullable: true },
              processing_error: { type: 'string', nullable: true },
              processing_note: { type: 'string', nullable: true },
              page_count: { type: 'integer', nullable: true },
              pages: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    page_number: { type: 'integer' },
                    method: { type: 'string', enum: ['text_layer', 'ocr'] },
                    text: { type: 'string' },
                    tables: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          rows: {
                            type: 'array',
                            items: { type: 'array', items: { type: 'string' } },
                          },
                        },
                      },
                    },
                    ocr_confidence: { type: 'number', nullable: true },
                  },
                },
              },
            },
          },
          {
            report_id: REPORT_EXAMPLE.id,
            processing_status: 'read',
            read_method: 'ocr',
            processing_error: null,
            processing_note: null,
            page_count: 1,
            pages: [
              {
                page_number: 1,
                method: 'ocr',
                text: 'HbA1c 6.2 %',
                tables: [
                  {
                    rows: [
                      ['Test', 'Result', 'Unit'],
                      ['HbA1c', '6.2', '%'],
                    ],
                  },
                ],
                ocr_confidence: 97.4,
              },
            ],
          },
        ),
        400: errorDoc('`page` is not a positive number', 'VALIDATION_ERROR'),
        401: e401,
        403: e403,
        404: e404,
        503: e503,
      },
    },
  });

  const retry = group('reports.retry', { limit: 10 }).post(
    '/:reportId/ocr/retry',
    controller.retry,
    {
      beforeHandle: permissionGuard('documents:write'),
      params: reportIdParam,
      detail: {
        tags: TAGS,
        summary: 'Read a failed report again',
        description: `Only from \`failed\` (409 otherwise). Queues the report to be read again. At most 3 times per report per hour, because reading a scanned page costs money (429).\n\n${WRITE_RULE}`,
        ...bearer,
        responses: {
          202: okDoc('Queued', REPORT_SHAPE, {
            ...REPORT_EXAMPLE,
            processing_status: 'uploaded',
            read_method: null,
          }),
          401: e401,
          403: e403,
          404: e404,
          409: errorDoc('The report has not failed', 'REPORT_STATE'),
          429: e429,
          503: e503,
        },
      },
    },
  );

  const remove = group('reports.delete').delete('/:reportId', controller.remove, {
    beforeHandle: permissionGuard('documents:write'),
    params: reportIdParam,
    detail: {
      tags: TAGS,
      summary: 'Remove a report',
      description: `Hidden at once from every route and the timeline. The file and its text are kept for the audit record.\n\n${WRITE_RULE}`,
      ...bearer,
      responses: { 204: { description: 'Removed' }, 401: e401, 403: e403, 404: e404, 503: e503 },
    },
  });

  const accessLog = group('reports.access_log').get('/:reportId/access-log', controller.accessLog, {
    beforeHandle: permissionGuard('documents:read'),
    params: reportIdParam,
    query: t.Object({
      page: t.Optional(t.Numeric({ minimum: 1 })),
      limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100 })),
    }),
    detail: {
      tags: TAGS,
      summary: 'Who opened this report',
      description: `Views, downloads and text reads, newest first. Works on a removed report too. Refused attempts are not listed here; they are kept for access review.\n\n${WRITE_RULE}`,
      ...bearer,
      responses: {
        200: okDoc(
          'Access entries',
          {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                occurred_at: { type: 'string', format: 'date-time' },
                action: {
                  type: 'string',
                  enum: ['reports.view', 'reports.download', 'reports.text'],
                },
                actor_type: { type: 'string', enum: ['owner', 'provider'] },
                is_you: { type: 'boolean' },
              },
            },
          },
          [
            {
              occurred_at: '2026-09-18T11:00:00.000Z',
              action: 'reports.download',
              actor_type: 'provider',
              is_you: false,
            },
          ],
        ),
        401: e401,
        403: e403,
        404: e404,
        503: e503,
      },
    },
  });

  return new Elysia()
    .use(declare)
    .use(timeline)
    .use(complete)
    .use(download)
    .use(text)
    .use(retry)
    .use(accessLog)
    .use(view)
    .use(update)
    .use(remove);
}
