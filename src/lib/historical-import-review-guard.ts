import { supabase } from './supabase';

type BalanceMode = 'keep' | 'apply_new' | 'statement';

type ImportApproval = {
  reviewedAt: number;
  mode: BalanceMode;
  periodStart: string | null;
  periodEnd: string | null;
};

type ImportResult = {
  insertedCount: number;
  duplicateCount: number;
  periodStart: string | null;
  periodEnd: string | null;
  netNew: number;
  mode: BalanceMode;
  balanceBefore: number;
  balanceAfter?: number;
};

const PANEL_ID = 'mf-historical-import-review';
let selectedMode: BalanceMode = 'keep';
let reviewedState = false;
let activeSnapshotIdentity = '';

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

function parseBrazilianDate(value: string): Date | null {
  const match = value.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const date = new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]), 12, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dateLabel(date: Date): string {
  return date.toLocaleDateString('pt-BR');
}

function monthLabel(key: string): string {
  const [year, month] = key.split('-').map(Number);
  return new Date(year, month - 1, 1, 12, 0, 0).toLocaleDateString('pt-BR', {
    month: 'long',
    year: 'numeric',
  });
}

function parseCurrency(value: string): number {
  const negative = value.includes('-');
  const cleaned = value
    .replace(/R\$/gi, '')
    .replace(/\s/g, '')
    .replace(/[^\d,.-]/g, '')
    .replace(/\.(?=\d{3}(?:\D|$))/g, '')
    .replace(',', '.');
  const parsed = Number(cleaned.replace(/-/g, ''));
  if (!Number.isFinite(parsed)) return 0;
  return roundMoney(negative ? -Math.abs(parsed) : parsed);
}

function findConfirmButton(): HTMLButtonElement | null {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
    normalize(button.textContent).includes('confirmar importacao'),
  ) || null;
}

function findReviewRoot(button: HTMLButtonElement): HTMLElement | null {
  let current: HTMLElement | null = button.parentElement;
  while (current && current !== document.body) {
    const text = normalize(current.textContent);
    if (text.includes('lancamentos') && text.includes('prontos') && text.includes('novo arquivo')) return current;
    current = current.parentElement;
  }
  return null;
}

function transactionRows(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('div.p-4.rounded-xl.border')).filter((row) =>
    Array.from(row.querySelectorAll('span')).some((span) => /^\d{2}\/\d{2}\/\d{4}$/.test(String(span.textContent || '').trim())),
  );
}

function reviewSnapshot(root: HTMLElement) {
  const rows = transactionRows(root);
  const dates: Date[] = [];
  let fileNet = 0;
  let incomes = 0;
  let expenses = 0;

  rows.forEach((row) => {
    const dateText = Array.from(row.querySelectorAll('span'))
      .map((span) => String(span.textContent || '').trim())
      .find((text) => /^\d{2}\/\d{2}\/\d{4}$/.test(text));
    const date = dateText ? parseBrazilianDate(dateText) : null;
    if (date) dates.push(date);

    const amountText = Array.from(row.querySelectorAll<HTMLElement>('div'))
      .map((element) => String(element.textContent || '').trim())
      .find((text) => /^[+-]\s*R\$/.test(text));
    const amount = amountText ? parseCurrency(amountText) : 0;
    fileNet += amount;
    if (amount >= 0) incomes += amount;
    else expenses += Math.abs(amount);
  });

  dates.sort((a, b) => a.getTime() - b.getTime());
  const periodStart = dates[0] || null;
  const periodEnd = dates[dates.length - 1] || null;
  const months = Array.from(new Set(dates.map((date) => toDateKey(date).slice(0, 7))));

  return {
    count: rows.length,
    periodStart,
    periodEnd,
    months,
    incomes: roundMoney(incomes),
    expenses: roundMoney(expenses),
    fileNet: roundMoney(fileNet),
  };
}

function calibrationButton(root: HTMLElement): HTMLButtonElement | null {
  return Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
    normalize(button.textContent).includes('calibrar saldo do mfinanceiro') ||
    normalize(button.textContent).includes('substituir saldo atual'),
  ) || null;
}

function calibrationIsActive(button: HTMLButtonElement | null): boolean {
  if (!button) return false;
  return button.className.includes('bg-brand-primary/20') || button.className.includes('border-brand-primary/40');
}

function setCalibration(root: HTMLElement, active: boolean) {
  const button = calibrationButton(root);
  if (!button || calibrationIsActive(button) === active) return;
  button.click();
}

function currentMode(panel: HTMLElement): BalanceMode {
  const selected = panel.querySelector<HTMLInputElement>('input[name="mf-import-balance-mode"]:checked');
  return (selected?.value as BalanceMode) || selectedMode || 'keep';
}

