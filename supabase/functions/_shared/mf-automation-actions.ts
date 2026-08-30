import type { SupabaseClient } from '@supabase/supabase-js';
import {
  ACTION_SCOPE,
  isSafeActionPath,
  sanitizeNotificationText,
  type AutomationAction,
  type TargetModule,
} from './mf-automation-contract.ts';

type AutomationContext = {
  user_id: string;
  scopes: string[];
  expires_at: string;
  use_count: number;
  max_uses: number;
};

const DAY_MS = 86_400_000;

function todayUtc() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function monthBounds() {
  const now = todayUtc();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  return { start: isoDate(start), end: isoDate(end) };
}

function daysUntilDate(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return Math.round((parsed.getTime() - todayUtc().getTime()) / DAY_MS);
}

function daysUntilMonthlyDay(rawDay: unknown) {
  const day = Math.min(31, Math.max(1, Math.trunc(Number(rawDay) || 1)));
  const now = todayUtc();
  const lastDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const due = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), Math.min(day, lastDay)));
  return Math.round((due.getTime() - now.getTime()) / DAY_MS);
}

function classifyPercentage(value: number) {
  if (value >= 100) return 'CRITICAL';
  if (value >= 90) return 'WARNING';
  if (value >= 75) return 'ATTENTION';
  return 'NORMAL';
}

function normalizeLedgerStatus(value: unknown) {
  return String(value || '').toLowerCase();
}

function countsAsExpense(row: Record<string, unknown>) {
  const status = normalizeLedgerStatus(row.status);
  if (['pending', 'duplicate', 'error', 'voided', 'reversed'].includes(status)) return false;
  return String(row.type || '').toLowerCase() === 'expense';
}

