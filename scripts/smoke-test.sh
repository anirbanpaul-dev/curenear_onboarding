#!/usr/bin/env bash
# Post-deploy smoke test. Requires curl plus a working admin account.
#
#   SMOKE_ADMIN_EMAIL=you@example.com SMOKE_ADMIN_PASSWORD='...' \
#     SMOKE_BASE_URL=https://app.example.com bash scripts/smoke-test.sh
#
# SMOKE_REQUIRE_READY=1 makes a 503 readiness response a failure. Without it,
# the script reports readiness but continues (useful before storage is wired).
set -euo pipefail

BASE="${SMOKE_BASE_URL:-http://localhost:3000}"
BASE="${BASE%/}"
EMAIL="${SMOKE_ADMIN_EMAIL:-}"
PASSWORD="${SMOKE_ADMIN_PASSWORD:-}"

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}
pass() {
  printf 'PASS: %s\n' "$*"
}

status() {
  curl -sS -o /dev/null -w '%{http_code}' --max-time 20 "$@"
}

[ -n "$EMAIL" ] || fail "SMOKE_ADMIN_EMAIL is required"
[ -n "$PASSWORD" ] || fail "SMOKE_ADMIN_PASSWORD is required"

HEALTH="$(status "$BASE/api/health")"
[ "$HEALTH" = "200" ] || fail "health returned $HEALTH (expected 200)"
pass "health 200"

READY="$(status "$BASE/api/ready")"
if [ "$READY" = "200" ]; then
  pass "ready 200"
elif [ "${SMOKE_REQUIRE_READY:-0}" = "1" ]; then
  fail "ready returned $READY (expected 200)"
else
  printf 'WARN: ready returned %s; set SMOKE_REQUIRE_READY=1 to make this fatal\n' "$READY"
fi

LOGIN_PAGE="$(status "$BASE/login")"
[ "$LOGIN_PAGE" = "200" ] || fail "login page returned $LOGIN_PAGE (expected 200)"
pass "login page 200"

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
LOGIN_STATUS="$(
  curl -sS -D "$TMP" -o /dev/null -w '%{http_code}' --max-time 20 \
    -H 'content-type: application/json' \
    -H "origin: $BASE" \
    --data "$(printf '{"email":"%s","password":"%s"}' "$EMAIL" "$PASSWORD")" \
    "$BASE/api/auth/login"
)"
[ "$LOGIN_STATUS" = "200" ] || fail "admin login returned $LOGIN_STATUS"
COOKIE="$(awk -F': ' 'tolower($1)=="set-cookie"{print $2}' "$TMP" | head -1 | cut -d';' -f1)"
[ -n "$COOKIE" ] || fail "login succeeded but no session cookie was returned"
pass "admin login 200"

ME_STATUS="$(status -H "cookie: $COOKIE" -H 'accept: application/json' "$BASE/api/auth/me")"
[ "$ME_STATUS" = "200" ] || fail "authenticated /api/auth/me returned $ME_STATUS"
pass "authenticated API call 200 (/api/auth/me)"

printf '\nSmoke test passed for %s\n' "$BASE"
