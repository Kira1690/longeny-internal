/**
 * Calendar OAuth `state` binding.
 *
 * `state` used to travel as the bare provider id and the callback wrote the
 * caller's Google tokens to whichever id came back, so any authenticated
 * provider could hand back a victim's id and take over the victim's calendar
 * link — and with it the availability every booking is checked against.
 *
 * These tests pin the two locks that replaced it: the state is signed with the
 * service secret, and the provider it names must be the authenticated caller.
 *
 * No database and no Google call is reached — every case here is rejected
 * before the token exchange, except the one positive check, which is asserted
 * only to have got *past* the state gate.
 *
 * Run:
 *   set -a; source .env; set +a
 *   bun test apps/booking-service/test/calendar-oauth-state.test.ts
 */
import { describe, expect, test } from 'bun:test';
import { createHmac, randomUUID } from 'node:crypto';
import { bookingConfigSchema } from '@longeny/config';
import { BadRequestError } from '@longeny/errors';
import { CalendarService } from '../src/services/calendar.service.js';

const config = bookingConfigSchema.parse({
  BOOKING_DATABASE_URL: process.env.BOOKING_DATABASE_URL ?? 'postgresql://unused/unused',
  HMAC_SECRET: 'calendar-oauth-state-test-secret',
  ENCRYPTION_KEY: 'calendar-oauth-state-test-key',
});

const service = new CalendarService(null, config);

const VICTIM = randomUUID();
const ATTACKER = randomUUID();

const STATE_REJECTION = 'Invalid or expired OAuth state';

function stateFor(providerId: string): string {
  const state = new URL(service.getAuthUrl(providerId)).searchParams.get('state');
  if (!state) throw new Error('auth url carried no state');
  return state;
}

/** Correctly signed, but its deadline has already passed. */
function expiredStateFor(providerId: string): string {
  const payload = `${providerId}.${'0'.repeat(32)}.${Date.now() - 1}`;
  const signature = createHmac('sha256', config.HMAC_SECRET).update(payload).digest('hex');
  return `${Buffer.from(payload).toString('base64url')}.${signature}`;
}

async function rejection(state: string, caller: string): Promise<unknown> {
  return service.handleCallback('irrelevant-code', state, caller).then(
    () => null,
    (error: unknown) => error,
  );
}

describe('calendar OAuth state', () => {
  test('the auth url does not hand the provider id back as state', () => {
    const state = stateFor(VICTIM);
    expect(state).not.toBe(VICTIM);
    expect(state.includes(VICTIM)).toBe(false);
  });

  test('a forged state — the victim id, as it used to be sent — is rejected', async () => {
    const error = await rejection(VICTIM, ATTACKER);
    expect(error).toBeInstanceOf(BadRequestError);
    expect((error as Error).message).toBe(STATE_REJECTION);
  });

  test("the victim's own signed state is rejected when the attacker replays it", async () => {
    const error = await rejection(stateFor(VICTIM), ATTACKER);
    expect(error).toBeInstanceOf(BadRequestError);
    expect((error as Error).message).toBe(STATE_REJECTION);
  });

  test('a state with a tampered signature is rejected', async () => {
    const [encoded] = stateFor(ATTACKER).split('.');
    const error = await rejection(`${encoded}.${'0'.repeat(64)}`, ATTACKER);
    expect(error).toBeInstanceOf(BadRequestError);
    expect((error as Error).message).toBe(STATE_REJECTION);
  });

  test('an expired state is rejected', async () => {
    const error = await rejection(expiredStateFor(ATTACKER), ATTACKER);
    expect(error).toBeInstanceOf(BadRequestError);
    expect((error as Error).message).toBe(STATE_REJECTION);
  });

  test('an unauthenticated caller (empty id) cannot use a valid state', async () => {
    const error = await rejection(stateFor(VICTIM), '');
    expect(error).toBeInstanceOf(BadRequestError);
    expect((error as Error).message).toBe(STATE_REJECTION);
  });

  test('the provider that started the flow gets past the state gate', async () => {
    // Google is not driven from a test, so this still fails — but on the
    // token exchange, which is the proof that the state check let it through.
    const error = await rejection(stateFor(VICTIM), VICTIM);
    expect(error).not.toBeNull();
    expect((error as Error).message).not.toBe(STATE_REJECTION);
  }, 30_000);
});
