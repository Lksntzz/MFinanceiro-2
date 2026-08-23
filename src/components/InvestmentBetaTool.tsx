import type { User } from '@supabase/supabase-js';
import {
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
  BarChart3,
  Beaker,
  CalendarDays,
  CircleDollarSign,
  Cloud,
  HardDrive,
  Landmark,
  PieChart,
  Plus,
  Search,
  Target,
  Trash2,
  Wallet,
  X,
} from 'lucide-react';
import type React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';

import { useApp } from '../context/AppContext';
import {
  ASSET_CLASS_LABELS,
  betaAccessStorageKey,
  betaOperationsStorageKey,
  betaTargetsStorageKey,
  calculateRebalancingPlan,
  deriveAllocationByClass,
  deriveInvestmentPositions,
  type InvestmentAssetClass,
  type InvestmentBetaIncomeEvent,
  type InvestmentBetaOperation,
  type InvestmentBetaQuote,
  normalizeSymbol,
  operationGrossAmount,
  projectInvestmentIncomeEvents,
  sanitizeNumber,
} from '../features/investments-beta/investment-beta-domain';
import {
  deleteBetaCloudOperation,
  loadBetaCloudOperations,
  loadBetaCloudTargets,
  saveBetaCloudOperation,
  saveBetaCloudTargets,
} from '../features/investments-beta/investment-beta-repository';
import {
  fetchBetaIncomeEvents,
  fetchBetaMarketQuote,
} from '../features/investments-beta/investment-market-beta';
import { formatCurrency } from '../lib/formatters';
import { supabase } from '../lib/supabase';
import AppNavigation from './AppNavigation';

type BetaSection =
  | 'overview'
  | 'portfolio'
  | 'operations'
  | 'income'
  | 'planning'
  | 'market';
type AccountOption = { id: string; name: string };
type PersistenceMode = 'browser' | 'cloud-beta';
type IncomeAssetClass = 'stock' | 'fii' | 'etf' | 'bdr';

type OperationDraft = {
  type: 'buy' | 'sell';
  assetClass: InvestmentAssetClass;
  symbol: string;
  assetName: string;
  institution: string;
  accountId: string;
  date: string;
  quantity: string;
  unitPrice: string;
  fees: string;
};

const DEFAULT_TARGETS: Partial<Record<InvestmentAssetClass, number>> = {
  stock: 30,
  fii: 25,
  fixed_income: 30,
  crypto: 10,
  international: 5,
};

const EMPTY_DRAFT: OperationDraft = {
  type: 'buy',
  assetClass: 'stock',
  symbol: '',
  assetName: '',
  institution: '',
  accountId: '',
  date: new Date().toISOString().slice(0, 10),
  quantity: '',
  unitPrice: '',
  fees: '0',
};

const SECTIONS: Array<{
  id: BetaSection;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
}> = [
  { id: 'overview', label: 'Visão geral', icon: BarChart3 },
  { id: 'portfolio', label: 'Carteira', icon: PieChart },
  { id: 'operations', label: 'Lançamentos', icon: Plus },
  { id: 'income', label: 'Proventos', icon: CalendarDays },
  { id: 'planning', label: 'Aportes', icon: Target },
  { id: 'market', label: 'Mercado', icon: Search },
];

const INCOME_CLASS_OPTIONS: Array<[string, string]> = [
  ['stock', 'Ações'],
  ['fii', 'FIIs'],
  ['etf', 'ETFs'],
  ['bdr', 'BDRs'],
];

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function persistJson(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* beta storage is optional */
  }
}

function money(value: number, currency = 'BRL') {
  try {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency,
    }).format(Number(value || 0));
  } catch {
    return formatCurrency(Number(value || 0));
  }
}

function formatEventDate(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toLocaleDateString('pt-BR');
}

