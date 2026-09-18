import type { GatewayDownstream } from '@longeny/config';

/**
 * What the gateway's health means.
 *
 * It used to answer 503 whenever any downstream was missing. booking and
 * payment are deliberately not deployed on the dev box, so it read `degraded`
 * permanently — and a real outage looked exactly like the normal state. The
 * deploy health gate once called a perfectly healthy gateway dead for that reason.
 *
 * Now a downstream is either expected here or not. One that is not expected is
 * `not_deployed` and is not a fault. One that is expected and does not answer
 * healthy makes the whole report unhealthy, on the first check.
 */

export type ProbeStatus = 'healthy' | 'unhealthy' | 'unreachable';

export interface Probe {
  name: GatewayDownstream;
  status: ProbeStatus;
  statusCode?: number;
}

export interface ServiceHealth {
  name: GatewayDownstream;
  expected: boolean;
  status: ProbeStatus | 'not_deployed';
  statusCode?: number;
}

export interface HealthReport {
  /** The aggregate: every expected downstream is healthy. */
  status: 'healthy' | 'unhealthy';
  /** The gateway process itself. If it answered, it is up. */
  gateway: 'healthy';
  services: ServiceHealth[];
  /** Names of expected downstreams that are not healthy — the thing to act on. */
  failing: GatewayDownstream[];
  notDeployed: GatewayDownstream[];
}

export function summariseHealth(
  all: readonly GatewayDownstream[],
  absent: readonly GatewayDownstream[],
  probes: readonly Probe[],
): HealthReport {
  const byName = new Map(probes.map((p) => [p.name, p]));

  const services: ServiceHealth[] = all.map((name) => {
    if (absent.includes(name)) return { name, expected: false, status: 'not_deployed' };
    // An expected service that was never probed is not assumed healthy.
    const probe = byName.get(name) ?? { name, status: 'unreachable' as const };
    return {
      name,
      expected: true,
      status: probe.status,
      ...(probe.statusCode === undefined ? {} : { statusCode: probe.statusCode }),
    };
  });

  const failing = services.filter((s) => s.expected && s.status !== 'healthy').map((s) => s.name);

  return {
    status: failing.length === 0 ? 'healthy' : 'unhealthy',
    gateway: 'healthy',
    services,
    failing,
    notDeployed: services.filter((s) => !s.expected).map((s) => s.name),
  };
}
