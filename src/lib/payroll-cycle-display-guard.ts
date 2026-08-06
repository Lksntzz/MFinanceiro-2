import { supabase } from './supabase';

declare global {
  interface Window {
    __mfPayrollCycleDisplayGuardInstalled?: boolean;
  }
}

type CycleSnapshot = {
  base: number;
  firstDay: number;
  secondDay: number | null;
  firstPercentage: number;
  secondPercentage: number;
  firstAmount: number;
  secondAmount: number;
};

const currency = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const decimal = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function roundMoney(value: number): number {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function numberValue(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function leafElements(root: ParentNode, selector = 'div,span,p,strong,small,h1,h2,h3,h4'): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(selector)).filter((element) => element.children.length === 0);
}

function replaceLeafText(element: HTMLElement, nextText: string): void {
  if (element.textContent !== nextText) element.textContent = nextText;
}

function findCurrencyLeaf(root: ParentNode): HTMLElement | null {
  return leafElements(root).find((element) => /^R\$\s*[\d.]+,\d{2,3}$/.test((element.textContent || '').trim())) || null;
}

function applyDashboardInsight(snapshot: CycleSnapshot): void {
  leafElements(document, 'p,div,span').forEach((element) => {
    const text = (element.textContent || '').trim();
    const match = text.match(/^Previsão de recebimento no dia\s+(\d{1,2}):\s+R\$\s*[\d.,]+\s+\(([\d.,]+)% do salário\)\.?$/i);
    if (!match) return;

    const day = Number(match[1]);
    const isFirst = day === snapshot.firstDay;
    const isSecond = snapshot.secondDay !== null && day === snapshot.secondDay;
    if (!isFirst && !isSecond) return;

    const amount = isFirst ? snapshot.firstAmount : snapshot.secondAmount;
    const percentage = isFirst ? snapshot.firstPercentage : snapshot.secondPercentage;
    replaceLeafText(
      element,
      `Previsão de recebimento no dia ${day}: R$ ${decimal.format(amount)} (${decimal.format(percentage)}% da base líquida).`,
    );
  });
}

function applyIncomePayrollScreen(snapshot: CycleSnapshot): void {
  const root = document.getElementById('mf-preferences-center-root');
  if (!root) return;

  leafElements(root).forEach((element) => {
    const text = (element.textContent || '').trim();

    if (text === 'Salário líquido') {
      replaceLeafText(element, 'Base líquida do ciclo');
      const card = element.closest<HTMLElement>('.rounded-2xl') || element.parentElement;
      const amountElement = card ? findCurrencyLeaf(card) : null;
      if (amountElement) replaceLeafText(amountElement, currency.format(snapshot.base));
      return;
    }

    if (text === 'Defina como o salário líquido chega durante o mês.') {
      replaceLeafText(element, 'A base considera salário bruto menos INSS e IRRF. O segundo pagamento recebe o restante exato.');
      return;
    }

    const paymentMatch = text.match(/^Pagamento dia\s+(\d{1,2})$/i);
    if (!paymentMatch) return;

    const day = Number(paymentMatch[1]);
    const card = element.closest<HTMLElement>('.rounded-2xl');
    if (!card) return;

    const amountElement = findCurrencyLeaf(card);
    if (!amountElement) return;

    if (day === snapshot.firstDay) {
      replaceLeafText(amountElement, currency.format(snapshot.firstAmount));
    } else if (snapshot.secondDay !== null && day === snapshot.secondDay) {
      replaceLeafText(amountElement, currency.format(snapshot.secondAmount));
    }
  });

  const heading = leafElements(root, 'h1,h2,h3,h4').find(
    (element) => (element.textContent || '').trim() === 'Distribuição do recebimento',
  );
  const section = heading?.closest<HTMLElement>('section');
  if (section && !section.querySelector('#mf-cycle-rule-note')) {
    const note = document.createElement('div');
    note.id = 'mf-cycle-rule-note';
    note.className = 'mb-3 rounded-xl border border-brand-primary/20 bg-brand-primary/5 px-3 py-2 text-[10px] text-white/55';
    note.textContent = `Base líquida: ${currency.format(snapshot.base)}. Dia ${snapshot.firstDay}: ${currency.format(snapshot.firstAmount)} (${decimal.format(snapshot.firstPercentage)}%).${snapshot.secondDay !== null ? ` Dia ${snapshot.secondDay}: ${currency.format(snapshot.secondAmount)} (${decimal.format(snapshot.secondPercentage)}%).` : ''}`;
    const headingRow = heading?.parentElement?.parentElement || heading?.parentElement;
    if (headingRow?.parentElement === section) headingRow.insertAdjacentElement('afterend', note);
    else section.prepend(note);
  }
}

