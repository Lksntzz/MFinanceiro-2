import {
  Activity,
  AlertCircle,
  BarChart2,
  Briefcase,
  Calculator,
  FileDown,
  Lightbulb,
  Pencil,
  PieChart,
  Plus,
  RefreshCw,
  Target,
  Trash2,
  TrendingUp,
  Wallet,
  X,
} from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';

import { useApp } from '../context/AppContext';
import { formatCurrency } from '../lib/formatters';
import { supabase } from '../lib/supabase';
import {
  type FundamentalistAnalysis,
  getFundamentalistAnalysis,
  getInvestmentAdvice,
  type InvestmentAdvice,
} from '../services/investmentIntelligence';
import { syncInvestmentsWithMarket } from '../services/marketData';
import { ReportService } from '../services/reportService';
import type { Investment, UserSettings } from '../types';

interface InvestmentsProps {
  user: { id: string };
  settings: UserSettings | null;
  onRefresh: () => void;
}

type PortfolioTab = 'portfolio' | 'income' | 'planning';

type InvestmentForm = {
  name: string;
  type: Investment['type'];
  institution: string;
  amount: string;
  initial_amount: string;
  quantity: string;
  average_price: string;
  current_price: string;
  dividends_received: string;
  target_percentage: string;
  pl: string;
  roe: string;
  ebitda: string;
  liquid_debt: string;
  dividend_yield: string;
};

const EMPTY_FORM: InvestmentForm = {
  name: '',
  type: 'fixed_income',
  institution: '',
  amount: '',
  initial_amount: '',
  quantity: '1',
  average_price: '',
  current_price: '',
  dividends_received: '0',
  target_percentage: '0',
  pl: '',
  roe: '',
  ebitda: '',
  liquid_debt: '',
  dividend_yield: '',
};

const TYPE_LABELS: Record<Investment['type'], string> = {
  fixed_income: 'Renda fixa',
  variable_income: 'Renda variável',
  crypto: 'Criptoativos',
  other: 'Outros',
};

const SECTION_COPY: Record<
  PortfolioTab,
  { title: string; description: string }
> = {
  portfolio: {
    title: 'Carteira de investimentos',
    description: 'Patrimônio, alocação e ativos cadastrados em um só lugar.',
  },
  income: {
    title: 'Proventos',
    description: 'Acompanhe os valores acumulados informados em cada ativo.',
  },
  planning: {
    title: 'Planejamento de aportes',
    description:
      'Calcule uma margem de aporte usando sua situação financeira cadastrada.',
  },
};

function safeNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function normalizeInvestment(row: any): Investment {
  return {
    ...row,
    amount: safeNumber(row.amount),
    initial_amount: safeNumber(row.initial_amount),
    quantity: safeNumber(row.quantity || 1),
    average_price: safeNumber(row.average_price),
    current_price: safeNumber(row.current_price),
    dividends_received: safeNumber(row.dividends_received),
    target_percentage: safeNumber(row.target_percentage),
    pl: row.pl == null ? undefined : safeNumber(row.pl),
    roe: row.roe == null ? undefined : safeNumber(row.roe),
    ebitda: row.ebitda == null ? undefined : safeNumber(row.ebitda),
    liquid_debt:
      row.liquid_debt == null ? undefined : safeNumber(row.liquid_debt),
    dividend_yield:
      row.dividend_yield == null ? undefined : safeNumber(row.dividend_yield),
  };
}

function getActiveTab(search: string): PortfolioTab {
  const section = new URLSearchParams(search).get('section');
  if (section === 'income') return 'income';
  if (section === 'planning') return 'planning';
  return 'portfolio';
}

