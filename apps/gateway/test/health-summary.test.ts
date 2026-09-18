/**
 * Gateway health rules (M-W8-4). Pure — no services.
 *
 *   bun test apps/gateway/test/health-summary.test.ts
 */
import { describe, expect, test } from 'bun:test';
import { GATEWAY_DOWNSTREAMS } from '@longeny/config';
import { type Probe, summariseHealth } from '../src/health/summarise.js';

const healthy = (names: readonly string[]): Probe[] =>
  names.map((name) => ({ name: name as Probe['name'], status: 'healthy', statusCode: 200 }));

describe('summariseHealth', () => {
  test('everything expected and healthy → healthy', () => {
    const r = summariseHealth(GATEWAY_DOWNSTREAMS, [], healthy(GATEWAY_DOWNSTREAMS));
    expect(r.status).toBe('healthy');
    expect(r.failing).toEqual([]);
  });

  test('a service that is not deployed here is not a fault', () => {
    const r = summariseHealth(
      GATEWAY_DOWNSTREAMS,
      ['booking', 'payment'],
      healthy(['auth', 'user-provider', 'ai-content']),
    );
    expect(r.status).toBe('healthy');
    expect(r.notDeployed).toEqual(['booking', 'payment']);
    expect(r.services.find((s) => s.name === 'booking')?.status).toBe('not_deployed');
  });

  test('an expected service down → unhealthy, and it is named', () => {
    const probes: Probe[] = [
      ...healthy(['auth', 'user-provider']),
      { name: 'ai-content', status: 'unreachable' },
    ];
    const r = summariseHealth(GATEWAY_DOWNSTREAMS, ['booking', 'payment'], probes);
    expect(r.status).toBe('unhealthy');
    expect(r.failing).toEqual(['ai-content']);
  });

  test('an expected service answering 500 is unhealthy, not reachable-therefore-fine', () => {
    const probes: Probe[] = [
      ...healthy(['auth', 'user-provider', 'booking', 'payment']),
      { name: 'ai-content', status: 'unhealthy', statusCode: 500 },
    ];
    const r = summariseHealth(GATEWAY_DOWNSTREAMS, [], probes);
    expect(r.failing).toEqual(['ai-content']);
    expect(r.services.find((s) => s.name === 'ai-content')?.statusCode).toBe(500);
  });

  test('an expected service with no probe result is not assumed healthy', () => {
    const r = summariseHealth(GATEWAY_DOWNSTREAMS, [], healthy(['auth']));
    expect(r.status).toBe('unhealthy');
    expect(r.failing).toContain('payment');
  });

  test('the gateway itself is always reported separately', () => {
    const r = summariseHealth(GATEWAY_DOWNSTREAMS, [], []);
    expect(r.gateway).toBe('healthy');
    expect(r.status).toBe('unhealthy');
  });

  test('every downstream is listed, expected or not', () => {
    const r = summariseHealth(GATEWAY_DOWNSTREAMS, ['payment'], []);
    expect(r.services.map((s) => s.name)).toEqual([...GATEWAY_DOWNSTREAMS]);
  });
});
