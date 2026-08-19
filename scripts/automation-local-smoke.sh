#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

for command in supabase docker curl node; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Missing required command: $command" >&2
    exit 1
  fi
done

cleanup() {
  if [[ -n "${FUNCTION_PID:-}" ]]; then
    kill "$FUNCTION_PID" >/dev/null 2>&1 || true
  fi
  supabase stop --no-backup >/dev/null 2>&1 || true
  rm -f "${AUTOMATION_ENV_FILE:-}" "${FUNCTION_LOG:-}" "${PULSE_BODY_FILE:-}"
}
trap cleanup EXIT

json_get() {
  local path="$1"
  node -e '
    const fs = require("fs");
    const path = process.argv[1].split(".");
    let value = JSON.parse(fs.readFileSync(0, "utf8"));
    for (const part of path) value = value?.[Number.isInteger(Number(part)) && String(Number(part)) === part ? Number(part) : part];
    if (value === undefined || value === null) process.exit(2);
    process.stdout.write(typeof value === "string" ? value : JSON.stringify(value));
  ' "$path"
}

new_uuid() {
  node -e 'console.log(require("crypto").randomUUID())'
}

assert_http_code() {
  local actual="$1"
  local expected="$2"
  local label="$3"
  if [[ "$actual" != "$expected" ]]; then
    echo "[$label] expected HTTP $expected, received $actual" >&2
    if [[ -n "${FUNCTION_LOG:-}" && -f "$FUNCTION_LOG" ]]; then
      tail -n 120 "$FUNCTION_LOG" >&2 || true
    fi
    exit 1
  fi
}

canonical_json_equal() {
  node -e '
    const [left, right] = process.argv.slice(1).map(JSON.parse);
    const sort = (value) => Array.isArray(value)
      ? value.map(sort)
      : value && typeof value === "object"
        ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, sort(value[key])]))
        : value;
    if (JSON.stringify(sort(left)) !== JSON.stringify(sort(right))) process.exit(1);
  ' "$1" "$2"
}

echo "[automation-smoke] starting isolated local Supabase stack"
supabase start
supabase db reset

# Trusted output from the local CLI only.
eval "$(supabase status -o env | grep -E '^(API_URL|ANON_KEY|SERVICE_ROLE_KEY)=')"
: "${API_URL:?API_URL missing from supabase status}"
: "${ANON_KEY:?ANON_KEY missing from supabase status}"
: "${SERVICE_ROLE_KEY:?SERVICE_ROLE_KEY missing from supabase status}"

AUTOMATION_INTERNAL_SECRET="local-$(node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("hex"))')"
AUTOMATION_HASH_SECRET="local-$(node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("hex"))')"
AUTOMATION_ENV_FILE="$(mktemp)"
cat > "$AUTOMATION_ENV_FILE" <<EOF
MF_N8N_INTERNAL_SECRET=$AUTOMATION_INTERNAL_SECRET
MF_AUTOMATION_HASH_SECRET=$AUTOMATION_HASH_SECRET
EOF

FUNCTION_LOG="$(mktemp)"
supabase functions serve mf-automation-gateway \
  --no-verify-jwt \
  --env-file "$AUTOMATION_ENV_FILE" \
  >"$FUNCTION_LOG" 2>&1 &
FUNCTION_PID=$!

FUNCTION_URL="$API_URL/functions/v1/mf-automation-gateway"
for _ in $(seq 1 45); do
  code="$(curl -sS -o /dev/null -w '%{http_code}' \
    -X POST "$FUNCTION_URL" \
    -H 'Content-Type: application/json' \
    -H 'x-mf-internal-secret: boot-probe' \
    -d '{}' || true)"
  if [[ "$code" != "000" ]]; then
    break
  fi
  sleep 1
done
if [[ "${code:-000}" == "000" ]]; then
  echo "mf-automation-gateway did not start" >&2
  cat "$FUNCTION_LOG" >&2 || true
  exit 1
fi

echo "[automation-smoke] creating isolated fake user"
EMAIL="automation-smoke-$(date +%s)-$RANDOM@example.test"
PASSWORD="LocalSmoke-$(node -e 'process.stdout.write(require("crypto").randomBytes(12).toString("hex"))')!"
SIGNUP_RESPONSE="$(curl -sS \
  -X POST "$API_URL/auth/v1/signup" \
  -H "apikey: $ANON_KEY" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")"
