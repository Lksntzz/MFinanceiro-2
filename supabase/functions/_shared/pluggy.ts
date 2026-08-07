const PLUGGY_API = 'https://api.pluggy.ai';

export type PluggyAccount = {
  id: string;
  type: 'BANK' | 'CREDIT' | string;
  subtype?: string | null;
  name?: string | null;
  marketingName?: string | null;
  balance?: number | null;
  currencyCode?: string | null;
  itemId: string;
};

export type PluggyTransaction = {
  id: string;
  description?: string | null;
  descriptionRaw?: string | null;
  amount: number;
  date: string;
  category?: string | null;
  categoryId?: string | null;
  accountId: string;
  providerCode?: string | null;
  providerId?: string | null;
  type?: 'CREDIT' | 'DEBIT' | string | null;
  status?: string | null;
  paymentData?: unknown;
  creditCardMetadata?: { installmentNumber?: number | null; totalInstallments?: number | null; totalAmount?: number | null } | null;
};

function required(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} não configurado.`);
  return value;
}

export function pluggyConfigured() {
  return Boolean(Deno.env.get('PLUGGY_CLIENT_ID')?.trim() && Deno.env.get('PLUGGY_CLIENT_SECRET')?.trim());
}

export async function createApiKey() {
  const response = await fetch(`${PLUGGY_API}/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId: required('PLUGGY_CLIENT_ID'), clientSecret: required('PLUGGY_CLIENT_SECRET') }),
  });
  if (!response.ok) throw new Error(`Falha ao autenticar no Pluggy (${response.status}).`);
  const payload = await response.json() as Record<string, unknown>;
  const apiKey = String(payload.apiKey || payload.api_key || payload.accessToken || '');
  if (!apiKey) throw new Error('Pluggy não retornou API Key.');
  return apiKey;
}

async function pluggyFetch(path: string, apiKey: string, init?: RequestInit) {
  const response = await fetch(path.startsWith('http') ? path : `${PLUGGY_API}${path}`, {
    ...init,
    headers: {
      'X-API-KEY': apiKey,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Pluggy recusou a operação (${response.status})${text ? `: ${text.slice(0, 300)}` : ''}`);
  }
  if (response.status === 204) return null;
  return await response.json();
}

export async function createConnectToken(apiKey: string, userId: string, webhookUrl: string, itemId?: string | null) {
  const body: Record<string, unknown> = {
    options: {
      clientUserId: userId,
      webhookUrl,
      avoidDuplicates: true,
    },
  };
  if (itemId) body.itemId = itemId;
  const payload = await pluggyFetch('/connect_token', apiKey, { method: 'POST', body: JSON.stringify(body) }) as Record<string, unknown>;
  const accessToken = String(payload.accessToken || payload.connectToken || payload.token || '');
  if (!accessToken) throw new Error('Pluggy não retornou Connect Token.');
  return accessToken;
}

export async function deleteItem(apiKey: string, itemId: string) {
  await pluggyFetch(`/items/${encodeURIComponent(itemId)}`, apiKey, { method: 'DELETE' });
}

export async function fetchAccounts(apiKey: string, itemId: string): Promise<PluggyAccount[]> {
  const payload = await pluggyFetch(`/accounts?itemId=${encodeURIComponent(itemId)}`, apiKey) as { results?: PluggyAccount[] };
  return Array.isArray(payload?.results) ? payload.results : [];
}

export async function fetchTransactions(apiKey: string, accountId: string, dateFrom?: string | null, dateTo?: string | null) {
  const transactions: PluggyTransaction[] = [];
  let after: string | null = null;
  let safety = 0;
  do {
    const params = new URLSearchParams({ accountId });
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    if (after) params.set('after', after);
    const payload = await pluggyFetch(`/v2/transactions?${params.toString()}`, apiKey) as { results?: PluggyTransaction[]; next?: string | null };
    if (Array.isArray(payload?.results)) transactions.push(...payload.results);
    const next = String(payload?.next || '');
    if (!next) break;
    try {
      const nextUrl = new URL(next, PLUGGY_API);
      after = nextUrl.searchParams.get('after');
    } catch {
      after = null;
    }
    safety += 1;
  } while (after && safety < 50);
  return transactions;
}
