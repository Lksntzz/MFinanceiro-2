import * as XLSX from 'xlsx';
import { supabase } from './supabase';

type LedgerRow = {
  id: string;
  date: string;
  amount: number | string | null;
  type?: string | null;
  description?: string | null;
  category?: string | null;
  source?: string | null;
  status?: string | null;
  affects_balance?: boolean | null;
  payment_method?: string | null;
};

type BalanceState = {
  currentBalance: number;
  balanceConfirmed: boolean;
  rows: LedgerRow[];
  dayClosing: Map<string, number>;
  allNet: number;
  openingBase: number;
};

const STYLE_ID = 'mf-history-income-balance-style';
const CURRENT_CARD_ID = 'mf-history-current-balance-card';
const NOTE_ID = 'mf-history-balance-note';
const EXTRA_ACTIONS_ID = 'mf-income-extra-actions';

let activeUserId: string | null = null;
let state: BalanceState | null = null;
let refreshPromise: Promise<void> | null = null;
let patchTimer: number | null = null;
let realtimeChannel: ReturnType<typeof supabase.channel> | null = null;

const normalize = (value: string | null | undefined) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const money = (value: number) =>
  Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function numberValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateKey(value: string | null | undefined): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const key = raw.includes('T') ? raw.split('T')[0] : raw.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : '';
}

function isVisible(element: Element | null): element is HTMLElement {
  if (!(element instanceof HTMLElement)) return false;
  const style = window.getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
}

function affectsCurrentBalance(row: LedgerRow): boolean {
  return normalize(row.status || 'paid') !== 'pending' && row.affects_balance !== false;
}

function signedAmount(row: LedgerRow): number {
  const amount = numberValue(row.amount);
  if (amount !== 0) return amount;
  return normalize(row.type) === 'income' ? Math.abs(amount) : -Math.abs(amount);
}

function installStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .mf-history-summary-grid { grid-template-columns: repeat(4, minmax(0, 1fr)) !important; }
    .mf-history-day-balance { margin-left: .5rem; color: rgba(255,255,255,.48); font-size: 10px; white-space: nowrap; }
    #${NOTE_ID} { border: 1px solid rgba(0,242,255,.16); background: rgba(0,242,255,.055); border-radius: 12px; padding: 9px 12px; font-size: 10px; line-height: 1.45; color: rgba(255,255,255,.58); }
    #${NOTE_ID} strong { color: rgba(255,255,255,.9); }
    #${EXTRA_ACTIONS_ID} { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    #${EXTRA_ACTIONS_ID} button { border: 1px solid rgba(255,255,255,.1); background: rgba(255,255,255,.055); color: rgba(255,255,255,.9); border-radius: 12px; padding: 8px 11px; font-size: 12px; font-weight: 800; transition: .18s ease; }
    #${EXTRA_ACTIONS_ID} button:hover { border-color: rgba(0,242,255,.38); background: rgba(0,242,255,.1); color: #00f2ff; }
    @media (max-width: 760px) {
      .mf-history-summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
      #${EXTRA_ACTIONS_ID} { width: 100%; }
      #${EXTRA_ACTIONS_ID} button { flex: 1; }
    }
  `;
  document.head.appendChild(style);
}

function calculateState(currentBalance: number, balanceConfirmed: boolean, rows: LedgerRow[]): BalanceState {
  const relevant = rows.filter(affectsCurrentBalance);
  const allNet = roundMoney(relevant.reduce((sum, row) => sum + signedAmount(row), 0));
  const openingBase = roundMoney(currentBalance - allNet);
  const byDay = new Map<string, number>();

  relevant.forEach((row) => {
    const key = dateKey(row.date);
    if (!key) return;
    byDay.set(key, roundMoney((byDay.get(key) || 0) + signedAmount(row)));
  });

  const dayClosing = new Map<string, number>();
  let running = currentBalance;
  [...byDay.keys()].sort((a, b) => b.localeCompare(a)).forEach((key) => {
    dayClosing.set(key, roundMoney(running));
    running = roundMoney(running - (byDay.get(key) || 0));
  });

  return { currentBalance, balanceConfirmed, rows, dayClosing, allNet, openingBase };
}

async function refreshData() {
  if (!activeUserId) return;
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    const [settingsResult, ledgerResult] = await Promise.all([
      supabase
        .from('mf_user_settings')
        .select('current_balance,balance_confirmed')
        .eq('user_id', activeUserId)
        .maybeSingle(),
      supabase
        .from('mf_finance_ledger_entries')
        .select('id,date,amount,type,description,category,source,status,affects_balance,payment_method')
        .eq('user_id', activeUserId)
        .order('date', { ascending: true }),
    ]);

    if (settingsResult.error) throw settingsResult.error;
    if (ledgerResult.error) throw ledgerResult.error;

    state = calculateState(
      numberValue(settingsResult.data?.current_balance),
      settingsResult.data?.balance_confirmed === true,
      (ledgerResult.data || []) as LedgerRow[],
    );
  })()
    .catch((error) => console.warn('Falha ao conferir saldo do histórico:', error))
    .finally(() => {
      refreshPromise = null;
      queuePatch();
    });

  return refreshPromise;
}

function visibleHistoryShell(): HTMLElement | null {
  return Array.from(document.querySelectorAll<HTMLElement>('.history-shell')).find(isVisible) || null;
}

function currentFilters(shell: HTMLElement) {
  const search = normalize(shell.querySelector<HTMLInputElement>('input[placeholder*="Buscar lançamento"]')?.value);
  const type = shell.querySelector<HTMLSelectElement>('select')?.value || 'all';
  return { search, type };
}

function filteredRows(shell: HTMLElement, includePending = false): LedgerRow[] {
  if (!state) return [];
  const filters = currentFilters(shell);
  return state.rows.filter((row) => {
    if (!includePending && !affectsCurrentBalance(row)) return false;
    const type = normalize(row.type) === 'income' || signedAmount(row) > 0 ? 'income' : 'expense';
    if (filters.type !== 'all' && type !== filters.type) return false;
    if (!filters.search) return true;
    return normalize([
      row.description,
      row.category,
      row.source,
      String(row.amount ?? ''),
    ].filter(Boolean).join(' ')).includes(filters.search);
  });
}

function findSummaryGrid(shell: HTMLElement): HTMLElement | null {
  return Array.from(shell.querySelectorAll<HTMLElement>('div.grid')).find((grid) => {
    const labels = Array.from(grid.children).map((child) => normalize(child.querySelector('div')?.textContent));
    const hasIncome = labels.some((label) => label.startsWith('entradas'));
    const hasExpense = labels.some((label) => label.startsWith('saidas'));
    const hasResult = labels.some((label) => label === 'saldo' || label.startsWith('movimento liquido'));
    return hasIncome && hasExpense && hasResult;
  }) || null;
}

function setCard(card: Element | undefined, label: string, value: number, tone: 'positive' | 'negative' | 'neutral') {
  if (!(card instanceof HTMLElement)) return;
  const labelNode = card.querySelector<HTMLElement>('div:first-child');
  const valueNode = card.querySelector<HTMLElement>('div:last-child');
  if (labelNode) labelNode.textContent = label;
  if (valueNode) {
    valueNode.textContent = money(value);
    valueNode.classList.remove('text-green-400', 'text-brand-primary', 'text-red-400');
    if (tone === 'positive') valueNode.classList.add('text-green-400');
    if (tone === 'negative') valueNode.classList.add('text-red-400');
    if (tone === 'neutral') valueNode.classList.add('text-brand-primary');
  }
}

function patchSummary(shell: HTMLElement) {
  if (!state) return;
  const grid = findSummaryGrid(shell);
  if (!grid) return;
  grid.classList.add('mf-history-summary-grid');

  const rows = filteredRows(shell);
  const income = roundMoney(rows.filter((row) => signedAmount(row) > 0).reduce((sum, row) => sum + Math.abs(signedAmount(row)), 0));
  const expense = roundMoney(rows.filter((row) => signedAmount(row) < 0).reduce((sum, row) => sum + Math.abs(signedAmount(row)), 0));
  const net = roundMoney(income - expense);
  const cards = Array.from(grid.children);

  setCard(cards[0], 'Entradas realizadas', income, 'positive');
  setCard(cards[1], 'Saídas realizadas', expense, 'neutral');
  setCard(cards[2], 'Movimento líquido', net, net < 0 ? 'negative' : 'neutral');

  let currentCard = grid.querySelector<HTMLElement>(`#${CURRENT_CARD_ID}`);
  if (!currentCard) {
    currentCard = document.createElement('div');
    currentCard.id = CURRENT_CARD_ID;
    currentCard.className = 'glass-card !p-3';
    currentCard.innerHTML = '<div class="text-[9px] font-bold uppercase text-white/40">Saldo atual confirmado</div><div class="truncate text-sm font-bold text-brand-primary"></div>';
    grid.appendChild(currentCard);
  }
  const currentValue = currentCard.querySelector<HTMLElement>('div:last-child');
  if (currentValue) currentValue.textContent = money(state.currentBalance);

  let note = shell.querySelector<HTMLElement>(`#${NOTE_ID}`);
  if (!note) {
    note = document.createElement('div');
    note.id = NOTE_ID;
    grid.insertAdjacentElement('afterend', note);
  }

  const difference = roundMoney(state.currentBalance - net);
  const confirmation = state.balanceConfirmed ? 'confirmado pelo usuário' : 'ainda não confirmado';
  note.innerHTML = `O <strong>movimento líquido</strong> soma somente os lançamentos realizados no filtro atual. O <strong>saldo atual</strong> é ${confirmation} e não precisa ser igual ao movimento do período. Diferença entre saldo e filtro: <strong>${money(difference)}</strong>. Base anterior/ajustes fora de todo o histórico: <strong>${money(state.openingBase)}</strong>.`;
}

