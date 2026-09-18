#!/usr/bin/env bash
#
# Run every end-to-end suite against real infrastructure, in dependency order.
#
# The rules this follows are in prep/testing/README.md: real Postgres and Redis,
# no mocks, database-first verification, each suite responsible for its own data.
# Auth must pass before the services that trust its tokens.
#
# Usage:
#   ./scripts/run-e2e.sh              # start what is needed, run everything, stop what it started
#   ./scripts/run-e2e.sh --keep       # leave the services running afterwards
#
# It never stops a service it did not start, so a dev server you already have on
# :3002 survives the run.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

KEEP=0
[[ "${1:-}" == "--keep" ]] && KEEP=1

RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; BOLD=$'\033[1m'; OFF=$'\033[0m'

STARTED_PIDS=()
LOG_DIR="$(mktemp -d)"
FAILED_SUITES=()
PASSED_SUITES=()

cleanup() {
  if [[ $KEEP -eq 1 ]]; then
    echo "${YELLOW}--keep: leaving ${#STARTED_PIDS[@]} service(s) running${OFF}"
    return
  fi
  for pid in "${STARTED_PIDS[@]:-}"; do
    [[ -n "$pid" ]] && kill "$pid" 2>/dev/null
  done
}
trap cleanup EXIT

# ── Preconditions ────────────────────────────────────────────────────────────

if [[ ! -f .env ]]; then
  echo "${RED}.env not found — the suites need JWT_ACCESS_SECRET and HMAC_SECRET${OFF}"
  exit 1
fi
set -a; source .env; set +a

# w7mail is a real SMTP server. The calendar-invite suite reads the delivered
# message out of it — a fake transport would let a broken send pass.
# w8s3 is LocalStack S3 with signature validation ON, so "S3 refused the
# upload" is S3 checking the signed size and type, not LocalStack ignoring them.
for container in w7pg w7redis w7mail w8s3; do
  if ! docker ps --format '{{.Names}}' | grep -qx "$container"; then
    echo "${RED}container '$container' is not running${OFF}"
    if [[ "$container" == "w8s3" ]]; then
      echo "  docker run -d --name w8s3 -p 4566:4566 -e SERVICES=s3 -e S3_SKIP_SIGNATURE_VALIDATION=0 localstack/localstack:3"
      echo "  docker start w8s3   # if it already exists"
    elif [[ "$container" == "w7mail" ]]; then
      echo "  docker run -d --name w7mail -p 1026:1025 -p 8026:8025 axllent/mailpit:latest"
      echo "  docker start w7mail   # if it already exists"
    else
      echo "  docker start $container"
    fi
    exit 1
  fi
done

export MAILPIT_URL="${MAILPIT_URL:-http://localhost:8026}"

# ── Service management ───────────────────────────────────────────────────────

# already_listening <port>
already_listening() { ss -lntH "sport = :$1" 2>/dev/null | grep -q .; }

# healthy_service <port> <expected-name>
# Bun binds with SO_REUSEPORT, so a second listener on a busy port succeeds and
# traffic is split silently. A plain 200 therefore proves nothing — the health
# body has to name the service we expect.
healthy_service() {
  local body
  body=$(curl -sf --max-time 3 "http://localhost:$1/health" 2>/dev/null) || return 1
  # The gateway aggregates downstream health and names itself differently; its
  # own status is "healthy" even while it reports the whole stack as degraded.
  if [[ "$2" == "gateway" ]]; then
    grep -q '"gateway":"healthy"' <<< "$body"
  else
    grep -q "\"service\":\"$2\"" <<< "$body"
  fi
}

# start_service <dir> <port-var> <port> <label>
start_service() {
  local dir=$1 port_var=$2 port=$3 label=$4
  local service_name=$dir

  if already_listening "$port"; then
    if healthy_service "$port" "$service_name"; then
      echo "  ${label}: already on :${port}, using it"
      return 0
    fi
    echo "${RED}  ${label}: :${port} is held by something that is not ${service_name}${OFF}"
    echo "    ss -lptn 'sport = :${port}'   # find it, stop it by pid, re-run"
    return 1
  fi

  ( cd "apps/$dir" && env "$port_var=$port" bun run src/index.ts > "$LOG_DIR/$label.log" 2>&1 & )
  sleep 6

  for _ in $(seq 1 10); do
    if healthy_service "$port" "$service_name"; then
      # Record the pid so cleanup only stops what this script started.
      local pid
      pid=$(ss -lptnH "sport = :$port" 2>/dev/null | grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2)
      STARTED_PIDS+=("$pid")
      echo "  ${label}: started on :${port} (pid $pid)"
      return 0
    fi
    sleep 2
  done

  echo "${RED}  ${label}: failed to become healthy on :${port}${OFF}"
  tail -5 "$LOG_DIR/$label.log"
  return 1
}

# run_suite <label> <base-url> <command...>
# The base URL is passed explicitly because each suite defaults to the port its
# author developed against; the runner owns the real ports.
run_suite() {
  local label=$1 base=$2; shift 2
  echo
  echo "${BOLD}── $label${OFF}"
  local out
  out=$(TEST_BASE_URL="$base" "$@" 2>&1)
  local status=$?
  echo "$out" | tail -25
  if [[ $status -eq 0 ]]; then
    PASSED_SUITES+=("$label")
  else
    FAILED_SUITES+=("$label")
  fi
}

# ── Phase 1 — schemas ────────────────────────────────────────────────────────

echo "${BOLD}Phase 1 — schema${OFF}"
( cd apps/user-provider-service && bunx drizzle-kit migrate >/dev/null 2>&1 ) \
  && echo "  user-provider: migrations applied" \
  || echo "${YELLOW}  user-provider: migrate reported an issue — continuing${OFF}"

