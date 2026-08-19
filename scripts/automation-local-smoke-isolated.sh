#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMP_ROOT="$(mktemp -d)"

cleanup() {
  rm -rf "$TEMP_ROOT"
}
trap cleanup EXIT

mkdir -p \
  "$TEMP_ROOT/scripts" \
  "$TEMP_ROOT/supabase/functions/_shared" \
  "$TEMP_ROOT/supabase/functions/mf-automation-gateway" \
  "$TEMP_ROOT/supabase/migrations"

cp "$ROOT_DIR/supabase/config.toml" "$TEMP_ROOT/supabase/config.toml"
cp "$ROOT_DIR/scripts/automation-local-smoke.sh" "$TEMP_ROOT/scripts/automation-local-smoke.sh"
cp "$ROOT_DIR/package.json" "$TEMP_ROOT/package.json"
if [[ -f "$ROOT_DIR/package-lock.json" ]]; then
  cp "$ROOT_DIR/package-lock.json" "$TEMP_ROOT/package-lock.json"
fi

cp "$ROOT_DIR/supabase/functions/_shared/mf-automation-auth.ts" "$TEMP_ROOT/supabase/functions/_shared/"
cp "$ROOT_DIR/supabase/functions/_shared/mf-automation-contract.ts" "$TEMP_ROOT/supabase/functions/_shared/"
cp "$ROOT_DIR/supabase/functions/_shared/mf-automation-actions.ts" "$TEMP_ROOT/supabase/functions/_shared/"
cp "$ROOT_DIR/supabase/functions/mf-automation-gateway/index.ts" "$TEMP_ROOT/supabase/functions/mf-automation-gateway/index.ts"
cp "$ROOT_DIR/supabase/functions/mf-automation-gateway/deno.json" "$TEMP_ROOT/supabase/functions/mf-automation-gateway/deno.json"

# Local Edge Runtime resolves shared modules from supabase/functions. Keep this
# import map inside the temporary smoke project only; production deployment keeps
# the function-scoped deno.json as the source of truth.
cat > "$TEMP_ROOT/supabase/functions/deno.json" <<'EOF'
{
  "imports": {
    "@supabase/supabase-js": "npm:@supabase/supabase-js@2.112.2"
  }
}
EOF

# Do not replay the repository's historical migration chain here. The project has
# legacy migration-order drift that predates this gateway. This smoke isolates the
# new automation migrations so a historical baseline problem cannot hide a gateway bug.
cp "$ROOT_DIR/supabase/migrations/20260819004000_mf_automation_gateway_foundation.sql" "$TEMP_ROOT/supabase/migrations/"
cp "$ROOT_DIR/supabase/migrations/20260819004500_mf_automation_gateway_hardening.sql" "$TEMP_ROOT/supabase/migrations/"
cp "$ROOT_DIR/supabase/migrations/20260819005000_mf_automation_idempotency_hardening.sql" "$TEMP_ROOT/supabase/migrations/"
cp "$ROOT_DIR/supabase/tests/automation_smoke_fixture.sql" "$TEMP_ROOT/supabase/migrations/20260819006000_automation_smoke_fixture.sql"

echo "[automation-smoke] isolated workdir: gateway migrations only; production history untouched"
cd "$TEMP_ROOT"
bash scripts/automation-local-smoke.sh