function applySnapshot(snapshot: CycleSnapshot | null): void {
  if (!snapshot) return;
  applyDashboardInsight(snapshot);
  applyIncomePayrollScreen(snapshot);
}

if (typeof window !== 'undefined' && !window.__mfPayrollCycleDisplayGuardInstalled) {
  window.__mfPayrollCycleDisplayGuardInstalled = true;

  let snapshot: CycleSnapshot | null = null;
  let scheduled = false;
  let channel: ReturnType<typeof supabase.channel> | null = null;

  const scheduleApply = () => {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(() => {
      scheduled = false;
      applySnapshot(snapshot);
    });
  };

  const refresh = async () => {
    const { data: authData } = await supabase.auth.getUser();
    const userId = authData.user?.id;
    if (!userId) {
      snapshot = null;
      return;
    }

    const [settingsResult, payrollResult] = await Promise.all([
      supabase
        .from('mf_user_settings')
        .select('gross_salary,net_salary_estimated,payday_cycle,payday_1,payday_2,payday_1_percentage,payday_2_percentage')
        .eq('user_id', userId)
        .maybeSingle(),
      supabase
        .from('mf_payroll_statements')
        .select('gross_salary,inss_amount,irrf_amount,competence')
        .eq('user_id', userId)
        .order('competence', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const settings = settingsResult.data;
    if (!settings) return;

    const payroll = payrollResult.data;
    const gross = numberValue(payroll?.gross_salary, numberValue(settings.gross_salary));
    const inss = numberValue(payroll?.inss_amount);
    const irrf = numberValue(payroll?.irrf_amount);
    const calculatedBase = roundMoney(Math.max(0, gross - inss - irrf));
    const storedBase = roundMoney(numberValue(settings.net_salary_estimated));
    const base = calculatedBase > 0 ? calculatedBase : storedBase;

    const isBiweekly = settings.payday_cycle === 'biweekly';
    const firstPercentage = isBiweekly ? numberValue(settings.payday_1_percentage, 50) : 100;
    const secondPercentage = isBiweekly ? numberValue(settings.payday_2_percentage, 50) : 0;
    const firstAmount = roundMoney(base * firstPercentage / 100);
    const secondAmount = isBiweekly ? roundMoney(base - firstAmount) : 0;

    snapshot = {
      base,
      firstDay: numberValue(settings.payday_1, 5),
      secondDay: isBiweekly ? numberValue(settings.payday_2, 20) : null,
      firstPercentage,
      secondPercentage,
      firstAmount,
      secondAmount,
    };
    scheduleApply();

    if (!channel) {
      channel = supabase
        .channel(`payroll-cycle-display-${userId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'mf_user_settings', filter: `user_id=eq.${userId}` }, refresh)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'mf_payroll_statements', filter: `user_id=eq.${userId}` }, refresh)
        .subscribe();
    }
  };

  const observer = new MutationObserver(scheduleApply);
  const startObserver = () => {
    if (document.body) observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startObserver, { once: true });
  } else {
    startObserver();
  }

  void refresh();
  supabase.auth.onAuthStateChange(() => {
    if (channel) {
      supabase.removeChannel(channel);
      channel = null;
    }
    void refresh();
  });
}

export {};