( cd apps/ai-content-service && bunx drizzle-kit migrate >/dev/null 2>&1 ) \
  && echo "  ai-content: migrations applied" \
  || echo "${YELLOW}  ai-content: migrate reported an issue — continuing${OFF}"

( cd apps/booking-service && bunx drizzle-kit migrate >/dev/null 2>&1 ) \
  && echo "  booking: migrations applied" \
  || echo "${YELLOW}  booking: migrate reported an issue — continuing${OFF}"

( cd apps/payment-service && bunx drizzle-kit migrate >/dev/null 2>&1 ) \
  && echo "  payment: migrations applied" \
  || echo "${YELLOW}  payment: migrate reported an issue — continuing${OFF}"

docker exec -i w7pg psql -U longeny -d longeny_core \
  < apps/user-provider-service/src/db/enforce-append-only.sql >/dev/null 2>&1 \
  && echo "  audit tables (core): append-only triggers installed"

docker exec -i w7pg psql -U longeny -d longeny_ai_content \
  < apps/ai-content-service/src/db/enforce-append-only.sql >/dev/null 2>&1 \
  && echo "  audit tables (ai-content): append-only triggers installed"

# ── Phase 2 — services ───────────────────────────────────────────────────────

echo
echo "${BOLD}Phase 2 — services${OFF}"
start_service auth-service          AUTH_SERVICE_PORT          3001 auth
start_service user-provider-service USER_PROVIDER_SERVICE_PORT 3002 user-provider
start_service booking-service       BOOKING_SERVICE_PORT       3003 booking
start_service ai-content-service    AI_CONTENT_SERVICE_PORT    3004 ai-content
start_service payment-service       PAYMENT_SERVICE_PORT       3005 payment
start_service gateway               GATEWAY_PORT               3000 gateway

# ── Phase 3 — suites, in dependency order ────────────────────────────────────

echo
echo "${BOLD}Phase 3 — suites${OFF}"

# label | base url | path — auth first, since the rest trust its tokens
for suite in \
  "auth+rbac|http://localhost:3001|apps/auth-service/test/auth-rbac.e2e.ts" \
  "profiles+rro|http://localhost:3002|apps/user-provider-service/test/profiles-rro.e2e.ts" \
  "profile scoping|http://localhost:3002|apps/user-provider-service/test/profile-scoping.e2e.ts" \
  "compliance|http://localhost:3002|apps/user-provider-service/test/compliance.e2e.ts" \
  "intake+rro|http://localhost:3004|apps/ai-content-service/test/intake-rro.e2e.ts" \
  "ai classify+summary|http://localhost:3004|apps/ai-content-service/test/ai-classify.e2e.ts" \
  "reports timeline|http://localhost:3004|apps/ai-content-service/test/reports-timeline.e2e.ts" \
  "benchmarks|http://localhost:3004|apps/ai-content-service/test/benchmarks.e2e.ts" \
  "readings|http://localhost:3004|apps/ai-content-service/test/readings.e2e.ts" \
  "trends|http://localhost:3004|apps/ai-content-service/test/trends.e2e.ts" \
  "report storage|http://localhost:3004|apps/ai-content-service/test/report-storage.e2e.ts" \
  "scores|http://localhost:3004|apps/ai-content-service/test/scores.e2e.ts" \
  "booking profiles+invite|http://localhost:3003|apps/booking-service/test/booking-profile.e2e.ts" \
  "payments rbac|http://localhost:3005|apps/payment-service/test/payments-rbac.e2e.ts" \
  "bookings ownership|http://localhost:3003|apps/booking-service/test/bookings-ownership.e2e.ts" \
  "gateway routing|http://localhost:3000|apps/gateway/test/gateway-routing.e2e.ts" \
  "gateway health|http://localhost:3000|apps/gateway/test/gateway-health.e2e.ts" \
; do
  IFS='|' read -r label base path <<< "$suite"
  [[ -f "$path" ]] && run_suite "$label" "$base" bun run "$path"
done

# bun test files (assertion-style, not the plain-script style)
[[ -f apps/booking-service/test/calendar-oauth-state.test.ts ]] && \
  run_suite "calendar oauth state" "http://localhost:3003" \
    bun test apps/booking-service/test/calendar-oauth-state.test.ts

[[ -f apps/gateway/test/health-summary.test.ts ]] && \
  run_suite "gateway health rules" "http://localhost:3000" \
    bun test apps/gateway/test/health-summary.test.ts

[[ -f apps/ai-content-service/test/eval-scoring.test.ts ]] && \
  run_suite "eval scorers" "http://localhost:3004" \
    bun test apps/ai-content-service/test/eval-scoring.test.ts

# Pure engines — benchmark, trend and scoring rules
for t in apps/ai-content-service/test/*-engine.test.ts; do
  [[ -f "$t" ]] && run_suite "$(basename "$t" .test.ts)" "http://localhost:3004" bun test "$t"
done

# ── Summary ──────────────────────────────────────────────────────────────────

echo
echo "${BOLD}════ Summary ════${OFF}"
for s in "${PASSED_SUITES[@]:-}"; do [[ -n "$s" ]] && echo "  ${GREEN}pass${OFF}  $s"; done
for s in "${FAILED_SUITES[@]:-}"; do [[ -n "$s" ]] && echo "  ${RED}FAIL${OFF}  $s"; done

if [[ ${#FAILED_SUITES[@]} -gt 0 ]]; then
  echo
  echo "${RED}${#FAILED_SUITES[@]} suite(s) failed. Service logs: $LOG_DIR${OFF}"
  exit 1
fi

echo
echo "${GREEN}All suites passed.${OFF}"