export default function InvestmentBetaTool({ user }: { user: User }) {
  const { isPrivate } = useApp();
  const navigate = useNavigate();
  const [section, setSection] = useState<BetaSection>('overview');
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [operations, setOperations] = useState<InvestmentBetaOperation[]>(() =>
    loadJson(betaOperationsStorageKey(user.id), []),
  );
  const [quotes, setQuotes] = useState<
    Record<string, InvestmentBetaQuote | undefined>
  >({});
  const [targets, setTargets] = useState<
    Partial<Record<InvestmentAssetClass, number>>
  >(() => loadJson(betaTargetsStorageKey(user.id), DEFAULT_TARGETS));
  const [persistenceMode, setPersistenceMode] =
    useState<PersistenceMode>('browser');
  const [draft, setDraft] = useState<OperationDraft>(EMPTY_DRAFT);
  const [showOperationForm, setShowOperationForm] = useState(false);
  const [savingOperation, setSavingOperation] = useState(false);
  const [marketSymbol, setMarketSymbol] = useState('PETR4');
  const [marketClass, setMarketClass] = useState<InvestmentAssetClass>('stock');
  const [marketLoading, setMarketLoading] = useState(false);
  const [marketError, setMarketError] = useState<string | null>(null);
  const [marketQuote, setMarketQuote] = useState<InvestmentBetaQuote | null>(
    null,
  );
  const [incomeSymbol, setIncomeSymbol] = useState('PETR4');
  const [incomeClass, setIncomeClass] = useState<IncomeAssetClass>('stock');
  const [incomeLoading, setIncomeLoading] = useState(false);
  const [incomeError, setIncomeError] = useState<string | null>(null);
  const [incomeEvents, setIncomeEvents] = useState<InvestmentBetaIncomeEvent[]>(
    [],
  );
  const [contribution, setContribution] = useState('1000');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    try {
      window.localStorage.setItem(betaAccessStorageKey(), '1');
    } catch {
      /* optional */
    }

    void supabase
      .from('mf_account_balances')
      .select('id,name')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .order('is_default', { ascending: false })
      .then(({ data }) => {
        if (active)
          setAccounts(
            (data || []).map((item: any) => ({
              id: String(item.id),
              name: String(item.name || 'Conta'),
            })),
          );
      });

    const localOperations = loadJson<InvestmentBetaOperation[]>(
      betaOperationsStorageKey(user.id),
      [],
    );
    const localTargets = loadJson<
      Partial<Record<InvestmentAssetClass, number>>
    >(betaTargetsStorageKey(user.id), DEFAULT_TARGETS);

    void Promise.all([
      loadBetaCloudOperations(user.id),
      loadBetaCloudTargets(user.id),
    ])
      .then(async ([cloudOperations, cloudTargets]) => {
        if (!active || !cloudOperations.available || !cloudTargets.available)
          return;
        setPersistenceMode('cloud-beta');

        if (cloudOperations.operations.length > 0) {
          setOperations(cloudOperations.operations);
        } else if (localOperations.length > 0) {
          await Promise.all(
            localOperations.map((operation) =>
              saveBetaCloudOperation(operation),
            ),
          );
        }

        if (Object.keys(cloudTargets.targets).length > 0) {
          setTargets({ ...DEFAULT_TARGETS, ...cloudTargets.targets });
        } else {
          await saveBetaCloudTargets(user.id, localTargets);
        }
      })
      .catch(() => {
        if (active) setPersistenceMode('browser');
      });

    return () => {
      active = false;
    };
  }, [user.id]);

  useEffect(() => {
    persistJson(betaOperationsStorageKey(user.id), operations);
  }, [operations, user.id]);
  useEffect(() => {
    persistJson(betaTargetsStorageKey(user.id), targets);
  }, [targets, user.id]);
  useEffect(() => {
    if (persistenceMode !== 'cloud-beta') return;
    const timeout = window.setTimeout(() => {
      void saveBetaCloudTargets(user.id, targets).catch(() =>
        setPersistenceMode('browser'),
      );
    }, 450);
    return () => window.clearTimeout(timeout);
  }, [persistenceMode, targets, user.id]);

  const positions = useMemo(
    () => deriveInvestmentPositions(operations, quotes),
    [operations, quotes],
  );
  const allocation = useMemo(
    () => deriveAllocationByClass(positions),
    [positions],
  );
  const incomeProjections = useMemo(
    () => projectInvestmentIncomeEvents(incomeEvents, operations),
    [incomeEvents, operations],
  );
  const totals = useMemo(() => {
    const invested = positions.reduce(
      (sum, item) => sum + item.investedCost,
      0,
    );
    const current = positions.reduce((sum, item) => sum + item.currentValue, 0);
    const result = current - invested;
    return {
      invested,
      current,
      result,
      resultPercent: invested > 0 ? (result / invested) * 100 : 0,
    };
  }, [positions]);
  const contributionPlan = useMemo(
    () =>
      calculateRebalancingPlan(
        positions,
        targets,
        sanitizeNumber(contribution),
      ),
    [positions, targets, contribution],
  );

  async function saveOperation(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);
    const symbol = normalizeSymbol(draft.symbol);
    const quantity = Math.max(0, sanitizeNumber(draft.quantity));
    const unitPrice = Math.max(0, sanitizeNumber(draft.unitPrice));
    const fees = Math.max(0, sanitizeNumber(draft.fees));
    if (!symbol || quantity <= 0 || unitPrice <= 0) {
      setMessage('Informe ticker, quantidade e preço unitário válidos.');
      return;
    }
    const account = accounts.find((item) => item.id === draft.accountId);
    const operation: InvestmentBetaOperation = {
      id: crypto.randomUUID(),
      userId: user.id,
      type: draft.type,
      assetClass: draft.assetClass,
      symbol,
      assetName: draft.assetName.trim() || undefined,
      institution: draft.institution.trim() || undefined,
      accountId: account?.id,
      accountName: account?.name,
      date: draft.date,
      quantity,
      unitPrice,
      fees,
      currency: 'BRL',
      createdAt: new Date().toISOString(),
    };

    setSavingOperation(true);
    setOperations((current) => [operation, ...current]);
    setDraft(EMPTY_DRAFT);
    setShowOperationForm(false);
    try {
      const savedInCloud = await saveBetaCloudOperation(operation);
      if (savedInCloud) setPersistenceMode('cloud-beta');
      setMessage(
        savedInCloud
          ? 'Operação salva no ledger beta isolado. O saldo financeiro oficial não foi alterado.'
          : 'Operação registrada no beta deste navegador. O saldo financeiro oficial não foi alterado.',
      );
    } catch {
      setPersistenceMode('browser');
      setMessage(
        'Operação preservada neste navegador; a sincronização beta não está disponível agora.',
      );
    } finally {
      setSavingOperation(false);
    }
  }

  async function queryMarket(
    symbolInput = marketSymbol,
    assetClass = marketClass,
  ) {
    setMarketLoading(true);
    setMarketError(null);
    try {
      const quote = await fetchBetaMarketQuote(symbolInput, assetClass);
      setMarketQuote(quote);
      setQuotes((current) => ({ ...current, [quote.symbol]: quote }));
    } catch (error: any) {
      setMarketQuote(null);
      setMarketError(error?.message || 'Não foi possível consultar o ativo.');
    } finally {
      setMarketLoading(false);
    }
  }

  async function queryIncome() {
    setIncomeLoading(true);
    setIncomeError(null);
    try {
      const events = await fetchBetaIncomeEvents(incomeSymbol, incomeClass);
      setIncomeEvents(events);
      if (events.length === 0)
        setIncomeError(
          'A fonte não retornou proventos para este ativo no período disponível.',
        );
    } catch (error: any) {
      setIncomeEvents([]);
      setIncomeError(
        error?.message ||
          'Não foi possível consultar os proventos deste ativo.',
      );
    } finally {
      setIncomeLoading(false);
    }
  }

  async function removeOperation(id: string) {
    setOperations((current) => current.filter((item) => item.id !== id));
    if (persistenceMode !== 'cloud-beta') return;
    try {
      const removed = await deleteBetaCloudOperation(user.id, id);
      if (!removed) setPersistenceMode('browser');
    } catch {
      setPersistenceMode('browser');
      setMessage(
        'Operação removida deste navegador, mas a sincronização beta precisa ser revisada.',
      );
    }
  }

  function leaveBeta() {
    try {
      window.localStorage.removeItem(betaAccessStorageKey());
    } catch {
      /* optional */
    }
    navigate('/app');
  }

  return (
    <div className="mf-app-shell mf-routed-app">
      <AppNavigation onLaunch={() => navigate('/app/lancar')} />
      <header className="mf-topbar">
        <div className="mf-brand">
          <div className="mf-brand-icon">
            <Landmark size={20} />
          </div>
          <div>
            <h1>MF Invest</h1>
            <span>Ambiente beta isolado</span>
          </div>
        </div>
        <div className="mf-top-actions">
          <button type="button" onClick={leaveBeta}>
            Encerrar beta
          </button>
        </div>
      </header>
      <section className="mf-content">
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
          <div className="rounded-2xl border border-violet-400/20 bg-gradient-to-r from-violet-500/10 via-cyan-500/5 to-transparent p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex gap-3">
                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-violet-500/15 text-violet-300">
                  <Beaker size={20} />
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-base font-black text-white">
                      MF Invest
                    </h2>
                    <span className="rounded-full border border-violet-400/25 bg-violet-400/10 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-violet-200">
                      Beta
                    </span>
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-bold text-white/45">
                      {persistenceMode === 'cloud-beta' ? (
                        <Cloud size={11} />
                      ) : (
                        <HardDrive size={11} />
                      )}
                      {persistenceMode === 'cloud-beta'
                        ? 'Ledger beta sincronizado'
                        : 'Dados neste navegador'}
                    </span>
                  </div>
                  <p className="mt-1 max-w-3xl text-xs leading-relaxed text-white/55">
                    Teste isolado da nova experiência de investimentos. Nada
                    nesta área movimenta saldo, patrimônio oficial ou
                    lançamentos financeiros do MF. Quando o ledger beta estiver
                    disponível, os dados são sincronizados em tabelas exclusivas
                    do teste.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 rounded-xl border border-white/8 bg-white/[0.025] p-2">
            {SECTIONS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setSection(id)}
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold transition ${section === id ? 'bg-white/10 text-white' : 'text-white/45 hover:bg-white/5 hover:text-white/70'}`}
              >
                <Icon size={14} />
                {label}
              </button>
            ))}
          </div>

          {message && (
            <div className="flex items-center justify-between rounded-xl border border-cyan-400/15 bg-cyan-400/[0.045] px-4 py-3 text-xs text-cyan-100/75">
              <span>{message}</span>
              <button type="button" onClick={() => setMessage(null)}>
                <X size={14} />
              </button>
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            {section === 'overview' && (
              <div className="space-y-4">
                <div className="grid gap-3 md:grid-cols-4">
                  <Metric
                    label="Patrimônio beta"
                    value={money(totals.current)}
                    hidden={isPrivate}
                  />
                  <Metric
                    label="Custo acumulado"
                    value={money(totals.invested)}
                    hidden={isPrivate}
                  />
                  <Metric
                    label="Resultado"
                    value={`${money(totals.result)} · ${totals.resultPercent.toFixed(2)}%`}
                    hidden={isPrivate}
                  />
                  <Metric
                    label="Ativos em carteira"
                    value={String(positions.length)}
                  />
                </div>
                <div className="grid gap-4 lg:grid-cols-[1.15fr_.85fr]">
                  <Panel
                    title="Sua carteira beta"
                    subtitle="Posições derivadas das operações registradas."
                  >
                    {positions.length === 0 ? (
                      <EmptyState
                        text="Registre uma compra para começar a testar a carteira."
                        action="Novo lançamento"
                        onClick={() => {
                          setSection('operations');
                          setShowOperationForm(true);
                        }}
                      />
                    ) : (
                      <div className="divide-y divide-white/8">
                        {positions.slice(0, 6).map((position) => (
                          <PositionRow
                            key={`${position.assetClass}:${position.symbol}`}
                            position={position}
                            hidden={isPrivate}
                          />
                        ))}
                      </div>
                    )}
                  </Panel>
                  <Panel
                    title="Alocação por classe"
                    subtitle="Distribuição atual da carteira beta."
                  >
                    {allocation.length === 0 ? (
                      <p className="text-xs text-white/40">
                        Sem alocação calculada ainda.
                      </p>
                    ) : (
                      <div className="space-y-3">
                        {allocation.map((row) => (
                          <div key={row.assetClass}>
                            <div className="mb-1 flex justify-between gap-4 text-xs">
                              <span className="text-white/65">{row.label}</span>
                              <strong className="text-white/80">
                                {row.percentage.toFixed(1)}%
                              </strong>
                            </div>
                            <div className="h-2 overflow-hidden rounded-full bg-white/8">
                              <div
                                className="h-full rounded-full bg-cyan-300/60"
                                style={{
                                  width: `${Math.min(100, row.percentage)}%`,
                                }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </Panel>
                </div>
              </div>
            )}

            {section === 'portfolio' && (
              <Panel
                title="Carteira"
                subtitle="Quantidade, preço médio, cotação conhecida e resultado por ativo."
              >
                {positions.length === 0 ? (
                  <EmptyState
                    text="Nenhuma posição no beta."
                    action="Registrar compra"
                    onClick={() => {
                      setSection('operations');
                      setShowOperationForm(true);
                    }}
                  />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[820px] text-left text-xs">
                      <thead className="text-[10px] uppercase tracking-wider text-white/35">
                        <tr>
                          <th className="p-3">Ativo</th>
                          <th className="p-3">Classe</th>
                          <th className="p-3 text-right">Quantidade</th>
                          <th className="p-3 text-right">Preço médio</th>
                          <th className="p-3 text-right">Preço atual</th>
                          <th className="p-3 text-right">Valor atual</th>
                          <th className="p-3 text-right">Resultado</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/8">
                        {positions.map((position) => (
                          <tr
                            key={`${position.assetClass}:${position.symbol}`}
                            className="text-white/65"
                          >
                            <td className="p-3">
                              <strong className="text-white/85">
                                {position.symbol}
                              </strong>
                              <div className="text-[10px] text-white/30">
                                {position.assetName || 'Ativo cadastrado'}
                              </div>
                            </td>
                            <td className="p-3">
                              {ASSET_CLASS_LABELS[position.assetClass]}
                            </td>
                            <td className="p-3 text-right">
                              {position.quantity.toLocaleString('pt-BR', {
                                maximumFractionDigits: 8,
                              })}
                            </td>
                            <td className="p-3 text-right">
                              {isPrivate
                                ? '••••'
                                : money(
                                    position.averagePrice,
                                    position.currency,
                                  )}
                            </td>
                            <td className="p-3 text-right">
                              {isPrivate
                                ? '••••'
                                : money(
                                    position.currentPrice,
                                    position.currency,
                                  )}
                            </td>
                            <td className="p-3 text-right font-bold text-white/85">
                              {isPrivate
                                ? '••••'
                                : money(
                                    position.currentValue,
                                    position.currency,
                                  )}
                            </td>
                            <td
                              className={`p-3 text-right font-bold ${position.unrealizedResult >= 0 ? 'text-emerald-300' : 'text-red-300'}`}
                            >
                              {isPrivate
                                ? '••••'
                                : `${money(position.unrealizedResult, position.currency)} · ${position.unrealizedResultPercent.toFixed(2)}%`}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Panel>
            )}

            {section === 'operations' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-base font-black text-white">
                      Lançamentos de investimento
                    </h2>
                    <p className="mt-1 text-xs text-white/45">
                      Compra e venda são registradas como operações; preço médio
                      e posição são derivados automaticamente.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowOperationForm(true)}
                    className="flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-xs font-black text-white"
                  >
                    <Plus size={14} />
                    Nova operação
                  </button>
                </div>
                {showOperationForm && (
                  <form
                    onSubmit={saveOperation}
                    className="grid gap-3 rounded-2xl border border-violet-400/20 bg-violet-500/[0.045] p-4 md:grid-cols-2 lg:grid-cols-4"
                  >
                    <Select
                      label="Operação"
                      value={draft.type}
                      onChange={(value) =>
                        setDraft((current) => ({
                          ...current,
                          type: value as 'buy' | 'sell',
                        }))
                      }
                      options={[
                        ['buy', 'Compra'],
                        ['sell', 'Venda'],
                      ]}
                    />
                    <Select
                      label="Classe"
                      value={draft.assetClass}
                      onChange={(value) =>
                        setDraft((current) => ({
                          ...current,
                          assetClass: value as InvestmentAssetClass,
                        }))
                      }
                      options={(
                        Object.keys(
                          ASSET_CLASS_LABELS,
                        ) as InvestmentAssetClass[]
                      ).map((key) => [key, ASSET_CLASS_LABELS[key]])}
                    />
                    <Field
                      label="Ticker / símbolo"
                      value={draft.symbol}
                      onChange={(value) =>
                        setDraft((current) => ({ ...current, symbol: value }))
                      }
                      placeholder="PETR4"
                    />
                    <Field
                      label="Nome do ativo"
                      value={draft.assetName}
                      onChange={(value) =>
                        setDraft((current) => ({
                          ...current,
                          assetName: value,
                        }))
                      }
                      placeholder="Opcional"
                    />
                    <Field
                      label="Data"
                      type="date"
                      value={draft.date}
                      onChange={(value) =>
                        setDraft((current) => ({ ...current, date: value }))
                      }
                    />
                    <Field
                      label="Quantidade"
                      type="number"
                      step="any"
                      value={draft.quantity}
                      onChange={(value) =>
                        setDraft((current) => ({ ...current, quantity: value }))
                      }
                    />
                    <Field
                      label="Preço unitário"
                      type="number"
                      step="any"
                      value={draft.unitPrice}
                      onChange={(value) =>
                        setDraft((current) => ({
                          ...current,
                          unitPrice: value,
                        }))
                      }
                    />
                    <Field
                      label="Taxas"
                      type="number"
                      step="any"
                      value={draft.fees}
                      onChange={(value) =>
                        setDraft((current) => ({ ...current, fees: value }))
                      }
                    />
                    <Field
                      label="Instituição / corretora"
                      value={draft.institution}
                      onChange={(value) =>
                        setDraft((current) => ({
                          ...current,
                          institution: value,
                        }))
                      }
                    />
                    <Select
                      label="Conta financeira vinculada"
                      value={draft.accountId}
                      onChange={(value) =>
                        setDraft((current) => ({
                          ...current,
                          accountId: value,
                        }))
                      }
                      options={[
                        ['', 'Sem vínculo no beta'],
                        ...accounts.map(
                          (account) =>
                            [account.id, account.name] as [string, string],
                        ),
                      ]}
                    />
                    <div className="md:col-span-2 lg:col-span-2 flex items-end justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setShowOperationForm(false)}
                        className="rounded-xl border border-white/10 px-4 py-2.5 text-xs font-bold text-white/55"
                      >
                        Cancelar
                      </button>
                      <button
                        type="submit"
                        disabled={savingOperation}
                        className="rounded-xl bg-cyan-300 px-4 py-2.5 text-xs font-black text-black disabled:opacity-50"
                      >
                        {savingOperation ? 'Salvando…' : 'Registrar no beta'}
                      </button>
                    </div>
                  </form>
                )}
                <Panel
                  title="Histórico de operações"
                  subtitle="Nenhuma operação deste teste altera a conta financeira vinculada."
                >
                  {operations.length === 0 ? (
                    <p className="text-xs text-white/40">
                      Nenhuma operação registrada.
                    </p>
                  ) : (
                    <div className="divide-y divide-white/8">
                      {operations.map((operation) => (
                        <div
                          key={operation.id}
                          className="grid gap-3 py-3 md:grid-cols-[auto_1fr_repeat(3,auto)_auto] md:items-center"
                        >
                          <div
                            className={`grid h-9 w-9 place-items-center rounded-xl ${operation.type === 'buy' ? 'bg-emerald-400/10 text-emerald-300' : 'bg-amber-400/10 text-amber-300'}`}
                          >
                            {operation.type === 'buy' ? (
                              <ArrowDownToLine size={16} />
                            ) : (
                              <ArrowUpFromLine size={16} />
                            )}
                          </div>
                          <div>
                            <strong className="text-xs text-white/85">
                              {operation.symbol}
                            </strong>
                            <div className="mt-0.5 text-[10px] text-white/35">
                              {operation.type === 'buy' ? 'Compra' : 'Venda'} ·{' '}
                              {ASSET_CLASS_LABELS[operation.assetClass]} ·{' '}
                              {operation.date}
                              {operation.accountName
                                ? ` · ${operation.accountName}`
                                : ''}
                            </div>
                          </div>
                          <span className="text-xs text-white/55">
                            {operation.quantity.toLocaleString('pt-BR', {
                              maximumFractionDigits: 8,
                            })}
                          </span>
                          <span className="text-xs text-white/55">
                            {isPrivate ? '••••' : money(operation.unitPrice)}
                          </span>
                          <strong className="text-xs text-white/80">
                            {isPrivate
                              ? '••••'
                              : money(operationGrossAmount(operation))}
                          </strong>
                          <button
                            type="button"
                            onClick={() => void removeOperation(operation.id)}
                            className="rounded-lg p-2 text-white/25 hover:bg-red-500/10 hover:text-red-300"
                            aria-label="Excluir operação beta"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </Panel>
              </div>
            )}

            {section === 'income' && (
              <div className="grid gap-4 lg:grid-cols-[.82fr_1.18fr]">
                <Panel
                  title="Consultar proventos"
                  subtitle="Eventos objetivos da fonte de mercado, sem notícias ou recomendação."
                >
                  <div className="space-y-3">
                    <Select
                      label="Classe"
                      value={incomeClass}
                      onChange={(value) =>
                        setIncomeClass(value as IncomeAssetClass)
                      }
                      options={INCOME_CLASS_OPTIONS}
                    />
                    <Field
                      label="Ticker / símbolo"
                      value={incomeSymbol}
                      onChange={setIncomeSymbol}
                      placeholder="PETR4"
                    />
                    <button
                      type="button"
                      disabled={incomeLoading}
                      onClick={() => void queryIncome()}
                      className="flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-300 px-4 py-3 text-xs font-black text-black disabled:opacity-50"
                    >
                      <CircleDollarSign size={14} />
                      {incomeLoading ? 'Consultando…' : 'Buscar proventos'}
                    </button>
                    {incomeError && (
                      <p className="rounded-xl border border-amber-400/15 bg-amber-400/5 p-3 text-xs leading-relaxed text-amber-100/70">
                        {incomeError}
                      </p>
                    )}
                    <p className="text-[10px] leading-relaxed text-white/30">
                      O valor previsto é calculado somente quando a fonte
                      informa a data-com. O MF usa a quantidade que existia na
                      carteira beta nessa data; não cria estimativas sem base.
                    </p>
                  </div>
                </Panel>
                <Panel
                  title="Eventos e valor previsto"
                  subtitle="Data-com, pagamento, valor por ação/cota e posição elegível."
                >
                  {incomeProjections.length === 0 ? (
                    <EmptyState text="Consulte um ativo para visualizar os eventos disponíveis." />
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[760px] text-left text-xs">
                        <thead className="text-[10px] uppercase tracking-wider text-white/35">
                          <tr>
                            <th className="p-3">Evento</th>
                            <th className="p-3">Data-com</th>
                            <th className="p-3">Pagamento</th>
                            <th className="p-3 text-right">Por unidade</th>
                            <th className="p-3 text-right">Qtd. elegível</th>
                            <th className="p-3 text-right">Previsto</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/8">
                          {incomeProjections.map((event) => (
                            <tr key={event.id} className="text-white/60">
                              <td className="p-3">
                                <strong className="text-white/85">
                                  {event.symbol}
                                </strong>
                                <div className="mt-0.5 text-[10px] text-white/35">
                                  {event.label}
                                </div>
                              </td>
                              <td className="p-3">
                                {formatEventDate(event.recordDate)}
                              </td>
                              <td className="p-3">
                                {formatEventDate(event.paymentDate)}
                              </td>
                              <td className="p-3 text-right">
                                {isPrivate
                                  ? '••••'
                                  : money(event.rate, event.currency)}
                              </td>
                              <td className="p-3 text-right">
                                {event.eligibilityKnown
                                  ? event.eligibleQuantity.toLocaleString(
                                      'pt-BR',
                                      { maximumFractionDigits: 8 },
                                    )
                                  : '—'}
                              </td>
                              <td className="p-3 text-right font-bold text-white/85">
                                {event.eligibilityKnown
                                  ? isPrivate
                                    ? '••••'
                                    : money(
                                        event.expectedAmount,
                                        event.currency,
                                      )
                                  : 'Sem data-com'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {incomeProjections.length > 0 && (
                    <p className="mt-4 text-[10px] leading-relaxed text-white/30">
                      Estes eventos ainda não são lançados na Agenda nem no
                      saldo oficial. Essa integração só será ligada depois da
                      validação do beta.
                    </p>
                  )}
                </Panel>
              </div>
            )}

            {section === 'planning' && (
              <div className="grid gap-4 lg:grid-cols-[.9fr_1.1fr]">
                <Panel
                  title="Alocação alvo"
                  subtitle="Defina a distribuição desejada por classe."
                >
                  <div className="space-y-3">
                    {(
                      Object.keys(ASSET_CLASS_LABELS) as InvestmentAssetClass[]
                    ).map((assetClass) => (
                      <label
                        key={assetClass}
                        className="grid grid-cols-[1fr_90px] items-center gap-3 text-xs text-white/60"
                      >
                        <span>{ASSET_CLASS_LABELS[assetClass]}</span>
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="1"
                          value={targets[assetClass] || ''}
                          onChange={(event) =>
                            setTargets((current) => ({
                              ...current,
                              [assetClass]: Math.max(
                                0,
                                sanitizeNumber(event.target.value),
                              ),
                            }))
                          }
                          className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-right text-white outline-none"
                        />
                      </label>
                    ))}
                  </div>
                </Panel>
                <Panel
                  title="Planejamento de aporte"
                  subtitle="Distribuição matemática para aproximar a carteira da meta sem vender ativos."
                >
                  <Field
                    label="Valor disponível para aportar"
                    type="number"
                    step="0.01"
                    value={contribution}
                    onChange={setContribution}
                  />
                  <div className="mt-4 space-y-2">
                    {contributionPlan.length === 0 ? (
                      <p className="text-xs text-white/40">
                        Defina metas e um valor de aporte para gerar o plano.
                      </p>
                    ) : (
                      contributionPlan.map((row) => (
                        <div
                          key={row.assetClass}
                          className="flex items-center justify-between rounded-xl border border-white/8 bg-white/[0.025] p-3"
                        >
                          <div>
                            <strong className="text-xs text-white/80">
                              {row.label}
                            </strong>
                            <p className="mt-0.5 text-[10px] text-white/35">
                              Meta normalizada {row.targetPercentage.toFixed(1)}
                              %
                            </p>
                          </div>
                          <strong className="text-sm text-cyan-200">
                            {isPrivate ? '••••' : money(row.suggestedAmount)}
                          </strong>
                        </div>
                      ))
                    )}
                  </div>
                </Panel>
              </div>
            )}

            {section === 'market' && (
              <div className="grid gap-4 lg:grid-cols-[.85fr_1.15fr]">
                <Panel
                  title="Consultar ativo"
                  subtitle="Cotação e variação, sem conteúdo editorial."
                >
                  <div className="space-y-3">
                    <Select
                      label="Classe"
                      value={marketClass}
                      onChange={(value) =>
                        setMarketClass(value as InvestmentAssetClass)
                      }
                      options={(
                        Object.keys(
                          ASSET_CLASS_LABELS,
                        ) as InvestmentAssetClass[]
                      ).map((key) => [key, ASSET_CLASS_LABELS[key]])}
                    />
                    <Field
                      label="Ticker / símbolo"
                      value={marketSymbol}
                      onChange={setMarketSymbol}
                      placeholder="PETR4"
                    />
                    <button
                      type="button"
                      disabled={marketLoading}
                      onClick={() => void queryMarket()}
                      className="flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-300 px-4 py-3 text-xs font-black text-black disabled:opacity-50"
                    >
                      <Search size={14} />
                      {marketLoading ? 'Consultando…' : 'Consultar mercado'}
                    </button>
                    {marketError && (
                      <p className="rounded-xl border border-amber-400/15 bg-amber-400/5 p-3 text-xs leading-relaxed text-amber-100/70">
                        {marketError}
                      </p>
                    )}
                    <p className="text-[10px] leading-relaxed text-white/30">
                      O beta tenta usar o proxy autenticado do MF. Enquanto ele
                      não estiver publicado com uma chave de mercado, o
                      navegador usa somente os ativos liberados pelo sandbox
                      público da fonte.
                    </p>
                  </div>
                </Panel>
                <Panel
                  title="Ficha do ativo"
                  subtitle="Preço, variação e dados objetivos da cotação."
                >
                  {marketQuote ? (
                    <div className="space-y-5">
                      <div>
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-[10px] font-bold uppercase tracking-wider text-white/35">
                              {marketQuote.name || marketQuote.symbol}
                            </p>
                            <h2 className="mt-1 text-3xl font-black text-white">
                              {marketQuote.symbol}
                            </h2>
                          </div>
                          <Activity size={24} className="text-cyan-300" />
                        </div>
                        <div className="mt-5 flex flex-wrap items-end gap-4">
                          <strong className="text-3xl text-white">
                            {isPrivate
                              ? '••••'
                              : money(marketQuote.price, marketQuote.currency)}
                          </strong>
                          <span
                            className={`rounded-lg px-2.5 py-1 text-xs font-black ${marketQuote.changePercent >= 0 ? 'bg-emerald-400/10 text-emerald-300' : 'bg-red-400/10 text-red-300'}`}
                          >
                            {marketQuote.changePercent >= 0 ? '+' : ''}
                            {marketQuote.changePercent.toFixed(2)}%
                          </span>
                        </div>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-3">
                        <MiniMetric
                          label="Variação"
                          value={
                            isPrivate
                              ? '••••'
                              : money(marketQuote.change, marketQuote.currency)
                          }
                        />
                        <MiniMetric
                          label="Moeda"
                          value={marketQuote.currency}
                        />
                        <MiniMetric
                          label="Fonte"
                          value={
                            marketQuote.source === 'brapi-backend'
                              ? 'Backend beta'
                              : 'Sandbox'
                          }
                        />
                      </div>
                      {marketQuote.updatedAt && (
                        <p className="text-[10px] text-white/30">
                          Última atualização informada pela fonte:{' '}
                          {new Date(marketQuote.updatedAt).toLocaleString(
                            'pt-BR',
                          )}
                        </p>
                      )}
                    </div>
                  ) : (
                    <EmptyState text="Consulte um ativo para abrir a ficha de mercado." />
                  )}
                </Panel>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function Panel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-white/8 bg-white/[0.025] p-4">
      <header className="mb-4">
        <h2 className="text-sm font-black text-white/85">{title}</h2>
        {subtitle && (
          <p className="mt-1 text-xs leading-relaxed text-white/40">
            {subtitle}
          </p>
        )}
      </header>
      {children}
    </section>
  );
}

function Metric({
  label,
  value,
  hidden = false,
}: {
  label: string;
  value: string;
  hidden?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-white/8 bg-white/[0.025] p-4">
      <p className="text-[10px] font-bold uppercase tracking-wider text-white/35">
        {label}
      </p>
      <strong className="mt-2 block text-lg text-white">
        {hidden ? '••••' : value}
      </strong>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/8 bg-black/10 p-3">
      <p className="text-[10px] uppercase tracking-wider text-white/30">
        {label}
      </p>
      <strong className="mt-1 block text-xs text-white/75">{value}</strong>
    </div>
  );
}

function PositionRow({
  position,
  hidden,
}: {
  position: ReturnType<typeof deriveInvestmentPositions>[number];
  hidden: boolean;
}) {
  return (
    <div className="grid grid-cols-[1fr_auto] gap-3 py-3">
      <div>
        <strong className="text-xs text-white/85">{position.symbol}</strong>
        <p className="mt-0.5 text-[10px] text-white/35">
          {ASSET_CLASS_LABELS[position.assetClass]} ·{' '}
          {position.quantity.toLocaleString('pt-BR', {
            maximumFractionDigits: 8,
          })}{' '}
          un.
        </p>
      </div>
      <div className="text-right">
        <strong className="text-xs text-white/80">
          {hidden ? '••••' : money(position.currentValue, position.currency)}
        </strong>
        <p
          className={`mt-0.5 text-[10px] ${position.unrealizedResult >= 0 ? 'text-emerald-300/80' : 'text-red-300/80'}`}
        >
          {hidden ? '••••' : `${position.unrealizedResultPercent.toFixed(2)}%`}
        </p>
      </div>
    </div>
  );
}

function EmptyState({
  text,
  action,
  onClick,
}: {
  text: string;
  action?: string;
  onClick?: () => void;
}) {
  return (
    <div className="rounded-xl border border-dashed border-white/10 p-6 text-center">
      <Wallet className="mx-auto text-white/20" size={26} />
      <p className="mt-3 text-xs text-white/40">{text}</p>
      {action && onClick && (
        <button
          type="button"
          onClick={onClick}
          className="mt-3 rounded-lg border border-white/10 px-3 py-2 text-xs font-bold text-white/65"
        >
          {action}
        </button>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  step,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  step?: string;
  placeholder?: string;
}) {
  return (
    <label className="block text-xs text-white/55">
      <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-white/35">
        {label}
      </span>
      <input
        type={type}
        step={step}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-xs text-white outline-none transition focus:border-cyan-300/40"
      />
    </label>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<[string, string]>;
}) {
  return (
    <label className="block text-xs text-white/55">
      <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-white/35">
        {label}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-xl border border-white/10 bg-[#090909] px-3 py-2.5 text-xs text-white outline-none transition focus:border-cyan-300/40"
      >
        {options.map(([optionValue, labelText]) => (
          <option key={optionValue} value={optionValue}>
            {labelText}
          </option>
        ))}
      </select>
    </label>
  );
}