function clearReviewed(panel?: HTMLElement | null) {
  reviewedState = false;
  panel?.querySelector<HTMLInputElement>('[data-role="reviewed"]')?.removeAttribute('checked');
  const checkbox = panel?.querySelector<HTMLInputElement>('[data-role="reviewed"]');
  if (checkbox) checkbox.checked = false;
}

function setMode(panel: HTMLElement, root: HTMLElement, mode: BalanceMode) {
  selectedMode = mode;
  const input = panel.querySelector<HTMLInputElement>(`input[name="mf-import-balance-mode"][value="${mode}"]`);
  if (input) input.checked = true;
  setCalibration(root, mode === 'statement');
  panel.dataset.mode = mode;
  clearReviewed(panel);
}

function modeCard(mode: BalanceMode, title: string, description: string, selected: boolean, disabled = false) {
  const label = document.createElement('label');
  label.className = `block rounded-xl border px-3 py-2.5 transition ${disabled ? 'cursor-not-allowed border-white/5 bg-white/[0.015] opacity-40' : 'cursor-pointer border-white/10 bg-black/20 hover:border-white/20'}`;

  const row = document.createElement('div');
  row.className = 'flex items-start gap-2';

  const input = document.createElement('input');
  input.type = 'radio';
  input.name = 'mf-import-balance-mode';
  input.value = mode;
  input.disabled = disabled;
  input.className = 'mt-0.5 accent-cyan-400';
  input.checked = selected && !disabled;

  const copy = document.createElement('div');
  const strong = document.createElement('strong');
  strong.className = 'block text-[11px] text-white';
  strong.textContent = title;
  const paragraph = document.createElement('p');
  paragraph.className = 'mt-0.5 text-[9px] leading-relaxed text-white/40';
  paragraph.textContent = description;
  copy.append(strong, paragraph);
  row.append(input, copy);
  label.append(row);
  return label;
}

async function loadOverlap(panel: HTMLElement, start: string | null, end: string | null) {
  const target = panel.querySelector<HTMLElement>('[data-role="overlap"]');
  if (!target || !start || !end) return;

  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId || !document.body.contains(panel)) return;

  const [settingsResult, entriesResult] = await Promise.all([
    supabase.from('mf_user_settings').select('current_balance').eq('user_id', userId).maybeSingle(),
    supabase
      .from('mf_finance_ledger_entries')
      .select('amount')
      .eq('user_id', userId)
      .gte('date', start)
      .lte('date', end),
  ]);

  if (!document.body.contains(panel)) return;
  const currentBalance = Number(settingsResult.data?.current_balance || 0);
  const existing = entriesResult.data || [];
  const existingNet = roundMoney(existing.reduce((sum, item: any) => sum + Number(item.amount || 0), 0));
  panel.dataset.balanceBefore = String(currentBalance);
  panel.dataset.existingCount = String(existing.length);
  target.textContent = `${existing.length} lançamento(s) já cadastrado(s) nesse período · movimento líquido existente: ${money(existingNet)} · saldo atual confirmado: ${money(currentBalance)}.`;
}

