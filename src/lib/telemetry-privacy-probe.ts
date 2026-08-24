import { supabase } from './supabase';
import {
  TRUSTED_MF_ADMIN_INGEST_URL,
  trustedMfAdminIngestUrl,
} from './telemetry-endpoint';

const PREVIEW_PROBE_HOST =
  'm-financeiro-2-git-hardening-7386ad-lucasmanga95-4135s-projects.vercel.app';
const PREVIEW_PROBE_PARAM = '__mf_privacy_probe';
const PREVIEW_PROBE_VALUE = 'server-v1';
const SESSION_RETRIES = 12;
const SESSION_RETRY_MS = 300;

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
}

function buildId() {
  return typeof __MF_BUILD_ID__ !== 'undefined'
    ? String(__MF_BUILD_ID__)
    : 'unknown';
}

function correlationId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : '33333333-3333-4333-8333-333333333333';
}

function probeRequested() {
  if (typeof window === 'undefined') return false;
  if (String(import.meta.env.VITE_MF_DIAG_ENVIRONMENT) !== 'preview') return false;
  if (window.location.hostname !== PREVIEW_PROBE_HOST) return false;
  return (
    new URLSearchParams(window.location.search).get(PREVIEW_PROBE_PARAM) ===
    PREVIEW_PROBE_VALUE
  );
}

async function readAccessToken() {
  for (let attempt = 0; attempt < SESSION_RETRIES; attempt += 1) {
    const { data } = await supabase.auth.getSession();
    if (data.session?.access_token) return data.session.access_token;
    await wait(SESSION_RETRY_MS);
  }
  return null;
}

export async function runTelemetryPrivacyProbe() {
  if (!probeRequested()) return false;

  const ingestUrl = trustedMfAdminIngestUrl(
    import.meta.env.VITE_MF_ADMIN_INGEST_URL,
  );
  if (ingestUrl !== TRUSTED_MF_ADMIN_INGEST_URL) return false;

  const accessToken = await readAccessToken();
  if (!accessToken) return false;

  const currentBuildId = buildId();
  const response = await fetch(ingestUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      category: 'security',
      module: 'observability.privacy_probe',
      operation: 'server_sanitization',
      severity: 'low',
      error_code: 'PRIVACY_PROBE_SYNTHETIC',
      app_version: currentBuildId,
      deploy_id: currentBuildId,
      surface: 'web',
      environment: 'preview',
      impact: 'none',
      correlation_id: correlationId(),
      technical_context: {
        route: '/app?account=synthetic',
        parser: 'synthetic',
        accepted_count: 3,
        retryable: false,
        amount: 999,
        balance: 5000,
        email: 'privacy-probe@example.invalid',
        token: 'synthetic-token-never-valid',
        description: 'synthetic-sensitive-description',
        raw_payload: 'synthetic-raw-payload',
        card_number: '4111111111111111',
        cpf: '00000000000',
      },
    }),
    keepalive: true,
  });

  if (response.status !== 202) return false;

  const url = new URL(window.location.href);
  url.searchParams.delete(PREVIEW_PROBE_PARAM);
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  return true;
}
