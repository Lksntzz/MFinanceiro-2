import { supabase } from './supabase';

const normalize = (value?: string | null) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

function findLegacyTopButton(labels: string[]): HTMLButtonElement | null {
  const wanted = labels.map(normalize);
  const candidates = Array.from(
    document.querySelectorAll<HTMLButtonElement>('.mf-nav button[data-mf-hierarchy-original="true"], .mf-nav > button'),
  );

  return (
    candidates.find((button) => {
      if (button.closest('#mf-simple-navigation-root') || button.closest('#mf-simple-navigation-app')) return false;
      const label = normalize(button.textContent);
      return wanted.some((item) => label === item || label.includes(item));
    }) || null
  );
}

function findInsightsButton(): HTMLButtonElement | null {
  const subnavs = Array.from(document.querySelectorAll<HTMLElement>('.mf-content .mf-subnav'));
  const analysisSubnav = subnavs.find((subnav) => {
    const labels = Array.from(subnav.querySelectorAll<HTMLButtonElement>('button')).map((button) => normalize(button.textContent));
    return labels.some((label) => label.includes('estatisticas')) &&
      labels.some((label) => label.includes('saude'));
  });

  if (!analysisSubnav) return null;
  return (
    Array.from(analysisSubnav.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
      normalize(button.textContent).includes('insights'),
    ) || null
  );
}

let insightsRunToken = 0;

function openInsightsReliably() {
  const runToken = ++insightsRunToken;
  const deadline = Date.now() + 6000;
  sessionStorage.setItem('mf-simple-route', JSON.stringify({ primary: 'analysis', sub: 'insights' }));

  const ensureOpen = () => {
    if (runToken !== insightsRunToken) return;

    const analysisButton = findLegacyTopButton(['Análises']);
    if (analysisButton && !analysisButton.classList.contains('active')) analysisButton.click();

    const insightsButton = findInsightsButton();
    if (insightsButton) {
      if (!insightsButton.classList.contains('active')) insightsButton.click();
      if (insightsButton.classList.contains('active')) {
        window.dispatchEvent(new CustomEvent('mf:insights-opened'));
        return;
      }
    }

    if (Date.now() < deadline) window.setTimeout(ensureOpen, 90);
  };

  ensureOpen();
}

function storedRouteIsInsights(): boolean {
  try {
    const stored = sessionStorage.getItem('mf-simple-route');
    const route = stored ? JSON.parse(stored) as { primary?: string; sub?: string } : null;
    return route?.primary === 'analysis' && route?.sub === 'insights';
  } catch {
    return false;
  }
}

let activeFixedBillCount = 0;
let patchScheduled = false;
let todayEntries: Array<{
  amount: number;
  category?: string | null;
  description?: string | null;
  related_entity_type?: string | null;
}> = [];

function formatFixedBillCount(count: number) {
  return count === 1 ? '1 conta fixa' : `${count} contas fixas`;
}

function formatMoney(value: number) {
  return Number(value || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
  });
}

function todayEntryLabel(entry: (typeof todayEntries)[number]) {
  const category = normalize(entry.category);
  const description = normalize(entry.description);
  const relation = normalize(entry.related_entity_type);

  if (relation === 'fixed_bill' || category.includes('contas fixas') || description.startsWith('pagamento:')) return 'conta fixa';
  if (category.includes('parcel')) return 'parcela';
  if (category.includes('cartao') || description.includes('fatura')) return 'fatura';
  return entry.category?.trim() || 'outro gasto';
}

function patchTodayOutflowCard() {
  const card = Array.from(document.querySelectorAll<HTMLElement>('.mf-kpi-grid .mf-kpi')).find((item) => {
    const label = normalize(item.querySelector('span')?.textContent);
    return label === 'gasto hoje' || label === 'gastos hoje' || label === 'saidas hoje';
  });
  if (!card) return;

  const label = card.querySelector<HTMLElement>('span');
  if (label) label.textContent = 'Saídas hoje';

  let detail = card.querySelector<HTMLElement>('[data-mf-today-outflow-detail]');
  if (!detail) {
    detail = document.createElement('small');
    detail.dataset.mfTodayOutflowDetail = 'true';
    detail.style.display = 'block';
    detail.style.marginTop = '4px';
    detail.style.fontSize = '9px';
    detail.style.lineHeight = '1.3';
    detail.style.color = 'rgba(255,255,255,.42)';
    detail.style.fontWeight = '700';
    card.appendChild(detail);
  }

  if (!todayEntries.length) {
    detail.textContent = 'Nenhuma saída concluída hoje';
    card.title = 'Nenhuma saída concluída hoje.';
    return;
  }

  const strongText = card.querySelector<HTMLElement>('strong')?.textContent || '';
  const privacyActive = /[•*]{2,}/.test(strongText);
  const grouped = new Map<string, number>();
  todayEntries.forEach((entry) => {
    const key = todayEntryLabel(entry);
    grouped.set(key, (grouped.get(key) || 0) + Math.abs(Number(entry.amount || 0)));
  });

  const parts = Array.from(grouped.entries()).map(([name, amount]) =>
    privacyActive ? name : `${name} ${formatMoney(amount)}`,
  );
  detail.textContent = `${todayEntries.length} lançamento${todayEntries.length === 1 ? '' : 's'}: ${parts.join(' + ')}`;
  card.title = `Total das saídas concluídas hoje: ${parts.join(' + ')}.`;
}

