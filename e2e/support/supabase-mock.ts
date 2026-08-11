import type { Page, Request, Route } from '@playwright/test';

export const E2E_SUPABASE_URL = 'https://e2e-mfinanceiro.supabase.co';
export const E2E_SUPABASE_ANON_KEY = 'e2e-anon-key';

export const E2E_USERS = {
  alice: { email: 'alice.e2e@example.com', password: 'Segura123!' },
  bruno: { email: 'bruno.e2e@example.com', password: 'Segura123!' },
} as const;

type JsonRecord = Record<string, any>;

type MockUserState = {
  password: string;
  user: JsonRecord;
  settings: JsonRecord;
  accounts: JsonRecord[];
  categories: JsonRecord[];
  cards: JsonRecord[];
  installments: JsonRecord[];
  fixedBills: JsonRecord[];
  ledger: JsonRecord[];
  batches: JsonRecord[];
  batchRows: JsonRecord[];
  accessToken: string;
  refreshToken: string;
};

export type SupabaseMockState = {
  users: Record<string, MockUserState>;
  currentEmail: string | null;
  sequence: number;
  rpcCalls: Array<{ name: string; email: string | null; body: JsonRecord }>;
};

const NOW = '2026-08-11T03:00:00.000Z';

function userSeed(
  id: string,
  email: string,
  name: string,
  workspace: string,
  accountId: string,
  accountName: string,
  openingBalance: number,
  baselineDescription: string,
): MockUserState {
  return {
    password: E2E_USERS.alice.password,
    user: {
      id,
      aud: 'authenticated',
      role: 'authenticated',
      email,
      email_confirmed_at: NOW,
      phone: '',
      confirmed_at: NOW,
      last_sign_in_at: NOW,
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: { name },
      identities: [],
      created_at: '2026-01-01T12:00:00.000Z',
      updated_at: NOW,
      is_anonymous: false,
    },
    settings: {
      id: `settings-${id}`,
      user_id: id,
      display_name: name,
      workspace_name: workspace,
      current_balance: openingBalance,
      balance_confirmed: true,
      monthly_income: 5000,
      currency: 'BRL',
    },
    accounts: [{
      id: accountId,
      user_id: id,
      name: accountName,
      currency: 'BRL',
      opening_balance: openingBalance,
      current_balance: openingBalance,
      transaction_count: 1,
      is_default: true,
      is_active: true,
      created_at: '2026-01-01T12:00:00.000Z',
    }],
    categories: [
      { id: `cat-food-${id}`, user_id: id, name: 'Alimentação', category_type: 'expense', is_active: true, sort_order: 10 },
      { id: `cat-income-${id}`, user_id: id, name: 'Salário', category_type: 'income', is_active: true, sort_order: 20 },
      { id: `cat-general-${id}`, user_id: id, name: 'Geral', category_type: 'both', is_active: true, sort_order: 99 },
    ],
    cards: [],
    installments: [],
    fixedBills: [],
    ledger: [{
      id: `baseline-${id}`,
      user_id: id,
      account_id: accountId,
      category_id: `cat-food-${id}`,
      date: '2026-08-10T12:00:00.000Z',
      created_at: '2026-08-10T12:30:00.000Z',
      description: baselineDescription,
      category: 'Alimentação',
      amount: 15,
      type: 'expense',
      status: 'paid',
      source: 'Manual',
      payment_method: 'pix',
      affects_balance: true,
    }],
    batches: [],
    batchRows: [],
    accessToken: `access-${id}`,
    refreshToken: `refresh-${id}`,
  };
}

export function createSupabaseMockState(): SupabaseMockState {
  const alice = userSeed(
    '00000000-0000-4000-8000-0000000000a1',
    E2E_USERS.alice.email,
    'Alice E2E',
    'Workspace Alice',
    'acc-alice',
    'Conta Alice',
    1000,
    'Exclusivo Alice',
  );
  const bruno = userSeed(
    '00000000-0000-4000-8000-0000000000b2',
    E2E_USERS.bruno.email,
    'Bruno E2E',
    'Workspace Bruno',
    'acc-bruno',
    'Conta Bruno',
    2400,
    'Exclusivo Bruno',
  );

  return {
    users: {
      [E2E_USERS.alice.email]: alice,
      [E2E_USERS.bruno.email]: bruno,
    },
    currentEmail: null,
    sequence: 1,
    rpcCalls: [],
  };
}

