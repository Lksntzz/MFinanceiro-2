import React, { useEffect, useMemo, useState } from 'react';
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
  Sparkles,
  Target,
  Trash2,
  TrendingUp,
  Wallet,
  X,
} from 'lucide-react';

import { useApp } from '../context/AppContext';
import { formatCurrency } from '../lib/formatters';
import { supabase } from '../lib/supabase';
import { ReportService } from '../services/reportService';
import {
  FundamentalistAnalysis,
  getFundamentalistAnalysis,
  getInvestmentAdvice,
  InvestmentAdvice,
} from '../services/investmentIntelligence';
import { syncInvestmentsWithMarket } from '../services/marketData';
import { Investment, UserSettings } from '../types';

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
    liquid_debt: row.liquid_debt == null ? undefined : safeNumber(row.liquid_debt),
    dividend_yield: row.dividend_yield == null ? undefined : safeNumber(row.dividend_yield),
  };
}

export default function Investments({ user, settings, onRefresh }: InvestmentsProps) {
  const { isPrivate } = useApp();
  const [investments, setInvestments] = useState<Investment[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<PortfolioTab>('portfolio');
  const [filter, setFilter] = useState<'all' | Investment['type']>('all');
  const [page, setPage] = useState(1);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Investment | null>(null);
  const [form, setForm] = useState<InvestmentForm>(EMPTY_FORM);
  const [advice, setAdvice] = useState<InvestmentAdvice | null>(null);
  const [analysis, setAnalysis] = useState<{ investment: Investment; result: FundamentalistAnalysis } | null>(null);

  const pageSize = 6;

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
  }, [user.id]);

  const stats = useMemo(() => {
    const total = investments.reduce((sum, item) => sum + safeNumber(item.amount), 0);
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

    const byType = (Object.keys(TYPE_LABELS) as Investment['type'][]).map((type) => {
      const amount = investments
        .filter((item) => item.type === type)
        .reduce((sum, item) => sum + safeNumber(item.amount), 0);
      return {
        type,
        label: TYPE_LABELS[type],
        amount,
        percentage: total > 0 ? (amount / total) * 100 : 0,
      };
    });

    const targetTotal = investments.reduce(
      (sum, item) => sum + Math.max(0, safeNumber(item.target_percentage)),
      0,
    );

    return { total, invested, dividends, profit, returnPercent, byType, targetTotal };
  }, [investments]);

  const filtered = useMemo(() => {
    if (filter === 'all') return investments;
    return investments.filter((item) => item.type === filter);
  }, [investments, filter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageItems = filtered.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => {
    setPage(1);
  }, [filter]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

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
      initial_amount: String(investment.initial_amount || investment.amount || ''),
      quantity: String(investment.quantity || 1),
      average_price: String(investment.average_price || ''),
      current_price: String(investment.current_price || ''),
      dividends_received: String(investment.dividends_received || 0),
      target_percentage: String(investment.target_percentage || 0),
      pl: investment.pl == null ? '' : String(investment.pl),
      roe: investment.roe == null ? '' : String(investment.roe),
      ebitda: investment.ebitda == null ? '' : String(investment.ebitda),
      liquid_debt: investment.liquid_debt == null ? '' : String(investment.liquid_debt),
      dividend_yield: investment.dividend_yield == null ? '' : String(investment.dividend_yield),
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
      const calculatedAmount = quantity > 0 && currentPrice > 0 ? quantity * currentPrice : enteredAmount;
      const initialAmount = Math.max(0, safeNumber(form.initial_amount || enteredAmount || calculatedAmount));

      if (!form.name.trim()) throw new Error('Informe o nome ou ticker do investimento.');
      if (calculatedAmount <= 0 && initialAmount <= 0) throw new Error('Informe um valor atual ou um preço atual válido.');

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
        target_percentage: Math.min(100, Math.max(0, safeNumber(form.target_percentage))),
        category: 'Investimento',
        pl: form.pl === '' ? null : safeNumber(form.pl),
        roe: form.roe === '' ? null : safeNumber(form.roe),
        ebitda: form.ebitda === '' ? null : safeNumber(form.ebitda),
        liquid_debt: form.liquid_debt === '' ? null : safeNumber(form.liquid_debt),
        dividend_yield: form.dividend_yield === '' ? null : safeNumber(form.dividend_yield),
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
      setMessage(editing ? 'Investimento atualizado.' : 'Investimento adicionado.');
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
      setMessage('Carteira recalculada com quantidade e preço atual informados.');
    } catch (syncError: any) {
      setError(syncError?.message || 'Falha ao recalcular a carteira.');
    } finally {
      setSyncing(false);
    }
  }

  async function calculatePlanning() {
    setSaving(true);
    setError(null);
    try {
      const [goalsResult, budgetsResult, fixedResult] = await Promise.all([
        supabase.from('mf_financial_goals').select('*').eq('user_id', user.id).eq('status', 'active'),
        supabase.from('mf_budgets').select('*').eq('user_id', user.id),
        supabase.from('mf_fixed_bills').select('amount,status').eq('user_id', user.id),
      ]);

      if (goalsResult.error) throw goalsResult.error;
      if (budgetsResult.error) throw budgetsResult.error;
      if (fixedResult.error) throw fixedResult.error;

      const fixedOutflow = (fixedResult.data || [])
        .filter((item: any) => String(item.status || 'pending') !== 'paid')
        .reduce((sum: number, item: any) => sum + Math.abs(safeNumber(item.amount)), 0);

      const result = await getInvestmentAdvice(
        safeNumber(settings?.current_balance),
        fixedOutflow,
        stats.total,
        goalsResult.data || [],
        budgetsResult.data || [],
      );
      setAdvice(result);
      setActiveTab('planning');
    } catch (planningError: any) {
      setError(planningError?.message || 'Não foi possível calcular o planejamento.');
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
      <div className="flex-1 flex items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-brand-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-4 animate-fade-in overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 shrink-0 border-b border-white/5 pb-3">
        <div className="flex items-center gap-2">
          {([
            ['portfolio', 'Carteira', PieChart],
            ['income', 'Proventos', TrendingUp],
            ['planning', 'Planejamento', Sparkles],
          ] as const).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold ${activeTab === id ? 'bg-brand-primary text-black' : 'bg-white/5 text-white/50 hover:text-white'}`}
            >
              <Icon size={15} /> {label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => ReportService.exportPortfolioToPDF(investments, stats.total)}
            disabled={investments.length === 0}
            className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold text-white/60 disabled:opacity-40"
          >
            <FileDown size={15} /> PDF
          </button>
          <button
            type="button"
            onClick={recalculatePortfolio}
            disabled={syncing || investments.length === 0}
            className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold text-white/60 disabled:opacity-40"
            title="Recalcula valor atual usando quantidade × preço atual informado"
          >
            <RefreshCw size={15} className={syncing ? 'animate-spin' : ''} /> Recalcular
          </button>
          <button
            type="button"
            onClick={calculatePlanning}
            disabled={saving}
            className="flex items-center gap-2 rounded-xl border border-brand-secondary/20 bg-brand-secondary/10 px-3 py-2 text-xs font-bold text-brand-secondary disabled:opacity-40"
          >
            <Calculator size={15} /> Calcular aporte
          </button>
          <button
            type="button"
            onClick={openCreate}
            className="flex items-center gap-2 rounded-xl bg-brand-primary px-3 py-2 text-xs font-bold text-black"
          >
            <Plus size={15} /> Novo investimento
          </button>
        </div>
      </div>

      {error && (
        <div className="shrink-0 flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2 text-xs text-red-400">
          <AlertCircle size={15} /> {error}
          <button type="button" onClick={() => setError(null)} className="ml-auto"><X size={14} /></button>
        </div>
      )}
      {message && (
        <div className="shrink-0 rounded-xl border border-green-500/20 bg-green-500/10 px-4 py-2 text-xs text-green-400">
          {message}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 shrink-0">
        <SummaryCard label="Patrimônio" value={formatCurrency(stats.total, isPrivate)} icon={Wallet} />
        <SummaryCard label="Valor investido" value={formatCurrency(stats.invested, isPrivate)} icon={Briefcase} />
        <SummaryCard
          label="Resultado"
          value={formatCurrency(stats.profit, isPrivate)}
          detail={`${stats.returnPercent >= 0 ? '+' : ''}${stats.returnPercent.toFixed(2)}%`}
          icon={Activity}
          tone={stats.profit >= 0 ? 'positive' : 'negative'}
        />
        <SummaryCard label="Proventos informados" value={formatCurrency(stats.dividends, isPrivate)} icon={TrendingUp} />
      </div>

      {activeTab === 'portfolio' && (
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-4 overflow-hidden">
          <section className="lg:col-span-8 glass-card !p-4 flex flex-col min-h-0 overflow-hidden">
            <div className="flex items-center justify-between gap-3 mb-3 shrink-0">
              <h3 className="font-bold text-sm flex items-center gap-2"><Briefcase size={16} /> Ativos cadastrados</h3>
              <select
                value={filter}
                onChange={(event) => setFilter(event.target.value as any)}
                className="rounded-lg border border-white/10 bg-[#121212] px-3 py-2 text-xs outline-none"
              >
                <option value="all">Todos</option>
                {(Object.keys(TYPE_LABELS) as Investment['type'][]).map((type) => (
                  <option key={type} value={type}>{TYPE_LABELS[type]}</option>
                ))}
              </select>
            </div>

            {pageItems.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center text-white/30">
                <Briefcase size={32} />
                <p className="text-xs">Nenhum investimento cadastrado neste filtro.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 content-start">
                {pageItems.map((investment) => {
                  const initial = safeNumber(investment.initial_amount || investment.amount);
                  const result = safeNumber(investment.amount) - initial;
                  const resultPercent = initial > 0 ? (result / initial) * 100 : 0;
                  const allocation = stats.total > 0 ? (safeNumber(investment.amount) / stats.total) * 100 : 0;

                  return (
                    <article key={investment.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h4 className="truncate font-bold">{investment.name}</h4>
                          <p className="text-[10px] uppercase tracking-widest text-white/30">
                            {TYPE_LABELS[investment.type]}{investment.institution ? ` • ${investment.institution}` : ''}
                          </p>
                        </div>
                        <div className="flex gap-1">
                          <button type="button" onClick={() => analyzeInvestment(investment)} className="p-1.5 text-white/30 hover:text-brand-secondary" title="Análise local"><BarChart2 size={14} /></button>
                          <button type="button" onClick={() => openEdit(investment)} className="p-1.5 text-white/30 hover:text-white" title="Editar"><Pencil size={14} /></button>
                          <button type="button" onClick={() => deleteInvestment(investment)} className="p-1.5 text-white/30 hover:text-red-400" title="Excluir"><Trash2 size={14} /></button>
                        </div>
                      </div>

                      <div className="mt-4 flex items-end justify-between">
                        <div>
                          <div className="text-[9px] uppercase text-white/30">Valor atual</div>
                          <div className="text-lg font-black">{formatCurrency(investment.amount, isPrivate)}</div>
                        </div>
                        <div className={`text-right text-xs font-bold ${result >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {resultPercent >= 0 ? '+' : ''}{resultPercent.toFixed(2)}%
                        </div>
                      </div>

                      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/5">
                        <div className="h-full bg-brand-primary" style={{ width: `${Math.min(100, allocation)}%` }} />
                      </div>
                      <div className="mt-1 flex justify-between text-[9px] text-white/30">
                        <span>{allocation.toFixed(1)}% da carteira</span>
                        {safeNumber(investment.target_percentage) > 0 && <span>Meta {safeNumber(investment.target_percentage).toFixed(1)}%</span>}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}

            {totalPages > 1 && (
              <div className="mt-auto pt-3 flex items-center justify-center gap-3 text-xs shrink-0">
                <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page === 1} className="rounded-lg bg-white/5 px-3 py-1.5 disabled:opacity-30">Anterior</button>
                <span className="text-white/40">{page} de {totalPages}</span>
                <button type="button" onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={page === totalPages} className="rounded-lg bg-white/5 px-3 py-1.5 disabled:opacity-30">Próxima</button>
              </div>
            )}
          </section>

          <section className="lg:col-span-4 glass-card !p-4 flex flex-col gap-4 min-h-0">
            <h3 className="font-bold text-sm flex items-center gap-2"><PieChart size={16} /> Distribuição real</h3>
            <div className="space-y-4">
              {stats.byType.map((item) => (
                <div key={item.type}>
                  <div className="flex justify-between gap-3 text-xs">
                    <span>{item.label}</span>
                    <strong>{item.percentage.toFixed(1)}%</strong>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-white/5">
                    <div className="h-full bg-brand-secondary" style={{ width: `${item.percentage}%` }} />
                  </div>
                  <div className="mt-1 text-[9px] text-white/30">{formatCurrency(item.amount, isPrivate)}</div>
                </div>
              ))}
            </div>
            <div className="mt-auto rounded-xl border border-white/10 bg-white/[0.03] p-3 text-[10px] text-white/40">
              {stats.targetTotal > 100
                ? `A soma das metas de alocação é ${stats.targetTotal.toFixed(1)}%. Ajuste para no máximo 100%.`
                : 'Os percentuais usam somente os valores atuais cadastrados; nenhuma cotação é inventada.'}
            </div>
          </section>
        </div>
      )}

      {activeTab === 'income' && (
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-4 overflow-hidden">
          <section className="lg:col-span-7 glass-card !p-4 min-h-0">
            <h3 className="font-bold text-sm flex items-center gap-2 mb-4"><TrendingUp size={16} /> Proventos por ativo</h3>
            <div className="grid gap-2">
              {investments.filter((item) => safeNumber(item.dividends_received) > 0).map((item) => (
                <div key={item.id} className="flex items-center justify-between rounded-xl border border-white/5 bg-white/[0.03] px-4 py-3">
                  <div>
                    <div className="text-sm font-bold">{item.name}</div>
                    <div className="text-[9px] uppercase text-white/30">Valor acumulado informado</div>
                  </div>
                  <strong className="text-green-400">{formatCurrency(item.dividends_received || 0, isPrivate)}</strong>
                </div>
              ))}
              {investments.every((item) => safeNumber(item.dividends_received) <= 0) && (
                <div className="flex h-40 items-center justify-center text-xs text-white/30">Nenhum provento informado.</div>
              )}
            </div>
          </section>
          <section className="lg:col-span-5 glass-card !p-4 flex flex-col justify-center gap-3">
            <Target className="text-brand-primary" size={28} />
            <h3 className="text-lg font-bold">Dados sem estimativas aleatórias</h3>
            <p className="text-xs leading-relaxed text-white/50">
              O total desta aba corresponde exatamente aos valores de proventos cadastrados em cada ativo. Para histórico mensal, registre os recebimentos como lançamentos com a categoria “Proventos”.
            </p>
            <div className="text-2xl font-black text-green-400">{formatCurrency(stats.dividends, isPrivate)}</div>
          </section>
        </div>
      )}

      {activeTab === 'planning' && (
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-4 overflow-hidden">
          <section className="lg:col-span-7 glass-card !p-5 flex flex-col justify-center gap-4">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-brand-primary/15 p-3 text-brand-primary"><Lightbulb size={22} /></div>
              <div>
                <h3 className="font-bold">Planejamento local de aporte</h3>
                <p className="text-[10px] uppercase tracking-widest text-white/30">Sem envio de dados para IA externa</p>
              </div>
            </div>
            {advice ? (
              <>
                <div className="rounded-2xl border border-brand-primary/20 bg-brand-primary/5 p-5">
                  <div className="text-[10px] uppercase font-bold text-white/40">Valor sugerido pelo cálculo</div>
                  <div className="mt-1 text-3xl font-black text-brand-primary">{formatCurrency(advice.recommendedAmount, isPrivate)}</div>
                  <div className="mt-2 text-sm font-bold">{advice.strategy}</div>
                  <p className="mt-2 text-xs leading-relaxed text-white/50">{advice.reasoning}</p>
                </div>
                <p className="text-[10px] text-white/30">Ferramenta educacional de organização financeira; não é recomendação de investimento.</p>
              </>
            ) : (
              <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center text-xs text-white/40">
                Clique em “Calcular aporte” para considerar saldo, contas pendentes, metas e orçamentos cadastrados.
              </div>
            )}
          </section>
          <section className="lg:col-span-5 glass-card !p-5">
            <h3 className="font-bold text-sm mb-4">Checklist antes de investir</h3>
            <div className="space-y-3 text-xs text-white/50">
              <ChecklistItem done={safeNumber(settings?.current_balance) > 0} text="Saldo atual positivo" />
              <ChecklistItem done={stats.total > 0} text="Carteira cadastrada e mensurável" />
              <ChecklistItem done={stats.targetTotal > 0 && stats.targetTotal <= 100} text="Metas de alocação válidas" />
              <ChecklistItem done={investments.some((item) => safeNumber(item.current_price) > 0) || investments.length === 0} text="Preços atuais registrados quando necessários" />
            </div>
          </section>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <form onSubmit={saveInvestment} className="glass-card w-full max-w-3xl !p-6 max-h-[90vh] overflow-y-auto no-scrollbar">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold">{editing ? 'Editar investimento' : 'Novo investimento'}</h2>
                <p className="text-xs text-white/40">Use valores reais informados por você.</p>
              </div>
              <button type="button" onClick={() => setShowModal(false)}><X size={20} /></button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Nome ou ticker"><input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field>
              <Field label="Tipo"><select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value as Investment['type'] })}>{(Object.keys(TYPE_LABELS) as Investment['type'][]).map((type) => <option key={type} value={type}>{TYPE_LABELS[type]}</option>)}</select></Field>
              <Field label="Instituição"><input value={form.institution} onChange={(event) => setForm({ ...form, institution: event.target.value })} /></Field>
              <Field label="Valor atual total"><input type="number" min="0" step="0.01" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} /></Field>
              <Field label="Valor inicialmente investido"><input type="number" min="0" step="0.01" value={form.initial_amount} onChange={(event) => setForm({ ...form, initial_amount: event.target.value })} /></Field>
              <Field label="Quantidade"><input type="number" min="0" step="0.00000001" value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} /></Field>
              <Field label="Preço médio"><input type="number" min="0" step="0.01" value={form.average_price} onChange={(event) => setForm({ ...form, average_price: event.target.value })} /></Field>
              <Field label="Preço atual"><input type="number" min="0" step="0.01" value={form.current_price} onChange={(event) => setForm({ ...form, current_price: event.target.value })} /></Field>
              <Field label="Proventos acumulados"><input type="number" min="0" step="0.01" value={form.dividends_received} onChange={(event) => setForm({ ...form, dividends_received: event.target.value })} /></Field>
              <Field label="Meta na carteira (%)"><input type="number" min="0" max="100" step="0.1" value={form.target_percentage} onChange={(event) => setForm({ ...form, target_percentage: event.target.value })} /></Field>
            </div>

            <details className="mt-5 rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <summary className="cursor-pointer text-xs font-bold">Indicadores opcionais para análise local</summary>
              <div className="mt-4 grid grid-cols-2 md:grid-cols-5 gap-3">
                <Field label="P/L"><input type="number" step="0.01" value={form.pl} onChange={(event) => setForm({ ...form, pl: event.target.value })} /></Field>
                <Field label="ROE (%)"><input type="number" step="0.01" value={form.roe} onChange={(event) => setForm({ ...form, roe: event.target.value })} /></Field>
                <Field label="EBITDA"><input type="number" step="0.01" value={form.ebitda} onChange={(event) => setForm({ ...form, ebitda: event.target.value })} /></Field>
                <Field label="Dívida líquida"><input type="number" step="0.01" value={form.liquid_debt} onChange={(event) => setForm({ ...form, liquid_debt: event.target.value })} /></Field>
                <Field label="DY (%)"><input type="number" step="0.01" value={form.dividend_yield} onChange={(event) => setForm({ ...form, dividend_yield: event.target.value })} /></Field>
              </div>
            </details>

            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setShowModal(false)} className="rounded-xl bg-white/5 px-5 py-3 text-sm font-bold">Cancelar</button>
              <button disabled={saving} className="rounded-xl bg-brand-primary px-5 py-3 text-sm font-bold text-black disabled:opacity-50">{saving ? 'Salvando...' : 'Salvar'}</button>
            </div>
          </form>
        </div>
      )}

      {analysis && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="glass-card w-full max-w-lg !p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold">Análise local: {analysis.investment.name}</h2>
                <p className="text-xs text-white/40">Somente indicadores cadastrados.</p>
              </div>
              <button type="button" onClick={() => setAnalysis(null)}><X size={20} /></button>
            </div>
            <div className="mt-5 flex items-center gap-4">
              <div className="flex h-20 w-20 items-center justify-center rounded-full border-4 border-brand-primary/30 text-2xl font-black text-brand-primary">{analysis.result.score}</div>
              <div>
                <div className="text-sm font-bold">Resultado: {analysis.result.verdict}</div>
                <p className="mt-1 text-xs text-white/40">{analysis.result.analysisNote}</p>
              </div>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-4 text-xs">
              <div><h3 className="mb-2 font-bold text-green-400">Pontos observados</h3>{analysis.result.pros.map((item) => <p key={item} className="mb-1 text-white/50">• {item}</p>)}</div>
              <div><h3 className="mb-2 font-bold text-orange-400">Limitações e alertas</h3>{analysis.result.cons.map((item) => <p key={item} className="mb-1 text-white/50">• {item}</p>)}</div>
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
        <span className="text-[9px] font-bold uppercase tracking-widest">{label}</span>
        <Icon size={15} />
      </div>
      <div className={`mt-2 truncate text-lg font-black ${tone === 'positive' ? 'text-green-400' : tone === 'negative' ? 'text-red-400' : ''}`}>{value}</div>
      {detail && <div className="mt-1 text-[10px] text-white/40">{detail}</div>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactElement<any> }) {
  return (
    <label className="block text-[10px] font-bold uppercase tracking-widest text-white/40">
      {label}
      {React.cloneElement(children, {
        className: 'mt-1 w-full rounded-xl border border-white/10 bg-[#121212] px-3 py-2.5 text-sm text-white outline-none focus:border-brand-primary',
      })}
    </label>
  );
}

function ChecklistItem({ done, text }: { done: boolean; text: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.03] p-3">
      <div className={`h-3 w-3 rounded-full ${done ? 'bg-green-400' : 'bg-orange-400'}`} />
      <span>{text}</span>
    </div>
  );
}