function buildPanel(root: HTMLElement, snapshot: ReturnType<typeof reviewSnapshot>): HTMLElement {
  const panel = document.createElement('section');
  panel.id = PANEL_ID;
  panel.className = 'shrink-0 rounded-2xl border border-cyan-400/25 bg-cyan-400/[0.055] p-3';
  panel.dataset.periodStart = snapshot.periodStart ? toDateKey(snapshot.periodStart) : '';
  panel.dataset.periodEnd = snapshot.periodEnd ? toDateKey(snapshot.periodEnd) : '';

  const today = toDateKey(new Date());
  const isHistorical = Boolean(panel.dataset.periodEnd && panel.dataset.periodEnd < today);
  const period = snapshot.periodStart && snapshot.periodEnd
    ? `${dateLabel(snapshot.periodStart)} até ${dateLabel(snapshot.periodEnd)}`
    : 'não identificado';
  const months = snapshot.months.length ? snapshot.months.map(monthLabel).join(', ') : 'não identificado';
  const hasStatementBalance = Boolean(calibrationButton(root));
  if (!hasStatementBalance && selectedMode === 'statement') selectedMode = 'keep';
  panel.dataset.mode = selectedMode;

  const header = document.createElement('div');
  header.className = 'flex flex-wrap items-start justify-between gap-3';
  const titleBox = document.createElement('div');
  const title = document.createElement('div');
  title.className = 'text-[10px] font-black uppercase tracking-[0.16em] text-cyan-300';
  title.textContent = 'Conferência obrigatória do período';
  const description = document.createElement('p');
  description.className = 'mt-1 text-[10px] leading-relaxed text-white/55';
  description.textContent = isHistorical
    ? 'O arquivo contém dias anteriores. Esses lançamentos serão posicionados nas datas originais e não alterarão o saldo atual sem autorização.'
    : 'Confira o intervalo e escolha conscientemente como o saldo atual deve reagir à importação.';
  titleBox.append(title, description);

  const badge = document.createElement('span');
  badge.className = `rounded-full px-2 py-1 text-[8px] font-black uppercase ${isHistorical ? 'bg-amber-500/15 text-amber-300' : 'bg-green-500/15 text-green-300'}`;
  badge.textContent = isHistorical ? 'Período histórico' : 'Período atual';
  header.append(titleBox, badge);

  const metrics = document.createElement('div');
  metrics.className = 'mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4';
  const metricValues = [
    ['Período detectado', period],
    ['Mês/competência', months],
    ['Entradas do arquivo', money(snapshot.incomes)],
    ['Saídas do arquivo', money(snapshot.expenses)],
  ];
  metricValues.forEach(([label, value]) => {
    const box = document.createElement('div');
    box.className = 'rounded-xl border border-white/10 bg-black/20 px-3 py-2';
    const small = document.createElement('div');
    small.className = 'text-[8px] font-bold uppercase text-white/30';
    small.textContent = label;
    const valueNode = document.createElement('div');
    valueNode.className = 'mt-1 text-[10px] font-bold text-white/75';
    valueNode.textContent = value;
    box.append(small, valueNode);
    metrics.append(box);
  });

  const overlap = document.createElement('div');
  overlap.dataset.role = 'overlap';
  overlap.className = 'mt-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-[9px] leading-relaxed text-white/45';
  overlap.textContent = 'Verificando lançamentos já existentes nesse período...';

  const modes = document.createElement('div');
  modes.className = 'mt-3 grid gap-2 lg:grid-cols-3';
  modes.append(
    modeCard('keep', 'Manter o saldo atual', 'Recomendado para extratos antigos ou períodos que já estão refletidos no saldo do banco.', selectedMode === 'keep'),
    modeCard('apply_new', 'Aplicar somente lançamentos novos', 'Após remover duplicados, soma apenas a diferença líquida realmente nova ao saldo atual.', selectedMode === 'apply_new'),
    modeCard('statement', 'Substituir pelo saldo final do extrato', hasStatementBalance
      ? 'Usa exatamente o saldo final informado no arquivo. A substituição só acontece após esta confirmação.'
      : 'Este arquivo não trouxe um saldo final confiável. A opção permanece indisponível.', selectedMode === 'statement', !hasStatementBalance),
  );

  modes.addEventListener('change', (event) => {
    const input = event.target as HTMLInputElement | null;
    if (!input || input.name !== 'mf-import-balance-mode') return;
    setMode(panel, root, input.value as BalanceMode);
  });

  const authorization = document.createElement('label');
  authorization.className = 'mt-3 flex cursor-pointer items-start gap-2 rounded-xl border border-white/10 bg-black/25 px-3 py-2.5';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.dataset.role = 'reviewed';
  checkbox.className = 'mt-0.5 accent-cyan-400';
  checkbox.checked = reviewedState;
  checkbox.addEventListener('change', () => {
    reviewedState = checkbox.checked;
  });
  const authorizationText = document.createElement('span');
  authorizationText.className = 'text-[10px] leading-relaxed text-white/65';
  authorizationText.textContent = 'Revisei o período, os totais e a opção de saldo. Autorizo a importação conforme a seleção acima.';
  authorization.append(checkbox, authorizationText);

  const error = document.createElement('div');
  error.dataset.role = 'error';
  error.className = 'mt-2 hidden text-[9px] font-bold text-red-300';
  error.textContent = 'Marque a confirmação de revisão antes de importar.';

  panel.append(header, metrics, overlap, modes, authorization, error);
  void loadOverlap(panel, panel.dataset.periodStart || null, panel.dataset.periodEnd || null);
  window.setTimeout(() => setCalibration(root, selectedMode === 'statement'), 0);
  return panel;
}

let renderQueued = false;
let snapshotKey = '';