function sessionFor(user: MockUserState) {
  return {
    access_token: user.accessToken,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: user.refreshToken,
    user: user.user,
  };
}

function userForRequest(request: Request, state: SupabaseMockState): MockUserState | null {
  const authorization = String(request.headers()['authorization'] || '');
  const token = authorization.replace(/^Bearer\s+/i, '');
  const byToken = Object.values(state.users).find((entry) => entry.accessToken === token);
  if (byToken) return byToken;
  return state.currentEmail ? state.users[state.currentEmail] || null : null;
}

function emailForUser(user: MockUserState | null) {
  return user?.user?.email ? String(user.user.email) : null;
}

function corsHeaders(contentType = 'application/json') {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info, prefer, accept-profile, content-profile, x-supabase-api-version',
    'access-control-allow-methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
    'access-control-expose-headers': 'content-range, x-supabase-api-version',
    'cache-control': 'no-store',
    'content-type': contentType,
    'x-supabase-api-version': '2024-01-01',
  };
}

async function fulfillJson(route: Route, body: unknown, status = 200, headers: Record<string, string> = {}) {
  await route.fulfill({
    status,
    headers: { ...corsHeaders(), ...headers },
    body: JSON.stringify(body),
  });
}

async function requestJson(request: Request): Promise<JsonRecord> {
  try {
    return request.postDataJSON() as JsonRecord;
  } catch {
    return {};
  }
}

function ledgerPage(user: MockUserState) {
  const items = [...user.ledger].sort((left, right) => {
    const date = String(right.date || '').localeCompare(String(left.date || ''));
    if (date !== 0) return date;
    return String(right.created_at || '').localeCompare(String(left.created_at || ''));
  });
  return { items, has_more: false, total_count: items.length, next_cursor: null };
}

function updateAccountBalance(user: MockUserState, accountId: string | null | undefined, delta: number) {
  const account = user.accounts.find((entry) => entry.id === accountId) || user.accounts[0];
  if (!account) return;
  account.current_balance = Number(account.current_balance || 0) + delta;
  account.transaction_count = Number(account.transaction_count || 0) + 1;
}