USER_ID="$(printf '%s' "$SIGNUP_RESPONSE" | json_get 'user.id')"
USER_TOKEN="$(printf '%s' "$SIGNUP_RESPONSE" | json_get 'access_token' 2>/dev/null || true)"

if [[ -z "$USER_TOKEN" ]]; then
  LOGIN_RESPONSE="$(curl -sS \
    -X POST "$API_URL/auth/v1/token?grant_type=password" \
    -H "apikey: $ANON_KEY" \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")"
  USER_TOKEN="$(printf '%s' "$LOGIN_RESPONSE" | json_get 'access_token')"
fi

PREF_CODE="$(curl -sS -o /tmp/mf-automation-pref.json -w '%{http_code}' \
  -X POST "$API_URL/rest/v1/mf_automation_preferences" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $USER_TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Prefer: return=representation' \
  -d "{\"user_id\":\"$USER_ID\",\"enabled\":true,\"smart_notifications_enabled\":true,\"pulse_enabled\":true,\"budget_watch_enabled\":true,\"card_watch_enabled\":true,\"goal_watch_enabled\":true,\"financial_agenda_enabled\":true,\"smart_recurrence_enabled\":true,\"data_quality_enabled\":true}")"
assert_http_code "$PREF_CODE" "201" "preference insert under RLS"

DIRECT_NOTIFICATION_CODE="$(curl -sS -o /tmp/mf-automation-direct-notification.json -w '%{http_code}' \
  -X POST "$API_URL/rest/v1/mf_automation_notifications" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $USER_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"user_id\":\"$USER_ID\",\"title\":\"Direct insert\",\"message\":\"Must fail\"}")"
if [[ "$DIRECT_NOTIFICATION_CODE" =~ ^2 ]]; then
  echo "Authenticated browser unexpectedly inserted automation notification directly" >&2
  exit 1
fi

echo "[automation-smoke] verifying custom S2S authentication"
UNAUTHORIZED_CODE="$(curl -sS -o /tmp/mf-automation-unauthorized.json -w '%{http_code}' \
  -X POST "$FUNCTION_URL" \
  -H 'Content-Type: application/json' \
  -H 'x-mf-internal-secret: wrong-secret' \
  -d '{}')"
assert_http_code "$UNAUTHORIZED_CODE" "401" "wrong internal secret"

echo "[automation-smoke] discovering enabled pulse target without exposing user_id"
TARGET_CORRELATION="$(new_uuid)"
TARGET_REQUEST="$(cat <<EOF
{"version":"1.0.0","action":"targets.list","correlation_id":"$TARGET_CORRELATION","idempotency_key":"targets.list:$TARGET_CORRELATION","payload":{"module":"pulse","limit":10}}
EOF
)"
TARGET_RESPONSE="$(curl -fsS \
  -X POST "$FUNCTION_URL" \
  -H 'Content-Type: application/json' \
  -H "x-mf-internal-secret: $AUTOMATION_INTERNAL_SECRET" \
  -d "$TARGET_REQUEST")"
TARGET_COUNT="$(printf '%s' "$TARGET_RESPONSE" | json_get 'data.count')"
if [[ "$TARGET_COUNT" != "1" ]]; then
  echo "Expected exactly one pulse target, received $TARGET_COUNT" >&2
  echo "$TARGET_RESPONSE" >&2
  exit 1
fi
if printf '%s' "$TARGET_RESPONSE" | grep -q "$USER_ID"; then
  echo "targets.list leaked raw user_id" >&2
  exit 1
fi
CONTEXT_REF="$(printf '%s' "$TARGET_RESPONSE" | json_get 'data.targets.0.user_context.context_ref')"

echo "[automation-smoke] verifying pulse context + idempotent replay"
PULSE_CORRELATION="$(new_uuid)"
PULSE_REQUEST="$(cat <<EOF
{"version":"1.0.0","action":"pulse.context","correlation_id":"$PULSE_CORRELATION","idempotency_key":"pulse.context:$PULSE_CORRELATION","user_context":{"context_ref":"$CONTEXT_REF","mode":"automation_initiated","scope":"pulse"},"payload":{}}
EOF
)"
PULSE_BODY_FILE="$(mktemp)"
PULSE_CODE="$(curl -sS -o "$PULSE_BODY_FILE" -w '%{http_code}' \
  -X POST "$FUNCTION_URL" \
  -H 'Content-Type: application/json' \
  -H "x-mf-internal-secret: $AUTOMATION_INTERNAL_SECRET" \
  -d "$PULSE_REQUEST")"