function renderReviewPanel() {
  renderQueued = false;
  const button = findConfirmButton();
  if (!button) return;
  const root = findReviewRoot(button);
  if (!root) return;

  const snapshot = reviewSnapshot(root);
  const nextIdentity = `${snapshot.count}:${snapshot.periodStart?.getTime() || 0}:${snapshot.periodEnd?.getTime() || 0}:${snapshot.incomes}:${snapshot.expenses}`;
  const nextKey = `${nextIdentity}:${Boolean(calibrationButton(root))}`;
  if (activeSnapshotIdentity && activeSnapshotIdentity !== nextIdentity) reviewedState = false;
  activeSnapshotIdentity = nextIdentity;

  const existing = root.querySelector<HTMLElement>(`#${PANEL_ID}`);
  if (existing && snapshotKey === nextKey) {
    const checkbox = existing.querySelector<HTMLInputElement>('[data-role="reviewed"]');
    if (checkbox) checkbox.checked = reviewedState;
    const mode = currentMode(existing);
    selectedMode = mode;
    setCalibration(root, mode === 'statement');
    return;
  }

  existing?.remove();
  const panel = buildPanel(root, snapshot);
  root.insertBefore(panel, root.firstChild);
  snapshotKey = nextKey;
}

function queueRender() {
  if (renderQueued) return;
  renderQueued = true;
  window.setTimeout(renderReviewPanel, 60);
}

function setApproval(root: HTMLElement, panel: HTMLElement) {
  const mode = currentMode(panel);
  selectedMode = mode;
  const approval: ImportApproval = {
    reviewedAt: Date.now(),
    mode,
    periodStart: panel.dataset.periodStart || null,
    periodEnd: panel.dataset.periodEnd || null,
  };
  (window as any).__mfStatementImportApproval = approval;
  setCalibration(root, mode === 'statement');
}

function applyResultToSuccess(result: ImportResult) {
  const heading = Array.from(document.querySelectorAll<HTMLElement>('h2')).find((item) =>
    normalize(item.textContent).includes('importacao concluida'),
  );
  if (!heading) return;
  const paragraph = heading.parentElement?.querySelector('p');
  if (!paragraph) return;

  const balanceText = result.balanceAfter !== undefined
    ? ` Saldo após a operação: ${money(result.balanceAfter)}.`
    : '';
  paragraph.textContent = `${result.insertedCount} lançamento(s) novo(s) foram adicionados. ${result.duplicateCount} duplicado(s) foram ignorados.${balanceText}`;
}

function resetReviewState() {
  selectedMode = 'keep';
  reviewedState = false;
  activeSnapshotIdentity = '';
  snapshotKey = '';
  delete (window as any).__mfStatementImportApproval;
}

function installHistoricalImportReview() {
  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null;
    const button = target?.closest<HTMLButtonElement>('button');
    const label = normalize(button?.textContent);

    if (label.includes('novo arquivo') || label.includes('voltar ao dashboard')) {
      resetReviewState();
      return;
    }

    const confirmButton = findConfirmButton();
    const reviewRoot = confirmButton ? findReviewRoot(confirmButton) : null;
    const panel = reviewRoot?.querySelector<HTMLElement>(`#${PANEL_ID}`) || null;
    if (reviewRoot && target && transactionRows(reviewRoot).some((row) => row.contains(target)) && !label.includes('confirmar importacao')) {
      clearReviewed(panel);
    }

    if (!button || !label.includes('confirmar importacao')) return;
    const root = findReviewRoot(button);
    const activePanel = root?.querySelector<HTMLElement>(`#${PANEL_ID}`) || null;
    const reviewed = activePanel?.querySelector<HTMLInputElement>('[data-role="reviewed"]');
    if (!root || !activePanel || !reviewed?.checked || !reviewedState) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      const error = activePanel?.querySelector<HTMLElement>('[data-role="error"]');
      error?.classList.remove('hidden');
      reviewed?.focus();
      return;
    }

    activePanel.querySelector<HTMLElement>('[data-role="error"]')?.classList.add('hidden');
    setApproval(root, activePanel);
  }, true);

  window.addEventListener('mf:statement-import-result', (event) => {
    const result = (event as CustomEvent<ImportResult>).detail;
    if (!result) return;
    try {
      sessionStorage.setItem('mf:last-statement-import-result', JSON.stringify(result));
    } catch {
      // The success view can still be patched from the in-memory event.
    }
    reviewedState = false;
    window.setTimeout(() => applyResultToSuccess(result), 50);
    window.setTimeout(() => applyResultToSuccess(result), 500);
  });

  const observer = new MutationObserver(() => {
    queueRender();
    try {
      const stored = sessionStorage.getItem('mf:last-statement-import-result');
      if (stored) applyResultToSuccess(JSON.parse(stored) as ImportResult);
    } catch {
      // Ignore restrictive storage modes and malformed stale values.
    }
  });
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
  queueRender();
  window.addEventListener('beforeunload', () => observer.disconnect(), { once: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', installHistoricalImportReview, { once: true });
} else {
  installHistoricalImportReview();
}

export {};
