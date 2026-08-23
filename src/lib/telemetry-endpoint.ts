export const TRUSTED_MF_ADMIN_INGEST_URL =
  'https://lyhsttditfrxmfnnligk.supabase.co/functions/v1/ingest-event';

export function trustedMfAdminIngestUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  try {
    const candidate = new URL(value.trim());
    const trusted = new URL(TRUSTED_MF_ADMIN_INGEST_URL);

    if (
      candidate.protocol !== 'https:' ||
      candidate.origin !== trusted.origin ||
      candidate.pathname !== trusted.pathname ||
      candidate.search !== '' ||
      candidate.hash !== '' ||
      candidate.username !== '' ||
      candidate.password !== ''
    ) {
      return null;
    }

    return TRUSTED_MF_ADMIN_INGEST_URL;
  } catch {
    return null;
  }
}