if [[ "$PULSE_CODE" != "200" ]]; then
  echo "[pulse.context] expected HTTP 200, received $PULSE_CODE" >&2
  cat "$PULSE_BODY_FILE" >&2 || true
  echo >&2
  tail -n 120 "$FUNCTION_LOG" >&2 || true
  exit 1
fi
PULSE_RESPONSE_1="$(cat "$PULSE_BODY_FILE")"
PULSE_RESPONSE_2="$(curl -fsS \
  -X POST "$FUNCTION_URL" \
  -H 'Content-Type: application/json' \
  -H "x-mf-internal-secret: $AUTOMATION_INTERNAL_SECRET" \
  -d "$PULSE_REQUEST")"
canonical_json_equal "$PULSE_RESPONSE_1" "$PULSE_RESPONSE_2"
printf '%s' "$PULSE_RESPONSE_1" | json_get 'data.next_action' >/dev/null

echo "[automation-smoke] rejecting forbidden financial payload"
FORBIDDEN_CORRELATION="$(new_uuid)"
FORBIDDEN_CODE="$(curl -sS -o /tmp/mf-automation-forbidden.json -w '%{http_code}' \
  -X POST "$FUNCTION_URL" \
  -H 'Content-Type: application/json' \
  -H "x-mf-internal-secret: $AUTOMATION_INTERNAL_SECRET" \
  -d "{\"version\":\"1.0.0\",\"action\":\"notification.create\",\"correlation_id\":\"$FORBIDDEN_CORRELATION\",\"idempotency_key\":\"notification.create:$FORBIDDEN_CORRELATION\",\"user_context\":{\"context_ref\":\"$CONTEXT_REF\",\"mode\":\"automation_initiated\",\"scope\":\"notifications\"},\"payload\":{\"amount\":10}}")"
assert_http_code "$FORBIDDEN_CODE" "400" "forbidden financial payload"
FORBIDDEN_ERROR="$(cat /tmp/mf-automation-forbidden.json | json_get 'error.code')"
if [[ "$FORBIDDEN_ERROR" != "AUTOMATION_PAYLOAD_FORBIDDEN_FIELD" ]]; then
  echo "Unexpected forbidden payload error: $FORBIDDEN_ERROR" >&2
  exit 1
fi

echo "[automation-smoke] creating sanitized notification through gateway"
NOTIFICATION_CORRELATION="$(new_uuid)"
NOTIFICATION_REQUEST="$(cat <<EOF
{"version":"1.0.0","action":"notification.create","correlation_id":"$NOTIFICATION_CORRELATION","idempotency_key":"notification.create:$NOTIFICATION_CORRELATION","user_context":{"context_ref":"$CONTEXT_REF","mode":"automation_initiated","scope":"notifications"},"payload":{"type":"smoke","priority":"ATTENTION","title":"Revisão disponível","message":"Há um ponto para revisar no MF Financeiro.","action_path":"/app","dedupe_key":"local-smoke-notification"}}
EOF
)"
NOTIFICATION_RESPONSE="$(curl -fsS \
  -X POST "$FUNCTION_URL" \
  -H 'Content-Type: application/json' \
  -H "x-mf-internal-secret: $AUTOMATION_INTERNAL_SECRET" \
  -d "$NOTIFICATION_REQUEST")"
printf '%s' "$NOTIFICATION_RESPONSE" | json_get 'data.reference' >/dev/null

FEED_RESPONSE="$(curl -fsS \
  "$API_URL/rest/v1/mf_automation_notifications?select=id,title,status,source&status=eq.unread" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $USER_TOKEN")"
FEED_COUNT="$(node -e 'const rows=JSON.parse(process.argv[1]); process.stdout.write(String(rows.length));' "$FEED_RESPONSE")"
if [[ "$FEED_COUNT" != "1" ]]; then
  echo "Expected one visible automation notification under RLS, received $FEED_COUNT" >&2
  echo "$FEED_RESPONSE" >&2
  exit 1
fi

if grep -Eiq '(service_role|access_token|refresh_token|authorization|cpf|cnpj|card_number|statement_balance)' "$FUNCTION_LOG"; then
  echo "Function log contains a forbidden secret/PII field name" >&2
  cat "$FUNCTION_LOG" >&2
  exit 1
fi

echo "[automation-smoke] PASS: migrations, RLS, S2S auth, target discovery, context scope, idempotency, payload guard and notification feed"