function patchDayBalances(shell: HTMLElement) {
  if (!state) return;
  shell.querySelectorAll<HTMLElement>('article').forEach((article) => {
    const dateText = article.querySelector<HTMLElement>('button div.min-w-0 > div')?.textContent || '';
    const normalizedDate = normalize(dateText);
    if (!normalizedDate || normalizedDate === 'sem data') return;

    const candidate = state.rows.find((row) => {
      const key = dateKey(row.date);
      if (!key) return false;
      const label = new Date(`${key}T12:00:00`).toLocaleDateString('pt-BR', {
        weekday: 'long', day: '2-digit', month: 'long',
      });
      return normalize(label) === normalizedDate;
    });
    if (!candidate) return;
    const key = dateKey(candidate.date);
    const closing = state.dayClosing.get(key);
    if (closing === undefined) return;

    const headerRight = article.querySelector<HTMLElement>('button > div:last-child');
    if (!headerRight) return;
    let badge = headerRight.querySelector<HTMLElement>('.mf-history-day-balance');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'mf-history-day-balance';
      headerRight.appendChild(badge);
    }
    badge.textContent = `Saldo ao fim do dia: ${money(closing)}`;
  });
}

function findIncomeHeader(): HTMLElement | null {
  const headings = Array.from(document.querySelectorAll<HTMLElement>('h2')).filter((heading) => normalize(heading.textContent).includes('renda e folha'));
  return headings.map((heading) => heading.closest('header')).find(isVisible) || null;
}

function openLauncher(category: 'Renda extra' | 'Benefícios', benefitMethod: boolean) {
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.textContent = 'Lançar';
  trigger.style.display = 'none';
  document.body.appendChild(trigger);
  trigger.click();
  trigger.remove();

  const configure = (attempt = 0) => {
    const root = document.getElementById('mf-unified-transaction-root');
    if (!root || attempt > 20) return;
    const incomeButton = Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
      isVisible(button) && normalize(button.textContent) === 'entrada',
    );
    if (incomeButton) incomeButton.click();

    window.setTimeout(() => {
      const select = Array.from(root.querySelectorAll<HTMLSelectElement>('select')).find((candidate) =>
        Array.from(candidate.options).some((option) => option.value === category || option.textContent?.trim() === category),
      );
      if (select) {
        const value = Array.from(select.options).find((option) => option.value === category || option.textContent?.trim() === category)?.value;
        if (value) {
          const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
          setter?.call(select, value);
          select.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
      if (benefitMethod) {
        const benefitButton = Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
          isVisible(button) && normalize(button.textContent) === 'beneficio',
        );
        benefitButton?.click();
      }
    }, 60);
  };

  const waitForLauncher = (attempt = 0) => {
    const root = document.getElementById('mf-unified-transaction-root');
    if (root) configure(attempt);
    else if (attempt < 20) window.setTimeout(() => waitForLauncher(attempt + 1), 50);
  };
  waitForLauncher();
}

function patchIncomeActions() {
  const header = findIncomeHeader();
  if (!header || header.querySelector(`#${EXTRA_ACTIONS_ID}`)) return;
  const actions = header.querySelector<HTMLElement>('div.flex.flex-wrap.items-center.gap-2');
  if (!actions) return;

  const wrapper = document.createElement('div');
  wrapper.id = EXTRA_ACTIONS_ID;

  const extraButton = document.createElement('button');
  extraButton.type = 'button';
  extraButton.textContent = '+ Renda extra';
  extraButton.addEventListener('click', () => openLauncher('Renda extra', false));

  const benefitButton = document.createElement('button');
  benefitButton.type = 'button';
  benefitButton.textContent = '+ Benefício';
  benefitButton.addEventListener('click', () => openLauncher('Benefícios', true));

  wrapper.append(extraButton, benefitButton);
  actions.prepend(wrapper);
}