function patchDisplayedCounts() {
  patchScheduled = false;

  document.querySelectorAll<HTMLElement>('.mf-bills-metric').forEach((metric) => {
    const label = normalize(metric.querySelector('span')?.textContent);
    if (label !== 'contas registradas') return;
    const value = metric.querySelector<HTMLElement>('strong');
    const expected = String(activeFixedBillCount);
    if (value && value.textContent !== expected) value.textContent = expected;
  });

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    const textNode = current as Text;
    const parent = textNode.parentElement;
    if (
      parent &&
      !parent.closest('script,style,textarea,input') &&
      /\b\d+\s+contas?\s+fixas?\b/i.test(textNode.data)
    ) {
      nodes.push(textNode);
    }
    current = walker.nextNode();
  }

  nodes.forEach((node) => {
    const next = node.data.replace(/\b\d+\s+contas?\s+fixas?\b/gi, formatFixedBillCount(activeFixedBillCount));
    if (next !== node.data) node.data = next;
  });

  patchTodayOutflowCard();
}

function schedulePatch() {
  if (patchScheduled) return;
  patchScheduled = true;
  window.requestAnimationFrame(patchDisplayedCounts);
}

function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

async function refreshDashboardGuards() {
  const { data: authData } = await supabase.auth.getUser();
  const userId = authData.user?.id;
  if (!userId) {
    activeFixedBillCount = 0;
    todayEntries = [];
    schedulePatch();
    return;
  }

  const [fixedResult, todayResult] = await Promise.all([
    supabase
      .from('mf_fixed_bills')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('active', true),
    supabase
      .from('mf_finance_ledger_entries')
      .select('amount,type,status,date,category,description,affects_balance,related_entity_type')
      .eq('user_id', userId)
      .eq('date', localDateKey()),
  ]);

  if (!fixedResult.error) activeFixedBillCount = Number(fixedResult.count || 0);

  if (!todayResult.error) {
    todayEntries = (todayResult.data || [])
      .filter((entry: any) => {
        const status = normalize(entry.status || 'paid');
        return normalize(entry.type) === 'expense' &&
          !['pending', 'duplicate', 'error'].includes(status) &&
          entry.affects_balance !== false;
      })
      .map((entry: any) => ({
        amount: Number(entry.amount || 0),
        category: entry.category,
        description: entry.description,
        related_entity_type: entry.related_entity_type,
      }));
  }

  schedulePatch();
}

function mountGuard() {
  const capture = (event: MouseEvent) => {
    const button = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>('button');
    if (!button) return;
    const isSimpleNavigationButton = Boolean(
      button.closest('#mf-simple-navigation-root') || button.closest('#mf-simple-navigation-app') || button.classList.contains('mf-simple-button'),
    );
    if (!isSimpleNavigationButton || !normalize(button.textContent).includes('insights')) return;

    window.setTimeout(openInsightsReliably, 0);
  };

  document.addEventListener('click', capture, true);
  window.addEventListener('mf:navigate-insights', openInsightsReliably as EventListener);

  const observer = new MutationObserver(schedulePatch);
  observer.observe(document.body, { subtree: true, childList: true, characterData: true });

  void refreshDashboardGuards();

  supabase.auth.getUser().then(({ data }) => {
    const userId = data.user?.id;
    if (!userId) return;

    supabase
      .channel(`dashboard-guard-${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'mf_fixed_bills', filter: `user_id=eq.${userId}` },
        refreshDashboardGuards,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'mf_finance_ledger_entries', filter: `user_id=eq.${userId}` },
        refreshDashboardGuards,
      )
      .subscribe();
  });

  window.addEventListener('mf:finance-data-changed', refreshDashboardGuards as EventListener);

  window.setInterval(() => {
    schedulePatch();
    if (storedRouteIsInsights()) {
      const insightsButton = findInsightsButton();
      if (!insightsButton?.classList.contains('active')) openInsightsReliably();
    }
  }, 700);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mountGuard, { once: true });
} else {
  mountGuard();
}

export {};
