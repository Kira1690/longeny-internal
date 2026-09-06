import {
  permissionGuard,
  remoteProfileContext,
  requireAuth,
  requireRole,
} from '@longeny/middleware';
import { UserRole } from '@longeny/types';
import {
  cancelBookingSchema,
  createBookingSchema,
  rescheduleSchema,
  updateBookingSchema,
} from '@longeny/validators';
import { Elysia } from 'elysia';
import { config } from '../config/index.js';
import type { BookingController } from '../controllers/booking.controller.js';
import { type OpenApiFragment, bodyDoc, documented, errorDoc, okDoc } from './swagger-helpers.js';

const bearer = { security: [{ BearerAuth: [] }] };

// ── Shared documentation fragments ───────────────────────────────────────────

const BOOKING_SHAPE: OpenApiFragment = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    user_id: { type: 'string', format: 'uuid', description: 'Account that booked and pays' },
    profile_id: {
      type: 'string',
      format: 'uuid',
      nullable: true,
      description:
        'Subject of care the session is for. Null on bookings made before the multi-profile model, which were always for the account owner.',
    },
    provider_id: { type: 'string', format: 'uuid' },
    program_id: { type: 'string', format: 'uuid', nullable: true },
    session_type: {
      type: 'string',
      enum: ['one_on_one', 'group', 'consultation', 'follow_up'],
    },
    status: {
      type: 'string',
      enum: ['pending', 'confirmed', 'cancelled', 'completed', 'no_show'],
    },
    start_time: { type: 'string', format: 'date-time' },
    end_time: { type: 'string', format: 'date-time' },
    timezone: { type: 'string', example: 'Asia/Kolkata' },
    notes: { type: 'string', nullable: true },
    cancellation_reason: { type: 'string', nullable: true },
    created_at: { type: 'string', format: 'date-time' },
    updated_at: { type: 'string', format: 'date-time' },
  },
};

const BOOKING_EXAMPLE = {
  id: '9f1c6d0e-6f1a-4b1e-9a2c-2f7c0a0f1e22',
  user_id: '22222222-2222-2222-2222-222222222222',
  provider_id: '33333333-3333-3333-3333-333333333333',
  session_type: 'consultation',
  status: 'pending',
  start_time: '2026-09-01T10:00:00.000Z',
  end_time: '2026-09-01T10:45:00.000Z',
  timezone: 'Asia/Kolkata',
};

const PAGINATION_SHAPE: OpenApiFragment = {
  type: 'object',
  properties: {
    page: { type: 'integer' },
    limit: { type: 'integer' },
    total: { type: 'integer' },
    totalPages: { type: 'integer' },
  },
};

const paginationParams: OpenApiFragment[] = [
  {
    name: 'page',
    in: 'query',
    required: false,
    schema: { type: 'integer', minimum: 1, default: 1 },
  },
  {
    name: 'limit',
    in: 'query',
    required: false,
    schema: { type: 'integer', minimum: 1, default: 20 },
  },
];

function pagedBookings(description: string): OpenApiFragment {
  return {
    description,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            data: { type: 'array', items: BOOKING_SHAPE },
            pagination: PAGINATION_SHAPE,
          },
        },
      },
    },
  };
}

const bookingIdParam: OpenApiFragment = {
  parameters: [
    {
      name: 'id',
      in: 'path',
      required: true,
      schema: { type: 'string', format: 'uuid' },
      description: 'Booking id',
    },
  ],
};

const unauthorized = errorDoc(
  'Missing, malformed, expired or revoked access token',
  'UNAUTHORIZED',
);

function forbidden(permission: string): OpenApiFragment {
  return errorDoc(`Token lacks the \`${permission}\` permission`, 'FORBIDDEN');
}

/** 403 for a route that is role-gated to providers as well as permission-gated. */
function providerForbidden(permission: string): OpenApiFragment {
  return errorDoc(
    `Caller does not hold the \`provider\` role, or the token lacks the \`${permission}\` permission`,
    'FORBIDDEN',
  );
}

const notYours = errorDoc(
  'No such booking, or it belongs to another user or provider — the two are deliberately indistinguishable, so never infer that an id is real from this response',
  'NOT_FOUND',
);