function exportHistory(shell: HTMLElement) {
  if (!state) return;
  const rows = filteredRows(shell, true);
  const realized = rows.filter(affectsCurrentBalance);
  const income = roundMoney(realized.filter((row) => signedAmount(row) > 0).reduce((sum, row) => sum + Math.abs(signedAmount(row)), 0));
  const expense = roundMoney(realized.filter((row) => signedAmount(row) < 0).reduce((sum, row) => sum + Math.abs(signedAmount(row)), 0));
  const net = roundMoney(income - expense);
  const keys = rows.map((row) => dateKey(row.date)).filter(Boolean).sort();
  const periodStart = keys[0] || '';
  const periodEnd = keys[keys.length - 1] || '';

  const summaryRows = [
    ['Relatório', 'Histórico financeiro'],
    ['Gerado em', new Date().toLocaleString('pt-BR')],
    ['Período inicial', periodStart ? new Date(`${periodStart}T12:00:00`).toLocaleDateString('pt-BR') : 'Sem dados'],
    ['Período final', periodEnd ? new Date(`${periodEnd}T12:00:00`).toLocaleDateString('pt-BR') : 'Sem dados'],
    ['Entradas realizadas', income],
    ['Saídas realizadas', expense],
    ['Movimento líquido do filtro', net],
    ['Saldo atual confirmado', state.currentBalance],
    ['Base anterior/ajustes fora do histórico', state.openingBase],
    ['Saldo confirmado pelo usuário', state.balanceConfirmed ? 'Sim' : 'Não'],
  ];

  const transactionRows = [...rows]
    .sort((a, b) => dateKey(a.date).localeCompare(dateKey(b.date)) || String(a.id).localeCompare(String(b.id)))
    .map((row) => {
      const key = dateKey(row.date);
      const amount = signedAmount(row);
      return {
        Data: key ? new Date(`${key}T12:00:00`).toLocaleDateString('pt-BR') : '',
        Descrição: row.description || '',
        Categoria: row.category || 'Geral',
        Tipo: amount >= 0 ? 'Entrada' : 'Saída',
        Valor: Math.abs(amount),
        Situação: normalize(row.status) === 'pending' ? 'Pendente' : 'Realizado',
        'Afeta saldo': row.affects_balance === false ? 'Não' : 'Sim',
        Origem: row.source || '',
        'Forma de pagamento': row.payment_method || '',
        'Saldo ao fim do dia': state.dayClosing.get(key) ?? '',
      };
    });

  const workbook = XLSX.utils.book_new();
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
  summarySheet['!cols'] = [{ wch: 38 }, { wch: 24 }];
  const transactionSheet = XLSX.utils.json_to_sheet(transactionRows);
  transactionSheet['!cols'] = [
    { wch: 13 }, { wch: 38 }, { wch: 22 }, { wch: 12 }, { wch: 14 },
    { wch: 13 }, { wch: 12 }, { wch: 20 }, { wch: 20 }, { wch: 20 },
  ];
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Resumo');
  XLSX.utils.book_append_sheet(workbook, transactionSheet, 'Lançamentos');
  XLSX.writeFile(workbook, `MFinanceiro_Historico_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

function installExcelOverride() {
  document.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>('button');
    const shell = visibleHistoryShell();
    if (!button || !shell || !shell.contains(button) || normalize(button.textContent) !== 'excel') return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    void refreshData().then(() => exportHistory(shell));
  }, true);
}

function patch() {
  patchTimer = null;
  installStyle();
  patchIncomeActions();
  const shell = visibleHistoryShell();
  if (!shell) return;
  if (!state) {
    void refreshData();
    return;
  }
  patchSummary(shell);
  patchDayBalances(shell);
}

function queuePatch() {
  if (patchTimer !== null) return;
  patchTimer = window.setTimeout(patch, 80);
}

function installRealtime(userId: string) {
  if (realtimeChannel) void supabase.removeChannel(realtimeChannel);
  realtimeChannel = supabase
    .channel(`mf-history-balance-${userId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'mf_finance_ledger_entries', filter: `user_id=eq.${userId}` }, () => void refreshData())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'mf_user_settings', filter: `user_id=eq.${userId}` }, () => void refreshData())
    .subscribe();
}

function setUser(userId: string | null) {
  if (activeUserId === userId) return;
  activeUserId = userId;
  state = null;
  if (userId) {
    installRealtime(userId);
    void refreshData();
  } else if (realtimeChannel) {
    void supabase.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
}

function install() {
  installStyle();
  installExcelOverride();

  supabase.auth.getUser().then(({ data }) => setUser(data.user?.id || null)).catch(() => undefined);
  supabase.auth.onAuthStateChange((_event, session) => setUser(session?.user?.id || null));

  const observer = new MutationObserver(queuePatch);
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'value', 'style'] });
  document.addEventListener('input', queuePatch, true);
  document.addEventListener('change', queuePatch, true);
  queuePatch();

  window.addEventListener('beforeunload', () => {
    observer.disconnect();
    if (realtimeChannel) void supabase.removeChannel(realtimeChannel);
  }, { once: true });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
else install();

export {};
