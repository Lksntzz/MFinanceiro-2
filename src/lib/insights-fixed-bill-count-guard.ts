import { supabase } from './supabase';

const normalize = (value?: string | null) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

function findLegacyTopButton(labels: string[]): HTMLButtonElement | null {
  const wanted = labels.map(normalize);
  return (
    Array.from(document.querySelectorAll<HTMLButtonElement>('.mf-nav > button')).find((button) => {
      if (button.closest('#mf-hierarchy-nav-host') || button.closest('#mf-simple-navigation-root')) return false;
      const label = normalize(button.textContent);
      return wanted.some((item) => label === item || label.includes(item));
    }) || null
  );
}

function findContentButton(labels: string[]): HTMLButtonElement | null {
  const wanted = labels.map(normalize);
  return (
    Array.from(document.querySelectorAll<HTMLButtonElement>('.mf-content button')).find((button) => {
      if (button.closest('#mf-simple-navigation-root')) return false;
      const label = normalize(button.textContent);
      return wanted.some((item) => label === item || label.includes(item));
    }) || null
  );
}

function retryUntil(action: () => boolean, attempts = 30, interval = 100) {
  let remaining = attempts;
  const run = () => {
    if (action()) return;
    remaining -= 1;
    if (remaining > 0) window.setTimeout(run, interval);
  };
  run();
}

function openInsightsReliably() {
  sessionStorage.setItem('mf-simple-route', JSON.stringify({ primary: 'analysis', sub: 'insights' }));

  const analysisButton = findLegacyTopButton(['Análises']);
  if (analysisButton) analysisButton.click();

  retryUntil(() => {
    const insightsButton = findContentButton(['Insights AI']);
    if (!insightsButton) return false;
    insightsButton.click();
    return true;
  });
}

let activeFixedBillCount = 0;
let patchScheduled = false;

function formatFixedBillCount(count: number) {
  return count === 1 ? '1 conta fixa' : `${count} contas fixas`;
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
}

function scheduleCountPatch() {
  if (patchScheduled) return;
  patchScheduled = true;
  window.requestAnimationFrame(patchDisplayedCounts);
}

async function refreshFixedBillCount() {
  const { data: authData } = await supabase.auth.getUser();
  const userId = authData.user?.id;
  if (!userId) {
    activeFixedBillCount = 0;
    scheduleCountPatch();
    return;
  }

  const { count, error } = await supabase
    .from('mf_fixed_bills')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('active', true);

  if (!error) {
    activeFixedBillCount = Number(count || 0);
    scheduleCountPatch();
  }
}

function mountGuard() {
  const capture = (event: MouseEvent) => {
    const button = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>('button');
    if (!button || !button.closest('#mf-simple-navigation-root')) return;
    if (normalize(button.textContent) !== 'insights') return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    openInsightsReliably();
  };

  document.addEventListener('click', capture, true);

  const observer = new MutationObserver(scheduleCountPatch);
  observer.observe(document.body, { subtree: true, childList: true, characterData: true });

  void refreshFixedBillCount();

  supabase.auth.getUser().then(({ data }) => {
    const userId = data.user?.id;
    if (!userId) return;

    supabase
      .channel(`fixed-bill-count-guard-${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'mf_fixed_bills', filter: `user_id=eq.${userId}` },
        refreshFixedBillCount,
      )
      .subscribe();
  });

  window.addEventListener('mf:finance-data-changed', refreshFixedBillCount as EventListener);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mountGuard, { once: true });
} else {
  mountGuard();
}

export {};