export function createBookingRoutes(controller: BookingController) {
  const authRequired = requireAuth();
  const providerRequired = requireRole(UserRole.PROVIDER);

  // Auth-required section (all users)
  const authRoutes = new Elysia()
    .use(authRequired)
    // A booking is for a subject of care. Send X-Active-Profile-Id to book for
    // a dependent; omitted, the booking is for the account owner's own profile.
    // Ownership is re-checked by user-provider on every request.
    .use(
      remoteProfileContext({
        serviceName: 'booking-service',
        userProviderUrl: config.USER_PROVIDER_SERVICE_URL,
        hmacSecret: config.HMAC_SECRET,
        // Recorded, not required: the account is the scope, and this service
        // must keep working when user-provider does not.
        mode: 'header-only',
      }),
    )

    .get('/providers/:id/slots', controller.getAvailableSlots, {
      beforeHandle: permissionGuard('bookings:read'),
      detail: {
        tags: ['Bookings'],
        summary: 'Free slots for a provider on one day',
        description:
          'Availability for a single calendar day, derived from the provider’s availability ' +
          'rules minus bookings already taken. `date` is required and must be `YYYY-MM-DD`; ' +
          '`timezone` is the IANA zone the day boundaries and returned times are expressed in ' +
          '(defaults to UTC), so pass the viewer’s zone to avoid an off-by-one day.\n\n' +
          'Note: a missing or malformed `date` comes back as `{ success: false, error: ' +
          '{ code: "BAD_REQUEST" } }` with HTTP **200**, not 400 — check the `success` flag, ' +
          'not just the status code.',
        ...bearer,
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
            description: 'Provider id',
          },
          {
            name: 'date',
            in: 'query',
            required: true,
            schema: { type: 'string', example: '2026-09-01' },
            description: 'Day to look at, `YYYY-MM-DD`',
          },
          {
            name: 'timezone',
            in: 'query',
            required: false,
            schema: { type: 'string', default: 'UTC', example: 'Asia/Kolkata' },
            description: 'IANA timezone the slots are returned in',
          },
        ],
        responses: {
          200: okDoc(
            'Available slots, or an error envelope when `date` is missing or malformed',
            {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  startTime: { type: 'string', format: 'date-time' },
                  endTime: { type: 'string', format: 'date-time' },
                  available: { type: 'boolean' },
                },
              },
            },
            [
              {
                startTime: '2026-09-01T10:00:00.000Z',
                endTime: '2026-09-01T10:45:00.000Z',
                available: true,
              },
            ],
          ),
          401: unauthorized,
          403: forbidden('bookings:read'),
        },
      },
    })

    .post('/', controller.createBooking, {
      body: documented(createBookingSchema),
      beforeHandle: permissionGuard('bookings:write'),
      detail: {
        tags: ['Bookings'],
        summary: 'Book a session with a provider',
        description:
          'Creates a booking in status `pending` for the authenticated user; the provider ' +
          'confirms it separately. `startTime` and `endTime` are ISO-8601 UTC instants and must ' +
          'match a slot that is still free — a slot taken between the availability lookup and ' +
          'this call answers **409**, which is the normal race and should be handled by ' +
          're-fetching slots.',
        ...bearer,
        requestBody: bodyDoc(createBookingSchema),
        responses: {
          201: okDoc('Booking created in status `pending`', BOOKING_SHAPE, BOOKING_EXAMPLE),
          400: errorDoc('Request body failed validation', 'VALIDATION_ERROR'),
          401: unauthorized,
          403: forbidden('bookings:write'),
          409: errorDoc('That time slot is no longer available', 'CONFLICT'),
        },
      },
    })

    .get('/', controller.listUserBookings, {
      beforeHandle: permissionGuard('bookings:read'),
      detail: {
        tags: ['Bookings'],
        summary: 'List the caller’s own bookings',
        description:
          'Always scoped to the authenticated user — there is no way to list somebody else’s ' +
          'bookings from this route. Providers use `GET /bookings/provider` for the other side ' +
          'of the same appointments.\n\n' +
          '`profileId` narrows the list to one subject of care within the account, so a booking ' +
          'made for a parent shows under that parent. It can only narrow: a profile belonging to ' +
          'another account simply matches nothing.',
        ...bearer,
        parameters: [
          {
            name: 'profileId',
            in: 'query',
            required: false,
            schema: { type: 'string', format: 'uuid' },
            description: 'Show only bookings for this profile',
          },
          {
            name: 'status',
            in: 'query',
            required: false,
            schema: {
              type: 'string',
              enum: ['pending', 'confirmed', 'cancelled', 'completed', 'no_show'],
            },
          },
          {
            name: 'timeframe',
            in: 'query',
            required: false,
            schema: { type: 'string', enum: ['upcoming', 'past'] },
            description: 'Restrict to future or past appointments',
          },
          ...paginationParams,
        ],
        responses: {
          200: pagedBookings('Page of the caller’s bookings'),
          401: unauthorized,
          403: forbidden('bookings:read'),
        },
      },
    })

    .get('/:id', controller.getBooking, {
      beforeHandle: permissionGuard('bookings:read'),
      detail: {
        tags: ['Bookings'],
        summary: 'Get one booking',
        description:
          'Readable by either side of the appointment — the user who booked it or the provider ' +
          'it was booked with. Anyone else gets 404.',
        ...bearer,
        ...bookingIdParam,
        responses: {
          200: okDoc('Booking detail', BOOKING_SHAPE, BOOKING_EXAMPLE),
          401: unauthorized,
          403: forbidden('bookings:read'),
          404: notYours,
        },
      },
    })

    .put('/:id', controller.updateBooking, {
      body: documented(updateBookingSchema),
      beforeHandle: permissionGuard('bookings:write'),
      detail: {
        tags: ['Bookings'],
        summary: 'Edit a booking’s time or notes',
        description:
          'Partial update — send only what changes. Only a booking in an editable status can be ' +
          'touched; a cancelled or completed one answers 400 naming its status. To move a ' +
          'confirmed appointment use `PATCH /bookings/{id}/reschedule`, which re-checks ' +
          'availability and notifies the other side.',
        ...bearer,
        ...bookingIdParam,
        requestBody: bodyDoc(updateBookingSchema),
        responses: {
          200: okDoc('Booking after the update', BOOKING_SHAPE, BOOKING_EXAMPLE),
          400: errorDoc(
            'Validation failed, or the booking’s status does not allow editing',
            'VALIDATION_ERROR',
          ),
          401: unauthorized,
          403: forbidden('bookings:write'),
          404: notYours,
        },
      },
    })

    .patch('/:id/cancel', controller.cancelBooking, {
      body: documented(cancelBookingSchema),
      beforeHandle: permissionGuard('bookings:cancel'),
      detail: {
        tags: ['Bookings'],
        summary: 'Cancel a booking',
        description:
          'Cancellation is its own permission (`bookings:cancel`), separate from ' +
          '`bookings:write`, so a client can be allowed to book without being allowed to cancel. ' +
          'The caller’s role is taken into account when applying the cancellation window. An ' +
          'already-cancelled or completed booking answers 400.',
        ...bearer,
        ...bookingIdParam,
        requestBody: bodyDoc(cancelBookingSchema),
        responses: {
          200: okDoc('Booking after cancellation', BOOKING_SHAPE),
          400: errorDoc(
            'Validation failed, or the booking’s status does not allow cancelling',
            'VALIDATION_ERROR',
          ),
          401: unauthorized,
          403: forbidden('bookings:cancel'),
          404: notYours,
        },
      },
    })

    .patch('/:id/reschedule', controller.rescheduleBooking, {
      body: documented(rescheduleSchema),
      beforeHandle: permissionGuard('bookings:write'),
      detail: {
        tags: ['Bookings'],
        summary: 'Move a booking to a new time',
        description:
          'Re-checks provider availability for the new window before committing, so this can ' +
          'fail with **409** exactly like creating a booking. Both new times are ISO-8601 UTC ' +
          'instants.',
        ...bearer,
        ...bookingIdParam,
        requestBody: bodyDoc(rescheduleSchema),
        responses: {
          200: okDoc('Booking at its new time', BOOKING_SHAPE),
          400: errorDoc(
            'Validation failed, or the booking’s status does not allow rescheduling',
            'VALIDATION_ERROR',
          ),
          401: unauthorized,
          403: forbidden('bookings:write'),
          404: notYours,
          409: errorDoc('The new time slot is not available', 'CONFLICT'),
        },
      },
    });

  // Provider-only section
  const providerRoutes = new Elysia()
    .use(authRequired)
    .use(providerRequired)

    .get('/provider', controller.listProviderBookings, {
      beforeHandle: permissionGuard('bookings:read'),
      detail: {
        tags: ['Provider Bookings'],
        summary: 'Bookings made with the calling provider',
        description:
          'The provider’s side of the diary. There is no provider id in the path — it is always ' +
          'the authenticated caller, so one provider cannot read another’s book.',
        ...bearer,
        parameters: [
          {
            name: 'status',
            in: 'query',
            required: false,
            schema: {
              type: 'string',
              enum: ['pending', 'confirmed', 'cancelled', 'completed', 'no_show'],
            },
          },
          {
            name: 'date',
            in: 'query',
            required: false,
            schema: { type: 'string', example: '2026-09-01' },
            description: 'Restrict to a single day, `YYYY-MM-DD`',
          },
          ...paginationParams,
        ],
        responses: {
          200: pagedBookings('Page of bookings made with this provider'),
          401: unauthorized,
          403: providerForbidden('bookings:read'),
        },
      },
    })

    .get('/provider/upcoming', controller.listProviderUpcomingBookings, {
      beforeHandle: permissionGuard('bookings:read'),
      detail: {
        tags: ['Provider Bookings'],
        summary: 'The calling provider’s upcoming appointments',
        description:
          'Future appointments only, soonest first. Same scoping as `/bookings/provider`.',
        ...bearer,
        parameters: paginationParams,
        responses: {
          200: pagedBookings('Page of upcoming bookings'),
          401: unauthorized,
          403: providerForbidden('bookings:read'),
        },
      },
    })

    .patch('/:id/confirm', controller.confirmBooking, {
      beforeHandle: permissionGuard('bookings:write'),
      detail: {
        tags: ['Provider Bookings'],
        summary: 'Confirm a pending booking (provider only)',
        description:
          'Moves a booking from `pending` to `confirmed` and notifies the person who booked it. ' +
          'Only the provider the booking was made with may call this; anybody else — including ' +
          'the user who created the booking — gets 404, not 403.',
        ...bearer,
        ...bookingIdParam,
        responses: {
          200: okDoc('Booking confirmed', BOOKING_SHAPE),
          400: errorDoc('Booking is not in a status that can be confirmed', 'BAD_REQUEST'),
          401: unauthorized,
          403: providerForbidden('bookings:write'),
          404: notYours,
        },
      },
    })

    .patch('/:id/complete', controller.completeBooking, {
      beforeHandle: permissionGuard('bookings:write'),
      detail: {
        tags: ['Provider Bookings'],
        summary: 'Mark a booking completed (provider only)',
        description:
          'Called after the session has happened. Only a `confirmed` booking can be completed; ' +
          'anything else answers 400 naming the current status.',
        ...bearer,
        ...bookingIdParam,
        responses: {
          200: okDoc('Booking completed', BOOKING_SHAPE),
          400: errorDoc('Booking is not in a status that can be completed', 'BAD_REQUEST'),
          401: unauthorized,
          403: providerForbidden('bookings:write'),
          404: notYours,
        },
      },
    })

    .patch('/:id/no-show', controller.markNoShow, {
      beforeHandle: permissionGuard('bookings:write'),
      detail: {
        tags: ['Provider Bookings'],
        summary: 'Mark a booking as a no-show (provider only)',
        description:
          'The other terminal state for a confirmed appointment the client did not attend. Same ' +
          'status rules as completing.',
        ...bearer,
        ...bookingIdParam,
        responses: {
          200: okDoc('Booking marked as no-show', BOOKING_SHAPE),
          400: errorDoc('Booking is not in a status that can be marked no-show', 'BAD_REQUEST'),
          401: unauthorized,
          403: providerForbidden('bookings:write'),
          404: notYours,
        },
      },
    });

  return new Elysia({ prefix: '/bookings' }).use(authRoutes).use(providerRoutes);
}
