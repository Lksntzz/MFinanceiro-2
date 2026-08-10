import React, { useMemo, useState } from 'react';
import { Activity, AlertCircle, CreditCard as CreditCardIcon, History as HistoryIcon, PieChart as PieChartIcon, TrendingUp } from 'lucide-react';
import { Line } from 'react-chartjs-2';
import { Chart as ChartJS, registerables } from 'chart.js';
import { addDays, format, isAfter, startOfDay, startOfMonth, startOfWeek, subDays } from 'date-fns';

import { formatCurrency } from '../lib/formatters';
import type { CreditCard, FinanceSummary, Transaction, UserSettings } from '../types';

ChartJS.register(...registerables);

function parseTransactionDate(rawDate: string): Date | null {
  const value = String(rawDate || '').trim();
  if (!value) return null;
  const dateOnly = value.match(/^(\d{4}-\d{2}-\d{2})/i)?.[1];
  const parsed = dateOnly ? new Date(`${dateOnly}T12:00:00`) : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function transactionDay(rawDate: string): string {
  const parsed = parseTransactionDate(rawDate);
  return parsed ? format(parsed, 'yyyy-MM-dd') : '';
}

export default function DashboardHome({
  transactions,
  recentTransactions,
  summary,
  settings,
  cards,
  balance,
  isPrivate,
}: {
  transactions: Transaction[];
  recentTransactions: Transaction[];
  summary: FinanceSummary | null;
  settings: UserSettings | null;
  cards: CreditCard[];
  balance: number;
  isPrivate: boolean;
}) {
  const [rhythmFilter, setRhythmFilter] = useState<'day' | 'week' | 'month'>('day');
  const dailyLimit = Number(summary?.dailyLimit || 0);
  const todaySpent = Number(summary?.todaySpent || 0);

  const topCategories = useMemo(() => {
    const totals: Record<string, number> = {};
    let total = 0;
    transactions.filter((transaction) => transaction.type === 'expense').forEach((transaction) => {
      const amount = Math.abs(Number(transaction.amount) || 0);
      totals[transaction.category || 'Geral'] = (totals[transaction.category || 'Geral'] || 0) + amount;
      total += amount;
    });
    return Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([name, amount]) => ({ name, amount, percentage: total > 0 ? (amount / total) * 100 : 0 }));
  }, [transactions]);

  const historicalWindow = useMemo(() => {
    const validDates = transactions.map((transaction) => parseTransactionDate(transaction.date)).filter((date): date is Date => Boolean(date)).sort((a, b) => a.getTime() - b.getTime());
    const now = startOfDay(new Date());
    const earliest = validDates[0];
    const latest = validDates[validDates.length - 1];
    const latestDay = latest ? startOfDay(latest) : now;
    const anchor = latest && now.getTime() - latestDay.getTime() > 7 * 86400000 ? latestDay : now;
    const candidate = earliest ? startOfDay(earliest) : subDays(anchor, 29);
    const start = isAfter(candidate, anchor) ? anchor : candidate;
    const keys: string[] = [];
    for (let day = start; !isAfter(day, anchor); day = addDays(day, 1)) keys.push(format(day, 'yyyy-MM-dd'));

    const dailyNet = new Map(keys.map((key) => [key, 0]));
    const incomes = new Map(keys.map((key) => [key, 0]));
    const expenses = new Map(keys.map((key) => [key, 0]));
    transactions.forEach((transaction) => {
      const key = transactionDay(transaction.date);
      if (!dailyNet.has(key)) return;
      const amount = Number(transaction.amount) || 0;
      dailyNet.set(key, (dailyNet.get(key) || 0) + amount);
      if (amount >= 0) incomes.set(key, (incomes.get(key) || 0) + amount);
      else expenses.set(key, (expenses.get(key) || 0) + Math.abs(amount));
    });

    const balances = new Array(keys.length).fill(0);
    let running = Number(settings?.current_balance ?? balance ?? 0);
    for (let index = keys.length - 1; index >= 0; index -= 1) {
      balances[index] = Number(running.toFixed(2));
      running -= dailyNet.get(keys[index]) || 0;
    }

    return {
      keys,
      labels: keys.map((key) => format(new Date(`${key}T12:00:00`), 'dd/MM')),
      balances,
      incomes: keys.map((key) => Number((incomes.get(key) || 0).toFixed(2))),
      expenses: keys.map((key) => Number((expenses.get(key) || 0).toFixed(2))),
    };
  }, [transactions, settings?.current_balance, balance]);

  const rhythm = useMemo(() => {
    if (rhythmFilter === 'day') return { labels: historicalWindow.labels, incomes: historicalWindow.incomes, expenses: historicalWindow.expenses };
    const buckets = new Map<string, { label: string; income: number; expense: number }>();
    historicalWindow.keys.forEach((key, index) => {
      const date = new Date(`${key}T12:00:00`);
      const bucketStart = rhythmFilter === 'week' ? startOfWeek(date, { weekStartsOn: 1 }) : startOfMonth(date);
      const bucketKey = format(bucketStart, 'yyyy-MM-dd');
      const current = buckets.get(bucketKey) || { label: format(bucketStart, 'dd/MM'), income: 0, expense: 0 };
      current.income += historicalWindow.incomes[index] || 0;
      current.expense += historicalWindow.expenses[index] || 0;
      buckets.set(bucketKey, current);
    });
    const rows = [...buckets.values()];
    return { labels: rows.map((row) => row.label), incomes: rows.map((row) => row.income), expenses: rows.map((row) => row.expense) };
  }, [historicalWindow, rhythmFilter]);

  const chartOptions: any = {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 300 },
    plugins: { legend: { display: false } },
    scales: {
      y: { grid: { color: 'rgba(255,255,255,.055)' }, ticks: { color: 'rgba(255,255,255,.35)', font: { size: 9 }, maxTicksLimit: 5 } },
      x: { grid: { display: false }, ticks: { color: 'rgba(255,255,255,.35)', font: { size: 9 }, maxTicksLimit: 12 } },
    },
  };

  const balanceChart = { labels: historicalWindow.labels, datasets: [{ label: 'Saldo', data: historicalWindow.balances, borderColor: '#00f2ff', backgroundColor: 'rgba(0,242,255,.08)', fill: true, tension: 0.35, pointRadius: 2, pointHoverRadius: 5, borderWidth: 2 }] };
  const rhythmChart = { labels: rhythm.labels, datasets: [{ label: 'Saídas', data: rhythm.expenses, borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,.06)', fill: true, tension: 0.35, pointRadius: 0, borderWidth: 2 }, { label: 'Entradas', data: rhythm.incomes, borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,.06)', fill: true, tension: 0.35, pointRadius: 0, borderWidth: 2 }] };

  const cardUsed = cards.reduce((sum, card) => sum + Number(card.used || 0), 0);
  const cardLimit = cards.reduce((sum, card) => sum + Number(card.limit || 0), 0);
  const cardAvailable = cardLimit - cardUsed;
  const cardUsage = cardLimit > 0 ? Math.min(100, (cardUsed / cardLimit) * 100) : 0;

  return (
    <main className="mf-dashboard-grid">
      <section className="mf-kpi-grid">
        <article className={`mf-card mf-kpi ${balance < 0 ? 'danger' : ''}`}><span>Saldo atual</span><strong>{formatCurrency(balance, isPrivate)}</strong></article>
        <article className="mf-card mf-kpi accent"><span>Limite diário</span><strong>{formatCurrency(dailyLimit, isPrivate)}</strong></article>
        <article className="mf-card mf-kpi"><span>Ciclo atual</span><strong>{summary?.cyclePeriodLabel || '--'} <small>({summary?.daysRemaining || 0}d)</small></strong></article>
        <article className="mf-card mf-kpi"><span>Gasto hoje</span><strong className={todaySpent > dailyLimit && dailyLimit > 0 ? 'negative' : ''}>{formatCurrency(todaySpent, isPrivate)}</strong></article>
      </section>

      <section className="mf-alert-grid">
        <article className={`mf-card mf-alert ${balance < 0 ? 'danger' : ''}`}><AlertCircle size={18} /><div><strong>Status do ciclo</strong><p>{summary?.smartAlert?.message || 'Acompanhe seu saldo e seus compromissos.'}</p></div></article>
        <article className="mf-card mf-alert insight"><TrendingUp size={18} /><div><strong>Leitura financeira</strong><p>{summary?.dailyInsight || summary?.insights?.[0] || 'Mantenha seus registros atualizados para melhorar as recomendações.'}</p></div></article>
      </section>

      <article className="mf-card mf-chart-card"><h3><Activity size={16} />Evolução do saldo</h3><div className="mf-chart"><Line data={balanceChart} options={chartOptions} /></div></article>
      <article className="mf-card mf-chart-card">
        <div className="mf-chart-heading"><h3><HistoryIcon size={16} />Ritmo de gastos</h3><div className="mf-segmented">{(['day', 'week', 'month'] as const).map((filter) => <button key={filter} className={rhythmFilter === filter ? 'active' : ''} onClick={() => setRhythmFilter(filter)}>{filter === 'day' ? 'Dia' : filter === 'week' ? 'Semana' : 'Mês'}</button>)}</div></div>
        <div className="mf-chart"><Line data={rhythmChart} options={chartOptions} /></div>
      </article>

      <section className="mf-bottom-grid">
        <article className="mf-card mf-mini-card"><h3><PieChartIcon size={16} />Categorias principais</h3><div className="mf-category-list">{topCategories.length ? topCategories.map((category) => <div key={category.name} className="mf-category-item"><div><span>{category.name}</span><strong>R$ {category.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong></div><div className="mf-progress"><i style={{ width: `${category.percentage}%` }} /></div></div>) : <p className="mf-empty">Sem despesas cadastradas.</p>}</div></article>
        <article className="mf-card mf-mini-card"><h3><HistoryIcon size={16} />Últimos lançamentos</h3><div className="mf-latest-list">{recentTransactions.length ? recentTransactions.slice(0, 4).map((transaction) => <div key={transaction.id}><span><strong>{transaction.description || transaction.category}</strong><small>{format(new Date(transaction.date), 'dd/MM/yyyy')}</small></span><b className={transaction.type === 'income' ? 'positive' : 'negative'}>{transaction.type === 'income' ? '+' : '-'} R$ {Math.abs(Number(transaction.amount) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</b></div>) : <p className="mf-empty">Nenhum lançamento.</p>}</div></article>
        <article className="mf-card mf-mini-card mf-card-usage"><h3><CreditCardIcon size={16} />Uso de cartões</h3><div className="mf-usage-row"><span>Utilizado</span><strong>R$ {cardUsed.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong></div><div className="mf-progress large"><i style={{ width: `${cardUsage}%` }} /></div><div className="mf-usage-footer"><span>Restante disponível</span><strong>R$ {cardAvailable.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong></div></article>
      </section>
    </main>
  );
}