export default function Investments({
  user,
  settings,
  onRefresh,
}: InvestmentsProps) {
  const { isPrivate } = useApp();
  const location = useLocation();
  const navigate = useNavigate();
  const activeTab = getActiveTab(location.search);
  const sectionCopy = SECTION_COPY[activeTab];

  const [investments, setInvestments] = useState<Investment[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | Investment['type']>('all');
  const [page, setPage] = useState(1);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Investment | null>(null);
  const [form, setForm] = useState<InvestmentForm>(EMPTY_FORM);
  const [advice, setAdvice] = useState<InvestmentAdvice | null>(null);
  const [analysis, setAnalysis] = useState<{
    investment: Investment;
    result: FundamentalistAnalysis;
  } | null>(null);

  const pageSize = 6;

  useEffect(() => {
    document.body.classList.add('mf-investments-workspace');
    return () => document.body.classList.remove('mf-investments-workspace');
  }, []);

  async function fetchInvestments() {
    setLoading(true);
    setError(null);
    try {
      const { data, error: queryError } = await supabase
        .from('mf_investments')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (queryError) throw queryError;
      setInvestments((data || []).map(normalizeInvestment));
    } catch (fetchError: any) {
      console.error('Falha ao carregar investimentos:', fetchError);
      setError(fetchError?.message || 'Não foi possível carregar a carteira.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void fetchInvestments();
  }, [fetchInvestments]);

  const stats = useMemo(() => {
    const total = investments.reduce(
      (sum, item) => sum + safeNumber(item.amount),
      0,
    );
    const invested = investments.reduce(
      (sum, item) => sum + safeNumber(item.initial_amount || item.amount),
      0,
    );
    const dividends = investments.reduce(
      (sum, item) => sum + safeNumber(item.dividends_received),
      0,
    );
    const profit = total - invested;
    const returnPercent = invested > 0 ? (profit / invested) * 100 : 0;

    const byType = (Object.keys(TYPE_LABELS) as Investment['type'][]).map(
      (type) => {
        const amount = investments
          .filter((item) => item.type === type)
          .reduce((sum, item) => sum + safeNumber(item.amount), 0);
        return {
          type,
          label: TYPE_LABELS[type],
          amount,
          percentage: total > 0 ? (amount / total) * 100 : 0,
        };
      },
    );

    const targetTotal = investments.reduce(
      (sum, item) => sum + Math.max(0, safeNumber(item.target_percentage)),
      0,
    );

    return {
      total,
      invested,
      dividends,
      profit,
      returnPercent,
      byType,
      targetTotal,
    };
  }, [investments]);

  const filtered = useMemo(() => {
    if (filter === 'all') return investments;
    return investments.filter((item) => item.type === filter);
  }, [investments, filter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageItems = filtered.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => {
    setPage(1);
  }, []);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  function goToSection(section: PortfolioTab) {
    const search = section === 'portfolio' ? '' : `?section=${section}`;
    navigate({ pathname: '/app/planejamento/investimentos', search });
  }

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setShowModal(true);
  }

  function openEdit(investment: Investment) {
    setEditing(investment);
    setForm({
      name: investment.name || '',
      type: investment.type,
      institution: investment.institution || '',
      amount: String(investment.amount || ''),
      initial_amount: String(
        investment.initial_amount || investment.amount || '',
      ),
      quantity: String(investment.quantity || 1),
      average_price: String(investment.average_price || ''),
      current_price: String(investment.current_price || ''),
      dividends_received: String(investment.dividends_received || 0),
      target_percentage: String(investment.target_percentage || 0),
      pl: investment.pl == null ? '' : String(investment.pl),
      roe: investment.roe == null ? '' : String(investment.roe),
      ebitda: investment.ebitda == null ? '' : String(investment.ebitda),
      liquid_debt:
        investment.liquid_debt == null ? '' : String(investment.liquid_debt),
      dividend_yield:
        investment.dividend_yield == null
          ? ''
          : String(investment.dividend_yield),
    });
    setShowModal(true);
  }

  async function saveInvestment(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const quantity = Math.max(0, safeNumber(form.quantity));
      const currentPrice = Math.max(0, safeNumber(form.current_price));
      const enteredAmount = Math.max(0, safeNumber(form.amount));
      const calculatedAmount =
        quantity > 0 && currentPrice > 0
          ? quantity * currentPrice
          : enteredAmount;
      const initialAmount = Math.max(
        0,
        safeNumber(form.initial_amount || enteredAmount || calculatedAmount),
      );

      if (!form.name.trim())
        throw new Error('Informe o nome ou ticker do investimento.');
      if (calculatedAmount <= 0 && initialAmount <= 0) {
        throw new Error('Informe um valor atual ou um preço atual válido.');
      }

      const payload = {
        user_id: user.id,
        name: form.name.trim(),
        type: form.type,
        institution: form.institution.trim() || null,
        amount: Number(calculatedAmount.toFixed(2)),
        initial_amount: Number(initialAmount.toFixed(2)),
        quantity: quantity || 1,
        average_price: Math.max(0, safeNumber(form.average_price)),
        current_price: currentPrice,
        dividends_received: Math.max(0, safeNumber(form.dividends_received)),
        target_percentage: Math.min(
          100,
          Math.max(0, safeNumber(form.target_percentage)),
        ),
        category: 'Investimento',
        pl: form.pl === '' ? null : safeNumber(form.pl),
        roe: form.roe === '' ? null : safeNumber(form.roe),
        ebitda: form.ebitda === '' ? null : safeNumber(form.ebitda),
        liquid_debt:
          form.liquid_debt === '' ? null : safeNumber(form.liquid_debt),
        dividend_yield:
          form.dividend_yield === '' ? null : safeNumber(form.dividend_yield),
      };

      const result = editing
        ? await supabase
            .from('mf_investments')
            .update(payload)
            .eq('id', editing.id)
            .eq('user_id', user.id)
        : await supabase.from('mf_investments').insert(payload);

      if (result.error) throw result.error;

      setShowModal(false);
      setEditing(null);
      setForm(EMPTY_FORM);
      setMessage(
        editing ? 'Investimento atualizado.' : 'Investimento adicionado.',
      );
      await fetchInvestments();
      onRefresh();
    } catch (saveError: any) {
      console.error('Falha ao salvar investimento:', saveError);
      setError(saveError?.message || 'Não foi possível salvar o investimento.');
    } finally {
      setSaving(false);
    }
  }

  async function deleteInvestment(investment: Investment) {
    if (!window.confirm(`Excluir “${investment.name}” da carteira?`)) return;
    setError(null);
    const { error: deleteError } = await supabase
      .from('mf_investments')
      .delete()
      .eq('id', investment.id)
      .eq('user_id', user.id);

    if (deleteError) {
      setError(deleteError.message);
      return;
    }

    setMessage('Investimento excluído.');
    await fetchInvestments();
    onRefresh();
  }

  async function recalculatePortfolio() {
    if (syncing) return;
    setSyncing(true);
    setError(null);
    setMessage(null);
    try {
      const success = await syncInvestmentsWithMarket(user.id);
      if (!success) throw new Error('Não foi possível recalcular a carteira.');
      await fetchInvestments();
      onRefresh();
      setMessage(
        'Carteira recalculada usando somente os preços atuais informados por você.',
      );
    } catch (syncError: any) {
      setError(syncError?.message || 'Falha ao recalcular a carteira.');
    } finally {
      setSyncing(false);
    }
  }

  async function calculatePlanning() {
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const [goalsResult, budgetsResult, fixedResult] = await Promise.all([
        supabase
          .from('mf_financial_goals')
          .select('*')
          .eq('user_id', user.id)
          .eq('status', 'active'),
        supabase.from('mf_budgets').select('*').eq('user_id', user.id),
        supabase
          .from('mf_fixed_bills')
          .select('amount,status')
          .eq('user_id', user.id),
      ]);

      if (goalsResult.error) throw goalsResult.error;
      if (fixedResult.error) throw fixedResult.error;

      const fixedOutflow = (fixedResult.data || [])
        .filter((item: any) => String(item.status || 'pending') !== 'paid')
        .reduce(
          (sum: number, item: any) => sum + Math.abs(safeNumber(item.amount)),
          0,
        );

      const result = await getInvestmentAdvice(
        safeNumber(settings?.current_balance),
        fixedOutflow,
        stats.total,
        goalsResult.data || [],
        budgetsResult.error ? [] : budgetsResult.data || [],
      );

      setAdvice(result);
      goToSection('planning');
    } catch (planningError: any) {
      setError(
        planningError?.message || 'Não foi possível calcular o planejamento.',
      );
    } finally {
      setSaving(false);
    }
  }

  async function analyzeInvestment(investment: Investment) {
    const result = await getFundamentalistAnalysis(investment.name, {
      pl: investment.pl,
      roe: investment.roe,
      ebitda: investment.ebitda,
      liquid_debt: investment.liquid_debt,
      dy: investment.dividend_yield,
    });
    setAnalysis({ investment, result });
  }

  if (loading) {
    return (
      <div
        className="flex flex-1 items-center justify-center"
        role="status"
        aria-live="polite"
      >
        <div
          className="h-10 w-10 animate-spin rounded-full border-4 border-brand-primary border-t-transparent"
          aria-hidden="true"
        />
        <span className="sr-only">Carregando investimentos</span>
      </div>
    );
  }

  return (
    <div className="flex flex-1 min-h-0 flex-col gap-4 overflow-hidden animate-fade-in">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-white/5 pb-3">
        <div className="min-w-0">
          <div className="text-[9px] font-black uppercase tracking-[0.22em] text-brand-primary/70">
            Investimentos
          </div>
          <h2 className="mt-1 text-xl font-black">{sectionCopy.title}</h2>
          <p className="mt-1 text-xs text-white/40">
            {sectionCopy.description}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {activeTab === 'portfolio' && (
            <>
              <button
                type="button"
                onClick={() =>
                  ReportService.exportPortfolioToPDF(investments, stats.total)
                }
                disabled={investments.length === 0}
                className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold text-white/60 disabled:opacity-40"
              >
                <FileDown size={15} aria-hidden="true" /> Exportar PDF
              </button>
              <button
                type="button"
                onClick={recalculatePortfolio}
                disabled={syncing || investments.length === 0}
                className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold text-white/60 disabled:opacity-40"
                title="Recalcula valor atual usando quantidade × preço atual informado"
              >
                <RefreshCw
                  size={15}
                  className={syncing ? 'animate-spin' : ''}
                  aria-hidden="true"
                />
                Recalcular preços informados
              </button>
              <button
                type="button"
                onClick={openCreate}
                className="flex items-center gap-2 rounded-xl bg-brand-primary px-3 py-2 text-xs font-bold text-black"
              >
                <Plus size={15} aria-hidden="true" /> Novo investimento
              </button>
            </>
          )}

          {activeTab === 'planning' && (
            <button
              type="button"
              onClick={calculatePlanning}
              disabled={saving}
              className="flex items-center gap-2 rounded-xl bg-brand-primary px-3 py-2 text-xs font-bold text-black disabled:opacity-40"
            >
              <Calculator size={15} aria-hidden="true" />{' '}
              {saving ? 'Calculando...' : 'Calcular aporte'}
            </button>
          )}
        </div>
      </header>

      {error && (
        <div
          className="flex shrink-0 items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2 text-xs text-red-400"
          role="alert"
        >
          <AlertCircle size={15} aria-hidden="true" /> {error}
          <button
            type="button"
            onClick={() => setError(null)}
            className="ml-auto"
            aria-label="Fechar erro"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      )}
      {message && (
        <div
          className="shrink-0 rounded-xl border border-green-500/20 bg-green-500/10 px-4 py-2 text-xs text-green-400"
          role="status"
          aria-live="polite"
        >
          {message}
        </div>
      )}

      <div className="grid shrink-0 grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard
          label="Patrimônio"
          value={formatCurrency(stats.total, isPrivate)}
          icon={Wallet}
        />
        <SummaryCard
          label="Valor investido"
          value={formatCurrency(stats.invested, isPrivate)}
          icon={Briefcase}
        />
        <SummaryCard
          label="Resultado"
          value={formatCurrency(stats.profit, isPrivate)}
          detail={`${stats.returnPercent >= 0 ? '+' : ''}${stats.returnPercent.toFixed(2)}%`}
          icon={Activity}
          tone={stats.profit >= 0 ? 'positive' : 'negative'}
        />
        <SummaryCard
          label="Proventos informados"
          value={formatCurrency(stats.dividends, isPrivate)}
          icon={TrendingUp}
        />
      </div>

      {activeTab === 'portfolio' && (
        <div className="grid flex-1 min-h-0 grid-cols-1 gap-4 overflow-hidden lg:grid-cols-12">
          <section
            className="glass-card flex min-h-0 flex-col overflow-hidden !p-4 lg:col-span-8"
            aria-labelledby="investment-assets-title"
          >
            <div className="mb-3 flex shrink-0 items-center justify-between gap-3">
              <h3
                id="investment-assets-title"
                className="flex items-center gap-2 text-sm font-bold"
              >
                <Briefcase size={16} aria-hidden="true" /> Ativos cadastrados
              </h3>
              <select
                value={filter}
                onChange={(event) =>
                  setFilter(event.target.value as 'all' | Investment['type'])
                }
                className="rounded-lg border border-white/10 bg-[#121212] px-3 py-2 text-xs outline-none"
                aria-label="Filtrar investimentos por tipo"
              >
                <option value="all">Todos</option>
                {(Object.keys(TYPE_LABELS) as Investment['type'][]).map(
                  (type) => (
                    <option key={type} value={type}>
                      {TYPE_LABELS[type]}
                    </option>
                  ),
                )}
              </select>
            </div>

            {pageItems.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center text-white/30">
                <Briefcase size={32} aria-hidden="true" />
                <p className="text-xs">
                  Nenhum investimento cadastrado neste filtro.
                </p>
              </div>
            ) : (
              <div className="grid content-start grid-cols-1 gap-3 overflow-y-auto pr-1 md:grid-cols-2">
                {pageItems.map((investment) => {
                  const initial = safeNumber(
                    investment.initial_amount || investment.amount,
                  );
                  const result = safeNumber(investment.amount) - initial;
                  const resultPercent =
                    initial > 0 ? (result / initial) * 100 : 0;
                  const allocation =
                    stats.total > 0
                      ? (safeNumber(investment.amount) / stats.total) * 100
                      : 0;

                  return (
                    <article
                      key={investment.id}
                      className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h4 className="truncate font-bold">
                            {investment.name}
                          </h4>
                          <p className="text-[10px] uppercase tracking-widest text-white/30">
                            {TYPE_LABELS[investment.type]}
                            {investment.institution
                              ? ` • ${investment.institution}`
                              : ''}
                          </p>
                        </div>
                        <div className="flex gap-1">
                          <button
                            type="button"
                            onClick={() => analyzeInvestment(investment)}
                            className="p-1.5 text-white/30 hover:text-brand-secondary"
                            aria-label={`Analisar ${investment.name}`}
                            title="Análise local"
                          >
                            <BarChart2 size={14} aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            onClick={() => openEdit(investment)}
                            className="p-1.5 text-white/30 hover:text-white"
                            aria-label={`Editar ${investment.name}`}
                            title="Editar"
                          >
                            <Pencil size={14} aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteInvestment(investment)}
                            className="p-1.5 text-white/30 hover:text-red-400"
                            aria-label={`Excluir ${investment.name}`}
                            title="Excluir"
                          >
                            <Trash2 size={14} aria-hidden="true" />
                          </button>
                        </div>
                      </div>

                      <div className="mt-4 flex items-end justify-between gap-3">
                        <div>
                          <div className="text-[9px] uppercase text-white/30">
                            Valor atual
                          </div>
                          <div className="text-lg font-black">
                            {formatCurrency(investment.amount, isPrivate)}
                          </div>
                        </div>
                        <div
                          className={`text-right text-xs font-bold ${result >= 0 ? 'text-green-400' : 'text-red-400'}`}
                        >
                          {resultPercent >= 0 ? '+' : ''}
                          {resultPercent.toFixed(2)}%
                        </div>
                      </div>

                      <div
                        className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/5"
                        aria-hidden="true"
                      >
                        <div
                          className="h-full bg-brand-primary"
                          style={{ width: `${Math.min(100, allocation)}%` }}
                        />
                      </div>
                      <div className="mt-1 flex justify-between text-[9px] text-white/30">
                        <span>{allocation.toFixed(1)}% da carteira</span>
                        {safeNumber(investment.target_percentage) > 0 && (
                          <span>
                            Meta{' '}
                            {safeNumber(investment.target_percentage).toFixed(
                              1,
                            )}
                            %
                          </span>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}

            {totalPages > 1 && (
              <div className="mt-auto flex shrink-0 items-center justify-center gap-3 pt-3 text-xs">
                <button
                  type="button"
                  onClick={() => setPage((value) => Math.max(1, value - 1))}
                  disabled={page === 1}
                  className="rounded-lg bg-white/5 px-3 py-1.5 disabled:opacity-30"
                >
                  Anterior
                </button>
                <span className="text-white/40">
                  {page} de {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setPage((value) => Math.min(totalPages, value + 1))
                  }
                  disabled={page === totalPages}
                  className="rounded-lg bg-white/5 px-3 py-1.5 disabled:opacity-30"
                >
                  Próxima
                </button>
              </div>
            )}
          </section>

          <section
            className="glass-card flex min-h-0 flex-col gap-4 !p-4 lg:col-span-4"
            aria-labelledby="investment-allocation-title"
          >
            <h3
              id="investment-allocation-title"
              className="flex items-center gap-2 text-sm font-bold"
            >
              <PieChart size={16} aria-hidden="true" /> Distribuição da carteira
            </h3>
            <div className="space-y-4 overflow-y-auto pr-1">
              {stats.byType.map((item) => (
                <div key={item.type}>
                  <div className="flex justify-between gap-3 text-xs">
                    <span>{item.label}</span>
                    <strong>{item.percentage.toFixed(1)}%</strong>
                  </div>
                  <div
                    className="mt-1 h-2 overflow-hidden rounded-full bg-white/5"
                    aria-hidden="true"
                  >
                    <div
                      className="h-full bg-brand-secondary"
                      style={{ width: `${item.percentage}%` }}
                    />
                  </div>
                  <div className="mt-1 text-[9px] text-white/30">
                    {formatCurrency(item.amount, isPrivate)}
                  </div>
                </div>
              ))}
            </div>
            <div
              className={`mt-auto rounded-xl border p-3 text-[10px] ${stats.targetTotal > 100 ? 'border-orange-400/20 bg-orange-400/5 text-orange-200/70' : 'border-white/10 bg-white/[0.03] text-white/40'}`}
            >
              {stats.targetTotal > 100
                ? `A soma das metas de alocação é ${stats.targetTotal.toFixed(1)}%. Ajuste para no máximo 100%.`
                : 'Os valores são baseados no que foi cadastrado. Nenhuma cotação externa é inventada pelo sistema.'}
            </div>
          </section>
        </div>
      )}

      {activeTab === 'income' && (
        <div className="grid flex-1 min-h-0 grid-cols-1 gap-4 overflow-hidden lg:grid-cols-12">
          <section
            className="glass-card min-h-0 overflow-y-auto !p-4 lg:col-span-7"
            aria-labelledby="investment-income-title"
          >
            <h3
              id="investment-income-title"
              className="mb-4 flex items-center gap-2 text-sm font-bold"
            >
              <TrendingUp size={16} aria-hidden="true" /> Proventos por ativo
            </h3>
            <div className="grid gap-2">
              {investments
                .filter((item) => safeNumber(item.dividends_received) > 0)
                .map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-4 rounded-xl border border-white/5 bg-white/[0.03] px-4 py-3"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-bold">
                        {item.name}
                      </div>
                      <div className="text-[9px] uppercase text-white/30">
                        Acumulado informado
                      </div>
                    </div>
                    <strong className="shrink-0 text-green-400">
                      {formatCurrency(item.dividends_received || 0, isPrivate)}
                    </strong>
                  </div>
                ))}
              {investments.every(
                (item) => safeNumber(item.dividends_received) <= 0,
              ) && (
                <div className="flex h-40 items-center justify-center text-xs text-white/30">
                  Nenhum provento informado.
                </div>
              )}
            </div>
          </section>

          <section className="glass-card flex flex-col justify-center gap-3 !p-5 lg:col-span-5">
            <Target
              className="text-brand-primary"
              size={28}
              aria-hidden="true"
            />
            <h3 className="text-lg font-bold">
              Proventos sem estimativa artificial
            </h3>
            <p className="text-xs leading-relaxed text-white/50">
              Esta seção usa exatamente o valor acumulado informado em cada
              investimento. Para alterar um valor, abra a Carteira e edite o
              ativo correspondente.
            </p>
            <div className="text-2xl font-black text-green-400">
              {formatCurrency(stats.dividends, isPrivate)}
            </div>
            <button
              type="button"
              onClick={() => goToSection('portfolio')}
              className="mt-2 w-fit rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold text-white/60"
            >
              Ir para a carteira
            </button>
          </section>
        </div>
      )}

      {activeTab === 'planning' && (
        <div className="grid flex-1 min-h-0 grid-cols-1 gap-4 overflow-hidden lg:grid-cols-12">
          <section className="glass-card flex flex-col justify-center gap-4 !p-5 lg:col-span-7">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-brand-primary/15 p-3 text-brand-primary">
                <Lightbulb size={22} aria-hidden="true" />
              </div>
              <div>
                <h3 className="font-bold">Margem de aporte</h3>
                <p className="text-[10px] uppercase tracking-widest text-white/30">
                  Cálculo local, sem recomendação de ativo
                </p>
              </div>
            </div>

            {advice ? (
              <>
                <div className="rounded-2xl border border-brand-primary/20 bg-brand-primary/5 p-5">
                  <div className="text-[10px] font-bold uppercase text-white/40">
                    Valor sugerido pelo cálculo
                  </div>
                  <div className="mt-1 text-3xl font-black text-brand-primary">
                    {formatCurrency(advice.recommendedAmount, isPrivate)}
                  </div>
                  <div className="mt-2 text-sm font-bold">
                    {advice.strategy}
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-white/50">
                    {advice.reasoning}
                  </p>
                </div>
                <p className="text-[10px] text-white/30">
                  Ferramenta educacional de organização financeira. Não é
                  recomendação de compra ou venda de ativos.
                </p>
              </>
            ) : (
              <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center text-xs text-white/40">
                Use “Calcular aporte” para considerar saldo, contas pendentes,
                metas e orçamentos cadastrados.
              </div>
            )}
          </section>

          <section className="glass-card !p-5 lg:col-span-5">
            <h3 className="mb-4 text-sm font-bold">
              Checklist antes de investir
            </h3>
            <div className="space-y-3 text-xs text-white/50">
              <ChecklistItem
                done={safeNumber(settings?.current_balance) > 0}
                text="Saldo atual positivo"
              />
              <ChecklistItem
                done={stats.total > 0}
                text="Carteira cadastrada e mensurável"
              />
              <ChecklistItem
                done={stats.targetTotal > 0 && stats.targetTotal <= 100}
                text="Metas de alocação válidas"
              />
              <ChecklistItem
                done={
                  investments.some(
                    (item) => safeNumber(item.current_price) > 0,
                  ) || investments.length === 0
                }
                text="Preços atuais registrados quando necessários"
              />
            </div>
          </section>
        </div>
      )}

      {showModal && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          role="presentation"
        >
          <form
            onSubmit={saveInvestment}
            className="glass-card max-h-[90vh] w-full max-w-3xl overflow-y-auto no-scrollbar !p-6"
            role="dialog"
            aria-modal="true"
            aria-labelledby="investment-form-title"
          >
            <div className="mb-5 flex items-center justify-between gap-3">
              <div>
                <h2 id="investment-form-title" className="text-xl font-bold">
                  {editing ? 'Editar investimento' : 'Novo investimento'}
                </h2>
                <p className="text-xs text-white/40">
                  Use valores reais informados por você.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                aria-label="Fechar formulário"
              >
                <X size={20} aria-hidden="true" />
              </button>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label="Nome ou ticker">
                <input
                  required
                  value={form.name}
                  onChange={(event) =>
                    setForm({ ...form, name: event.target.value })
                  }
                />
              </Field>
              <Field label="Tipo">
                <select
                  value={form.type}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      type: event.target.value as Investment['type'],
                    })
                  }
                >
                  {(Object.keys(TYPE_LABELS) as Investment['type'][]).map(
                    (type) => (
                      <option key={type} value={type}>
                        {TYPE_LABELS[type]}
                      </option>
                    ),
                  )}
                </select>
              </Field>
              <Field label="Instituição">
                <input
                  value={form.institution}
                  onChange={(event) =>
                    setForm({ ...form, institution: event.target.value })
                  }
                />
              </Field>
              <Field label="Valor atual total">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.amount}
                  onChange={(event) =>
                    setForm({ ...form, amount: event.target.value })
                  }
                />
              </Field>
              <Field label="Valor inicialmente investido">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.initial_amount}
                  onChange={(event) =>
                    setForm({ ...form, initial_amount: event.target.value })
                  }
                />
              </Field>
              <Field label="Quantidade">
                <input
                  type="number"
                  min="0"
                  step="0.00000001"
                  value={form.quantity}
                  onChange={(event) =>
                    setForm({ ...form, quantity: event.target.value })
                  }
                />
              </Field>
              <Field label="Preço médio">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.average_price}
                  onChange={(event) =>
                    setForm({ ...form, average_price: event.target.value })
                  }
                />
              </Field>
              <Field label="Preço atual">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.current_price}
                  onChange={(event) =>
                    setForm({ ...form, current_price: event.target.value })
                  }
                />
              </Field>
              <Field label="Proventos acumulados">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.dividends_received}
                  onChange={(event) =>
                    setForm({ ...form, dividends_received: event.target.value })
                  }
                />
              </Field>
              <Field label="Meta na carteira (%)">
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={form.target_percentage}
                  onChange={(event) =>
                    setForm({ ...form, target_percentage: event.target.value })
                  }
                />
              </Field>
            </div>

            <details className="mt-5 rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <summary className="cursor-pointer text-xs font-bold">
                Indicadores opcionais para análise local
              </summary>
              <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-5">
                <Field label="P/L">
                  <input
                    type="number"
                    step="0.01"
                    value={form.pl}
                    onChange={(event) =>
                      setForm({ ...form, pl: event.target.value })
                    }
                  />
                </Field>
                <Field label="ROE (%)">
                  <input
                    type="number"
                    step="0.01"
                    value={form.roe}
                    onChange={(event) =>
                      setForm({ ...form, roe: event.target.value })
                    }
                  />
                </Field>
                <Field label="EBITDA">
                  <input
                    type="number"
                    step="0.01"
                    value={form.ebitda}
                    onChange={(event) =>
                      setForm({ ...form, ebitda: event.target.value })
                    }
                  />
                </Field>
                <Field label="Dívida líquida">
                  <input
                    type="number"
                    step="0.01"
                    value={form.liquid_debt}
                    onChange={(event) =>
                      setForm({ ...form, liquid_debt: event.target.value })
                    }
                  />
                </Field>
                <Field label="DY (%)">
                  <input
                    type="number"
                    step="0.01"
                    value={form.dividend_yield}
                    onChange={(event) =>
                      setForm({ ...form, dividend_yield: event.target.value })
                    }
                  />
                </Field>
              </div>
            </details>

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="rounded-xl bg-white/5 px-5 py-3 text-sm font-bold"
              >
                Cancelar
              </button>
              <button
                disabled={saving}
                className="rounded-xl bg-brand-primary px-5 py-3 text-sm font-bold text-black disabled:opacity-50"
              >
                {saving ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </form>
        </div>
      )}

      {analysis && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          role="presentation"
        >
          <div
            className="glass-card w-full max-w-lg !p-6"
            role="dialog"
            aria-modal="true"
            aria-labelledby="investment-analysis-title"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2
                  id="investment-analysis-title"
                  className="text-xl font-bold"
                >
                  Análise local: {analysis.investment.name}
                </h2>
                <p className="text-xs text-white/40">
                  Somente indicadores cadastrados.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAnalysis(null)}
                aria-label="Fechar análise"
              >
                <X size={20} aria-hidden="true" />
              </button>
            </div>
            <div className="mt-5 flex items-center gap-4">
              <div className="flex h-20 w-20 items-center justify-center rounded-full border-4 border-brand-primary/30 text-2xl font-black text-brand-primary">
                {analysis.result.score}
              </div>
              <div>
                <div className="text-sm font-bold">
                  Resultado: {analysis.result.verdict}
                </div>
                <p className="mt-1 text-xs text-white/40">
                  {analysis.result.analysisNote}
                </p>
              </div>
            </div>
            <div className="mt-5 grid grid-cols-1 gap-4 text-xs sm:grid-cols-2">
              <div>
                <h3 className="mb-2 font-bold text-green-400">
                  Pontos observados
                </h3>
                {analysis.result.pros.map((item) => (
                  <p key={item} className="mb-1 text-white/50">
                    • {item}
                  </p>
                ))}
              </div>
              <div>
                <h3 className="mb-2 font-bold text-orange-400">
                  Limitações e alertas
                </h3>
                {analysis.result.cons.map((item) => (
                  <p key={item} className="mb-1 text-white/50">
                    • {item}
                  </p>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  detail,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  detail?: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  tone?: 'positive' | 'negative';
}) {
  return (
    <div className="glass-card !p-4">
      <div className="flex items-center justify-between text-white/40">
        <span className="text-[9px] font-bold uppercase tracking-widest">
          {label}
        </span>
        <Icon size={15} aria-hidden="true" />
      </div>
      <div
        className={`mt-2 truncate text-lg font-black ${tone === 'positive' ? 'text-green-400' : tone === 'negative' ? 'text-red-400' : ''}`}
      >
        {value}
      </div>
      {detail && <div className="mt-1 text-[10px] text-white/40">{detail}</div>}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactElement<any>;
}) {
  return (
    <label className="block text-[10px] font-bold uppercase tracking-widest text-white/40">
      {label}
      {React.cloneElement(children, {
        className:
          'mt-1 w-full rounded-xl border border-white/10 bg-[#121212] px-3 py-2.5 text-sm text-white outline-none focus:border-brand-primary',
      })}
    </label>
  );
}

function ChecklistItem({ done, text }: { done: boolean; text: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.03] p-3">
      <div
        className={`h-3 w-3 rounded-full ${done ? 'bg-green-400' : 'bg-orange-400'}`}
        aria-hidden="true"
      />
      <span>{text}</span>
    </div>
  );
}
