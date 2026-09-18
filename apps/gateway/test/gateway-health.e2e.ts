/**
 * Gateway health honesty, end to end (M-W8-4).
 *
 * Starts real gateway processes on spare ports with different
 * GATEWAY_ABSENT_SERVICES settings and reads their /health. The downstreams are
 * whatever is running locally; the suite needs auth, user-provider and
 * ai-content up (run-e2e.sh starts them) and uses a closed port to stand in for
 * a service that has died.
 *
 *   set -a; source .env; set +a
 *   bun run apps/gateway/test/gateway-health.e2e.ts
 */
import { type Subprocess, spawn } from 'bun';

const DEAD = 'http://127.0.0.1:3999'; // nothing listens here

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean, detail?: unknown) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`);
  }
}

const running: Subprocess[] = [];

async function gateway(port: number, env: Record<string, string>) {
  const proc = spawn(['bun', 'run', 'apps/gateway/src/index.ts'], {
    env: { ...process.env, GATEWAY_PORT: String(port), ...env },
    stdout: 'ignore',
    stderr: 'pipe',
  });
  running.push(proc);
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://localhost:${port}/health/live`);
      if (res.ok) return proc;
    } catch {}
    await Bun.sleep(250);
  }
  return proc;
}

async function health(port: number) {
  const res = await fetch(`http://localhost:${port}/health`);
  return { status: res.status, body: (await res.json()) as any };
}

try {
  console.log('\n1. booking and payment configured as not deployed');
  await gateway(3091, {
    GATEWAY_ABSENT_SERVICES: 'booking,payment',
    BOOKING_SERVICE_URL: DEAD,
    PAYMENT_SERVICE_URL: DEAD,
  });
  let r = await health(3091);
  check('200 — their absence is not an outage', r.status === 200, r);
  check('status healthy', r.body.status === 'healthy', r.body);
  check(
    'and they are named as not deployed',
    JSON.stringify(r.body.notDeployed) === JSON.stringify(['booking', 'payment']),
    r.body.notDeployed,
  );
  check('nothing failing', r.body.failing?.length === 0, r.body.failing);

  console.log('\n2. an expected service is down');
  await gateway(3092, {
    GATEWAY_ABSENT_SERVICES: 'booking,payment',
    AI_CONTENT_SERVICE_URL: DEAD,
  });
  r = await health(3092);
  check('503 on the first check', r.status === 503, r.status);
  check('status unhealthy', r.body.status === 'unhealthy', r.body);
  check(
    'the dead one is named',
    JSON.stringify(r.body.failing) === '["ai-content"]',
    r.body.failing,
  );
  check('the gateway itself still says it is up', r.body.gateway === 'healthy', r.body);
  const live = await fetch('http://localhost:3092/health/live');
  check('/health/live is 200 — the process is fine', live.status === 200, live.status);

  console.log('\n3. nothing configured absent, booking missing');
  await gateway(3093, {
    GATEWAY_ABSENT_SERVICES: '',
    BOOKING_SERVICE_URL: DEAD,
    PAYMENT_SERVICE_URL: DEAD,
  });
  r = await health(3093);
  check('a service that should be here and is not → 503', r.status === 503, r.status);
  check(
    'both are failing, not "not deployed"',
    JSON.stringify(r.body.failing) === '["booking","payment"]',
    r.body.failing,
  );

  console.log('\n4. a misspelt service name');
  const bad = spawn(['bun', 'run', 'apps/gateway/src/index.ts'], {
    env: { ...process.env, GATEWAY_PORT: '3094', GATEWAY_ABSENT_SERVICES: 'bookings' },
    stdout: 'ignore',
    stderr: 'ignore',
  });
  running.push(bad);
  const code = await Promise.race([bad.exited, Bun.sleep(8000).then(() => 'still running')]);
  check(
    'stops the gateway at boot rather than being ignored',
    code !== 'still running' && code !== 0,
    code,
  );
} finally {
  for (const proc of running) proc.kill();
}

console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed === 0 ? 0 : 1);