async function hashReference(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

async function userHash(userId: string) {
  const secret = (Deno.env.get('MF_AUTOMATION_HASH_SECRET') || '').trim();
  if (!secret) throw new Error('AUTOMATION_HASH_SECRET_NOT_CONFIGURED');
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(userId));
  return Array.from(new Uint8Array(signature)).map((byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

function unwrapRpcRow(data: unknown): Record<string, unknown> | null {
  if (Array.isArray(data)) return (data[0] as Record<string, unknown> | undefined) || null;
  if (data && typeof data === 'object') return data as Record<string, unknown>;
  return null;
}

export async function resolveAutomationContext(
  admin: SupabaseClient,
  contextRef: string,
  requiredScope: string,
): Promise<AutomationContext> {
  const { data, error } = await admin.rpc('mf_resolve_automation_context', {
    p_context_ref: contextRef,
    p_required_scope: requiredScope,
  });
  if (error) throw new Error('AUTOMATION_CONTEXT_INVALID');
  const row = unwrapRpcRow(data);
  if (!row?.user_id) throw new Error('AUTOMATION_CONTEXT_INVALID');
  return {
    user_id: String(row.user_id),
    scopes: Array.isArray(row.scopes) ? row.scopes.map(String) : [],
    expires_at: String(row.expires_at || ''),
    use_count: Number(row.use_count || 0),
    max_uses: Number(row.max_uses || 0),
  };
}

async function budgetContext(admin: SupabaseClient, userId: string) {
  const { start, end } = monthBounds();
  const [budgetResult, ledgerResult] = await Promise.all([
    admin.from('mf_budgets').select('id,category,limit_amount').eq('user_id', userId).limit(250),
    admin
      .from('mf_finance_ledger_entries')
      .select('category,amount,type,status,date')
      .eq('user_id', userId)
      .gte('date', start)
      .lte('date', end)
      .limit(5000),
  ]);
  if (budgetResult.error || ledgerResult.error) throw new Error('AUTOMATION_BUDGET_CONTEXT_FAILED');

  const spent = new Map<string, number>();
  for (const row of (ledgerResult.data || []) as Record<string, unknown>[]) {
    if (!countsAsExpense(row)) continue;
    const category = String(row.category || 'Geral');
    spent.set(category, (spent.get(category) || 0) + Math.abs(Number(row.amount || 0)));
  }

  const items = await Promise.all(((budgetResult.data || []) as Record<string, unknown>[]).map(async (row) => {
    const category = String(row.category || 'Geral');
    const limit = Math.abs(Number(row.limit_amount || 0));
    const used = spent.get(category) || 0;
    const percentage = limit > 0 ? Math.min(999, Math.round((used / limit) * 1000) / 10) : 0;
    return {
      reference: await hashReference(`${userId}:budget:${String(row.id || category)}`),
      percentage,
      classification: classifyPercentage(percentage),
    };
  }));

  return {
    period: start.slice(0, 7),
    count: items.length,
    attention_count: items.filter((item) => item.classification !== 'NORMAL').length,
    items,
  };
}

async function cardContext(admin: SupabaseClient, userId: string) {
  const { data, error } = await admin
    .from('mf_credit_cards')
    .select('id,limit,used,closing_day,due_day')
    .eq('user_id', userId)
    .limit(100);
  if (error) throw new Error('AUTOMATION_CARD_CONTEXT_FAILED');

  return {
    count: data?.length || 0,
    items: ((data || []) as Record<string, unknown>[]).map((row) => {
      const limit = Math.abs(Number(row.limit || 0));
      const used = Math.abs(Number(row.used || 0));
      const percentage = limit > 0 ? Math.min(999, Math.round((used / limit) * 1000) / 10) : 0;
      return {
        reference: String(row.id),
        utilization_percentage: percentage,
        classification: classifyPercentage(percentage),
        days_to_close: daysUntilMonthlyDay(row.closing_day),
        days_to_due: daysUntilMonthlyDay(row.due_day),
      };
    }),
  };
}

async function goalContext(admin: SupabaseClient, userId: string) {
  const { data, error } = await admin
    .from('mf_financial_goals')
    .select('id,target_amount,current_amount,deadline,status')
    .eq('user_id', userId)
    .limit(250);
  if (error) throw new Error('AUTOMATION_GOAL_CONTEXT_FAILED');

  return {
    count: data?.length || 0,
    items: ((data || []) as Record<string, unknown>[]).map((row) => {
      const target = Math.abs(Number(row.target_amount || 0));
      const current = Math.max(0, Number(row.current_amount || 0));
      const percentage = target > 0 ? Math.min(100, Math.round((current / target) * 1000) / 10) : 0;
      const days = daysUntilDate(typeof row.deadline === 'string' ? row.deadline : null);
      const complete = String(row.status || '').toLowerCase() === 'completed' || percentage >= 100;
      return {
        reference: String(row.id),
        progress_percentage: percentage,
        days_to_deadline: days,
        status: complete ? 'COMPLETED' : days != null && days < 0 ? 'OVERDUE' : 'ACTIVE',
      };
    }),
  };
}

async function agendaContext(admin: SupabaseClient, userId: string) {
  const [fixedResult, subscriptionResult, cardResult, installmentResult] = await Promise.all([
    admin.from('mf_fixed_bills').select('id,due_day,status').eq('user_id', userId).limit(500),
    admin.from('mf_subscriptions').select('id,due_day,status,billing_cycle').eq('user_id', userId).limit(500),
    admin.from('mf_credit_cards').select('id,due_day,closing_day').eq('user_id', userId).limit(100),
    admin.from('mf_card_installments').select('id,due_day,current_installment,total_installments').eq('user_id', userId).limit(500),
  ]);
  if (fixedResult.error || subscriptionResult.error || cardResult.error || installmentResult.error) {
    throw new Error('AUTOMATION_AGENDA_CONTEXT_FAILED');
  }

  const items: Array<Record<string, unknown>> = [];
  for (const row of (fixedResult.data || []) as Record<string, unknown>[]) {
    if (String(row.status || '').toLowerCase() === 'paid') continue;
    items.push({ type: 'fixed_bill', reference: String(row.id), days_until_due: daysUntilMonthlyDay(row.due_day) });
  }
  for (const row of (subscriptionResult.data || []) as Record<string, unknown>[]) {
    if (['cancelled', 'canceled', 'inactive'].includes(String(row.status || '').toLowerCase())) continue;
    items.push({ type: 'subscription', reference: String(row.id), days_until_due: daysUntilMonthlyDay(row.due_day) });
  }
  for (const row of (cardResult.data || []) as Record<string, unknown>[]) {
    items.push({ type: 'card_due', reference: String(row.id), days_until_due: daysUntilMonthlyDay(row.due_day) });
    items.push({ type: 'card_close', reference: String(row.id), days_until_due: daysUntilMonthlyDay(row.closing_day) });
  }
  for (const row of (installmentResult.data || []) as Record<string, unknown>[]) {
    if (Number(row.current_installment || 1) > Number(row.total_installments || 1)) continue;
    items.push({ type: 'installment', reference: String(row.id), days_until_due: daysUntilMonthlyDay(row.due_day) });
  }

  const relevant = items
    .filter((item) => Number(item.days_until_due) >= -7 && Number(item.days_until_due) <= 31)
    .sort((left, right) => Number(left.days_until_due) - Number(right.days_until_due))
    .slice(0, 100);

  return {
    count: relevant.length,
    overdue_count: relevant.filter((item) => Number(item.days_until_due) < 0).length,
    next_7_days_count: relevant.filter((item) => Number(item.days_until_due) >= 0 && Number(item.days_until_due) <= 7).length,
    items: relevant,
  };
}

function recurrenceKey(description: string) {
  return description
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\d+/g, '#')
    .replace(/[^a-z# ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

async function recurrenceCandidates(admin: SupabaseClient, userId: string) {
  const end = todayUtc();
  const start = new Date(end.getTime() - 190 * DAY_MS);
  const { data, error } = await admin
    .from('mf_finance_ledger_entries')
    .select('description,date,type,status')
    .eq('user_id', userId)
    .gte('date', isoDate(start))
    .lte('date', isoDate(end))
    .limit(3000);
  if (error) throw new Error('AUTOMATION_RECURRENCE_CONTEXT_FAILED');

  const groups = new Map<string, { type: string; dates: number[] }>();
  for (const row of (data || []) as Record<string, unknown>[]) {
    const status = normalizeLedgerStatus(row.status);
    if (['pending', 'duplicate', 'error', 'voided', 'reversed'].includes(status)) continue;
    const key = recurrenceKey(String(row.description || ''));
    if (key.length < 3) continue;
    const date = new Date(`${String(row.date).slice(0, 10)}T00:00:00.000Z`).getTime();
    if (!Number.isFinite(date)) continue;
    const group = groups.get(key) || { type: String(row.type || 'expense'), dates: [] };
    group.dates.push(date);
    groups.set(key, group);
  }

  const candidates: Array<Record<string, unknown>> = [];
  for (const [key, group] of groups.entries()) {
    if (group.dates.length < 3) continue;
    const dates = [...group.dates].sort((a, b) => a - b);
    const intervals = dates.slice(1).map((value, index) => Math.round((value - dates[index]) / DAY_MS));
    const average = intervals.reduce((sum, value) => sum + value, 0) / intervals.length;
    const deviation = intervals.reduce((sum, value) => sum + Math.abs(value - average), 0) / intervals.length;
    if (average < 20 || average > 45 || deviation > 8) continue;
    const confidence = Math.max(0.5, Math.min(0.98, 1 - deviation / 30));
    candidates.push({
      reference: await hashReference(`${userId}:recurrence:${key}`),
      frequency: 'monthly',
      interval_days: Math.round(average),
      occurrences: dates.length,
      confidence: Math.round(confidence * 100) / 100,
      transaction_type: group.type === 'income' ? 'income' : 'expense',
    });
  }

  return { count: Math.min(candidates.length, 50), items: candidates.slice(0, 50) };
}

async function dataQualityContext(admin: SupabaseClient, userId: string) {
  const [reviewing, failedOcr, failedImports, openFinanceErrors] = await Promise.all([
    admin.from('mf_document_extractions').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('status', 'reviewing'),
    admin.from('mf_document_extractions').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('status', 'failed'),
    admin.from('mf_statement_import_batches').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('status', 'failed'),
    admin.from('mf_bank_connections').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('sync_status', 'error'),
  ]);
  if (reviewing.error || failedOcr.error || failedImports.error || openFinanceErrors.error) {
    throw new Error('AUTOMATION_DATA_QUALITY_FAILED');
  }

  const issues = [
    { code: 'OCR_REVIEW_PENDING', count: reviewing.count || 0, severity: 'WARNING' },
    { code: 'OCR_FAILED', count: failedOcr.count || 0, severity: 'ERROR' },
    { code: 'IMPORT_FAILED', count: failedImports.count || 0, severity: 'ERROR' },
    { code: 'OPEN_FINANCE_SYNC_ERROR', count: openFinanceErrors.count || 0, severity: 'ERROR' },
  ].filter((item) => item.count > 0);

  return {
    status: issues.some((item) => item.severity === 'ERROR') ? 'FAIL' : issues.length ? 'WARNING' : 'PASS',
    issue_count: issues.reduce((sum, item) => sum + item.count, 0),
    issues,
  };
}

async function pulseContext(admin: SupabaseClient, userId: string) {
  const [agenda, budgets, cards, goals, quality] = await Promise.all([
    agendaContext(admin, userId),
    budgetContext(admin, userId),
    cardContext(admin, userId),
    goalContext(admin, userId),
    dataQualityContext(admin, userId),
  ]);

  const cardAttention = cards.items.filter((item: any) => item.classification !== 'NORMAL').length;
  const goalAttention = goals.items.filter((item: any) => item.status === 'OVERDUE').length;

  const nextAction = quality.status === 'FAIL'
    ? 'REVIEW_DATA_QUALITY'
    : agenda.overdue_count > 0
      ? 'REVIEW_OVERDUE_COMMITMENTS'
      : budgets.attention_count > 0
        ? 'REVIEW_BUDGET'
        : cardAttention > 0
          ? 'REVIEW_CARDS'
          : goalAttention > 0
            ? 'REVIEW_GOALS'
            : 'NO_URGENT_ACTION';

  return {
    commitments_next_7_days: agenda.next_7_days_count,
    overdue_commitments: agenda.overdue_count,
    budget_attention_count: budgets.attention_count,
    card_attention_count: cardAttention,
    goal_attention_count: goalAttention,
    data_quality_status: quality.status,
    next_action: nextAction,
  };
}

function notificationMetadata(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const allowed = new Set(['reference', 'status', 'severity', 'count', 'due_date', 'classification', 'percentage', 'trend']);
  const result: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!allowed.has(key)) continue;
    if (typeof raw === 'string') result[key] = raw.slice(0, 160);
    else if (typeof raw === 'number' && Number.isFinite(raw)) result[key] = raw;
    else if (typeof raw === 'boolean') result[key] = raw;
  }
  return result;
}

async function createNotification(admin: SupabaseClient, userId: string, payload: Record<string, unknown>) {
  const priority = String(payload.priority || 'INFO').toUpperCase();
  if (!['INFO', 'ATTENTION', 'WARNING', 'CRITICAL'].includes(priority)) throw new Error('AUTOMATION_NOTIFICATION_PRIORITY_INVALID');
  const type = String(payload.type || 'automation').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').slice(0, 64) || 'automation';
  const title = sanitizeNotificationText(payload.title, 120);
  const message = sanitizeNotificationText(payload.message, 360);
  const actionPath = payload.action_path == null ? null : (isSafeActionPath(payload.action_path) ? payload.action_path : null);
  const dedupeKey = String(payload.dedupe_key || '').trim().slice(0, 180) || null;

  const { data, error } = await admin
    .from('mf_automation_notifications')
    .upsert({
      user_id: userId,
      type,
      priority,
      title,
      message,
      action_path: actionPath,
      source: 'n8n',
      dedupe_key: dedupeKey,
      metadata: notificationMetadata(payload.metadata),
      status: 'unread',
    }, { onConflict: 'user_id,dedupe_key', ignoreDuplicates: false })
    .select('id,status,created_at')
    .single();
  if (error) throw new Error('AUTOMATION_NOTIFICATION_CREATE_FAILED');
  return { reference: String(data.id), status: String(data.status), created_at: String(data.created_at) };
}

export async function executeAutomationAction(
  admin: SupabaseClient,
  action: AutomationAction,
  contextRef: string,
  payload: Record<string, unknown>,
) {
  const context = await resolveAutomationContext(admin, contextRef, ACTION_SCOPE[action]);
  switch (action) {
    case 'pulse.context': return pulseContext(admin, context.user_id);
    case 'budget.context': return budgetContext(admin, context.user_id);
    case 'card.context': return cardContext(admin, context.user_id);
    case 'goal.context': return goalContext(admin, context.user_id);
    case 'agenda.context': return agendaContext(admin, context.user_id);
    case 'recurrence.candidates': return recurrenceCandidates(admin, context.user_id);
    case 'data_quality.check': return dataQualityContext(admin, context.user_id);
    case 'notification.create': return createNotification(admin, context.user_id, payload);
  }
}

const TARGET_PREFERENCE_COLUMN: Record<TargetModule, string> = {
  pulse: 'pulse_enabled',
  budget: 'budget_watch_enabled',
  cards: 'card_watch_enabled',
  goals: 'goal_watch_enabled',
  agenda: 'financial_agenda_enabled',
  recurrence: 'smart_recurrence_enabled',
  data_quality: 'data_quality_enabled',
};

export async function listAutomationTargets(admin: SupabaseClient, module: TargetModule, limit: number) {
  const column = TARGET_PREFERENCE_COLUMN[module];
  const { data, error } = await admin
    .from('mf_automation_preferences')
    .select(`user_id,${column}`)
    .eq('enabled', true)
    .eq(column, true)
    .limit(limit);
  if (error) throw new Error('AUTOMATION_TARGETS_FAILED');

  const targets = [];
  for (const row of (data || []) as Record<string, unknown>[]) {
    const userId = String(row.user_id || '');
    if (!userId) continue;
    const { data: contextData, error: contextError } = await admin.rpc('mf_create_automation_context', {
      p_user_id: userId,
      p_scopes: [module, 'notifications'],
      p_source: `n8n:${module}`,
      p_ttl_seconds: 900,
      p_max_uses: 20,
    });
    if (contextError) throw new Error('AUTOMATION_CONTEXT_CREATE_FAILED');
    const context = unwrapRpcRow(contextData);
    if (!context?.context_ref) throw new Error('AUTOMATION_CONTEXT_CREATE_FAILED');
    targets.push({
      user_hash: await userHash(userId),
      user_context: {
        context_ref: String(context.context_ref),
        mode: 'automation_initiated',
        scope: module,
        expires_at: String(context.expires_at || ''),
      },
    });
  }
  return { module, count: targets.length, targets };
}