async function handleAuth(route: Route, request: Request, state: SupabaseMockState, url: URL) {
  if (request.method() === 'OPTIONS') {
    await route.fulfill({ status: 204, headers: corsHeaders('text/plain'), body: '' });
    return;
  }

  if (url.pathname === '/auth/v1/token') {
    const body = await requestJson(request);
    const grantType = url.searchParams.get('grant_type');
    if (grantType === 'password') {
      const email = String(body.email || '').trim().toLowerCase();
      const user = state.users[email];
      if (!user || body.password !== user.password) {
        await fulfillJson(route, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' }, 400);
        return;
      }
      state.currentEmail = email;
      await fulfillJson(route, sessionFor(user));
      return;
    }
    if (grantType === 'refresh_token') {
      const user = Object.values(state.users).find((entry) => entry.refreshToken === body.refresh_token);
      if (!user) {
        await fulfillJson(route, { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' }, 400);
        return;
      }
      state.currentEmail = String(user.user.email);
      await fulfillJson(route, sessionFor(user));
      return;
    }
  }

  if (url.pathname === '/auth/v1/user' && request.method() === 'GET') {
    const user = userForRequest(request, state);
    if (!user) {
      await fulfillJson(route, { code: 401, msg: 'User not found' }, 401);
      return;
    }
    await fulfillJson(route, user.user);
    return;
  }

  if (url.pathname === '/auth/v1/logout' && request.method() === 'POST') {
    state.currentEmail = null;
    await route.fulfill({ status: 204, headers: corsHeaders('text/plain'), body: '' });
    return;
  }

  await fulfillJson(route, {});
}

async function handleRpc(route: Route, request: Request, state: SupabaseMockState, name: string) {
  const user = userForRequest(request, state);
  const body = await requestJson(request);
  const email = emailForUser(user);
  state.rpcCalls.push({ name, email, body });

  if (name === 'mf_ensure_financial_structure') {
    await fulfillJson(route, true);
    return;
  }

  if (!user) {
    await fulfillJson(route, { message: 'JWT required' }, 401);
    return;
  }

  if (name === 'mf_get_ledger_page') {
    await fulfillJson(route, ledgerPage(user));
    return;
  }

  if (name === 'mf_create_finance_entry_v3') {
    const amount = Math.abs(Number(body.p_amount || 0));
    const type = body.p_type === 'income' ? 'income' : 'expense';
    const transaction = {
      id: `manual-${state.sequence++}`,
      user_id: user.user.id,
      account_id: body.p_account_id || user.accounts[0]?.id || null,
      category_id: body.p_category_id || null,
      date: `${String(body.p_date || '2026-08-11').slice(0, 10)}T12:00:00.000Z`,
      created_at: new Date(Date.now() + state.sequence * 1000).toISOString(),
      description: String(body.p_description || 'Lançamento E2E'),
      category: String(body.p_category || 'Geral'),
      amount,
      type,
      status: body.p_status || 'paid',
      source: body.p_source || 'Manual',
      payment_method: body.p_payment_method || 'pix',
      affects_balance: body.p_status !== 'pending',
    };
    user.ledger.unshift(transaction);
    if (transaction.affects_balance) updateAccountBalance(user, transaction.account_id, type === 'income' ? amount : -amount);
    await fulfillJson(route, transaction.id);
    return;
  }

  if (name === 'mf_commit_statement_import_v2') {
    const entries = Array.isArray(body.p_entries) ? body.p_entries : [];
    const selected = entries.filter((entry: JsonRecord) => entry.selected === true && Number(entry.amount || 0) > 0);
    const batchId = `batch-${state.sequence++}`;
    const balanceBefore = Number(user.accounts[0]?.current_balance || 0);
    let netNew = 0;
    const batchRows: JsonRecord[] = [];

    selected.forEach((entry: JsonRecord, index: number) => {
      const amount = Math.abs(Number(entry.amount || 0));
      const type = entry.type === 'income' ? 'income' : 'expense';
      const signed = type === 'income' ? amount : -amount;
      netNew += signed;
      const ledgerId = `import-${state.sequence++}`;
      user.ledger.unshift({
        id: ledgerId,
        user_id: user.user.id,
        account_id: body.p_account_id || user.accounts[0]?.id || null,
        date: String(entry.date || '2026-08-10'),
        created_at: new Date(Date.now() + state.sequence * 1000).toISOString(),
        description: entry.description,
        category: entry.category || 'Geral',
        amount,
        type,
        status: 'paid',
        source: entry.source || 'Importado',
        affects_balance: body.p_balance_mode === 'apply_new',
        import_batch_id: batchId,
      });
      batchRows.push({
        id: `row-${state.sequence++}`,
        batch_id: batchId,
        line_number: index + 1,
        transaction_date: String(entry.date || '').slice(0, 10),
        description: entry.description,
        category_name: entry.category || 'Geral',
        signed_amount: signed,
        status: 'inserted',
        error_message: null,
        ledger_entry_id: ledgerId,
      });
    });

    if (body.p_balance_mode === 'apply_new') {
      updateAccountBalance(user, body.p_account_id, netNew);
    }

    const balanceAfter = Number(user.accounts[0]?.current_balance || balanceBefore);
    user.batches.unshift({
      id: batchId,
      user_id: user.user.id,
      account_id: body.p_account_id || user.accounts[0]?.id || null,
      status: 'completed',
      source_format: String(body.p_file_type || 'csv').includes('csv') ? 'csv' : String(body.p_file_type || 'csv'),
      file_name: body.p_file_name || 'statement.csv',
      parser_name: body.p_parser_name || 'Parser CSV',
      period_start: '2026-08-10',
      period_end: '2026-08-10',
      balance_mode: body.p_balance_mode || 'keep',
      balance_before: balanceBefore,
      balance_after: balanceAfter,
      net_amount: netNew,
      requested_count: entries.length,
      inserted_count: selected.length,
      duplicate_count: 0,
      rejected_count: Math.max(0, entries.length - selected.length),
      ignored_count: 0,
      error_message: null,
      created_at: NOW,
      completed_at: NOW,
      reverted_at: null,
      revert_reason: null,
    });
    user.batchRows.push(...batchRows);

    await fulfillJson(route, {
      batch_id: batchId,
      inserted_count: selected.length,
      duplicate_count: 0,
      rejected_count: Math.max(0, entries.length - selected.length),
      ignored_count: 0,
      net_new: netNew,
      balance_before: balanceBefore,
      balance_after: balanceAfter,
      balance_mode: body.p_balance_mode || 'keep',
    });
    return;
  }

  if (name === 'mf_revert_statement_import') {
    const batch = user.batches.find((entry) => entry.id === body.p_batch_id);
    if (!batch) {
      await fulfillJson(route, { message: 'Batch not found' }, 404);
      return;
    }
    const ledgerIds = new Set(user.batchRows.filter((entry) => entry.batch_id === batch.id).map((entry) => entry.ledger_entry_id));
    user.ledger = user.ledger.filter((entry) => !ledgerIds.has(entry.id));
    batch.status = 'reverted';
    batch.reverted_at = NOW;
    batch.revert_reason = body.p_reason || 'Desfeito pelo usuário';
    await fulfillJson(route, true);
    return;
  }

  if (name === 'mf_delete_finance_entry') {
    user.ledger = user.ledger.filter((entry) => entry.id !== body.p_entry_id);
    await fulfillJson(route, true);
    return;
  }

  await fulfillJson(route, null);
}

function tableRows(user: MockUserState | null, table: string, url: URL): JsonRecord[] {
  if (table === 'mf_global_settings') {
    return [
      { key: 'desktop', maintenance_mode: false, maintenance_message: 'E2E', updated_at: NOW },
      { key: 'mobile', maintenance_mode: false, maintenance_message: 'E2E', updated_at: NOW },
    ];
  }
  if (table === 'mf_app_config') return [];
  if (!user) return [];
  if (table === 'mf_user_settings') return [user.settings];
  if (table === 'mf_account_balances') return user.accounts;
  if (table === 'mf_financial_accounts') return user.accounts;
  if (table === 'mf_transaction_categories') return user.categories;
  if (table === 'mf_credit_cards') return user.cards;
  if (table === 'mf_card_installments') return user.installments;
  if (table === 'mf_fixed_bills') return user.fixedBills;
  if (table === 'mf_statement_import_batches') return user.batches;
  if (table === 'mf_statement_import_rows') {
    const batchFilter = url.searchParams.get('batch_id') || '';
    const batchId = batchFilter.replace(/^eq\./, '');
    return batchId ? user.batchRows.filter((entry) => entry.batch_id === batchId) : user.batchRows;
  }
  return [];
}

async function handleRest(route: Route, request: Request, state: SupabaseMockState, url: URL) {
  if (request.method() === 'OPTIONS') {
    await route.fulfill({ status: 204, headers: corsHeaders('text/plain'), body: '' });
    return;
  }

  const relative = url.pathname.replace('/rest/v1/', '');
  if (relative.startsWith('rpc/')) {
    await handleRpc(route, request, state, relative.slice(4));
    return;
  }

  const table = relative.split('/')[0];
  const user = userForRequest(request, state);
  if (request.method() === 'GET') {
    const rows = tableRows(user, table, url);
    await fulfillJson(route, rows, 200, { 'content-range': `0-${Math.max(0, rows.length - 1)}/${rows.length}` });
    return;
  }

  if (request.method() === 'POST' || request.method() === 'PATCH' || request.method() === 'PUT' || request.method() === 'DELETE') {
    await fulfillJson(route, []);
    return;
  }

  await fulfillJson(route, []);
}

async function handleFunctions(route: Route, request: Request, state: SupabaseMockState, url: URL) {
  if (request.method() === 'OPTIONS') {
    await route.fulfill({ status: 204, headers: corsHeaders('text/plain'), body: '' });
    return;
  }
  const functionName = url.pathname.replace('/functions/v1/', '').split('/')[0];
  if (functionName === 'access-request') {
    await fulfillJson(route, {
      accepted: true,
      message: 'Se o endereço estiver apto, o MF enviará as próximas instruções por e-mail.',
    });
    return;
  }
  if (functionName === 'operational-event') {
    await fulfillJson(route, { accepted: true });
    return;
  }
  await fulfillJson(route, {});
}

export async function installSupabaseMock(page: Page, state: SupabaseMockState = createSupabaseMockState()) {
  await page.route(`${E2E_SUPABASE_URL}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (url.pathname.startsWith('/auth/v1/')) {
      await handleAuth(route, request, state, url);
      return;
    }
    if (url.pathname.startsWith('/rest/v1/')) {
      await handleRest(route, request, state, url);
      return;
    }
    if (url.pathname.startsWith('/functions/v1/')) {
      await handleFunctions(route, request, state, url);
      return;
    }
    if (url.pathname.startsWith('/storage/v1/')) {
      if (request.method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers: corsHeaders('text/plain'), body: '' });
      } else {
        await fulfillJson(route, { Key: 'e2e/mock' });
      }
      return;
    }

    await fulfillJson(route, {});
  });

  return state;
}
