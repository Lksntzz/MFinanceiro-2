import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, FileDown, Loader2, Search, Trash2, WandSparkles } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useNavigate, useSearchParams } from 'react-router';

import { supabase } from '../lib/supabase';
import { downloadXlsx } from '../lib/xlsx-export';
import { Transaction } from '../types';

interface HistoryProps {
  userId: string;
  transactions: Transaction[];
  onEdit?: (transaction: Transaction) => void;
  onDelete?: (id: string) => void;
  /** @deprecated Bulk deletion is intentionally ignored by the normal product UI. */
  onDeleteAll?: () => void;
  onToggleStatus?: (id: string, status: 'paid' | 'pending') => void;
  onDataChanged?: () => void | Promise<void>;
  currentBalance: number;
  balanceConfirmed?: boolean;
  totalCount: number;
  hasMore: boolean;
  isLoadingMore?: boolean;
  onLoadMore: () => Promise<void>;
}

type FilterType = 'all' | 'income' | 'expense';
type LedgerTransaction = Transaction & {
  affects_balance?: boolean | null;
  payment_method?: string | null;
  account_id?: string | null;
};

type DayGroup = {
  key: string;
  label: string;
  items: LedgerTransaction[];
  income: number;
  expense: number;
  closingBalance?: number;
};

type CategorizationPreview = {
  entry_id?: string | null;
  rule_id?: string | null;
  category_id?: string | null;
  category_name?: string | null;
};

function safeDateKey(raw: string | undefined): string {
  if (!raw) return 'sem-data';
  const key = raw.includes('T') ? raw.split('T')[0] : raw.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : 'sem-data';
}

function normalize(value: string | null | undefined): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function isGenericCategory(value: string | null | undefined): boolean {
  return ['', 'geral', 'outros', 'sem categoria'].includes(normalize(value));
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function formatMoney(value: number): string {
  return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function signedAmount(transaction: LedgerTransaction): number {
  const amount = Number(transaction.amount || 0);
  if (!Number.isFinite(amount)) return 0;
  return transaction.type === 'income' ? Math.abs(amount) : -Math.abs(amount);
}

function affectsCurrentBalance(transaction: LedgerTransaction): boolean {
  const status = normalize(transaction.status || 'paid');
  return !['pending', 'duplicate', 'error'].includes(status) && transaction.affects_balance !== false;
}

function chunk<T>(items: T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let index = 0; index < items.length; index += size) groups.push(items.slice(index, index + size));
  return groups;
}

export default function History({
  userId,
  transactions,
  onEdit,
  onDelete,
  onToggleStatus,
  onDataChanged,
  currentBalance,
  balanceConfirmed = false,
  totalCount,
  hasMore,
  isLoadingMore = false,
  onLoadMore,
}: HistoryProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [expandedDays, setExpandedDays] = useState<Set<string>>(() => new Set());
  const [organizing, setOrganizing] = useState(false);
  const [organizerMessage, setOrganizerMessage] = useState<string | null>(null);
  const ledgerTransactions = transactions as LedgerTransaction[];
  const assistantOpen = searchParams.get('assist') === 'categorias';

  const filteredTransactions = useMemo(() => {
    const search = normalize(searchTerm);
    return ledgerTransactions.filter((transaction) => {
      if (filterType !== 'all' && transaction.type !== filterType) return false;
      if (!search) return true;
      return normalize([
        transaction.description,
        transaction.category,
        transaction.source,
        String(transaction.amount),
      ].filter(Boolean).join(' ')).includes(search);
    });
  }, [ledgerTransactions, searchTerm, filterType]);

  const balanceState = useMemo(() => {
    const realized = ledgerTransactions.filter(affectsCurrentBalance);
    const allNet = roundMoney(realized.reduce((sum, transaction) => sum + signedAmount(transaction), 0));
    const openingBase = roundMoney(currentBalance - allNet);
    const byDay = new Map<string, number>();

    realized.forEach((transaction) => {
      const key = safeDateKey(transaction.date);
      if (key === 'sem-data') return;
      byDay.set(key, roundMoney((byDay.get(key) || 0) + signedAmount(transaction)));
    });

    const dayClosing = new Map<string, number>();
    let running = currentBalance;
    [...byDay.keys()].sort((a, b) => b.localeCompare(a)).forEach((key) => {
      dayClosing.set(key, roundMoney(running));
      running = roundMoney(running - (byDay.get(key) || 0));
    });

    return { openingBase, dayClosing };
  }, [ledgerTransactions, currentBalance]);

  const groups = useMemo<DayGroup[]>(() => {
    const grouped = new Map<string, LedgerTransaction[]>();
    filteredTransactions.forEach((transaction) => {
      const key = safeDateKey(transaction.date);
      grouped.set(key, [...(grouped.get(key) || []), transaction]);
    });

    return [...grouped.entries()]
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([key, items]) => {
        const parsed = key === 'sem-data' ? null : new Date(`${key}T12:00:00`);
        return {
          key,
          label: parsed ? format(parsed, "EEEE, dd 'de' MMMM", { locale: ptBR }) : 'Sem data',
          items: [...items].sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime()),
          income: items.filter((item) => item.type === 'income').reduce((sum, item) => sum + Math.abs(Number(item.amount) || 0), 0),
          expense: items.filter((item) => item.type === 'expense').reduce((sum, item) => sum + Math.abs(Number(item.amount) || 0), 0),
          closingBalance: key === 'sem-data' ? undefined : balanceState.dayClosing.get(key),
        };
      });
  }, [filteredTransactions, balanceState.dayClosing]);

  const summary = useMemo(() => {
    const realized = filteredTransactions.filter(affectsCurrentBalance);
    const income = realized.filter((item) => signedAmount(item) > 0).reduce((sum, item) => sum + Math.abs(signedAmount(item)), 0);
    const expense = realized.filter((item) => signedAmount(item) < 0).reduce((sum, item) => sum + Math.abs(signedAmount(item)), 0);
    return { income: roundMoney(income), expense: roundMoney(expense), net: roundMoney(income - expense) };
  }, [filteredTransactions]);

  function toggleDay(key: string) {
    setExpandedDays((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  async function organizeGenericCategories() {
    if (organizing) return;
    setOrganizing(true);
    setOrganizerMessage(null);
    try {
      const { data, error: loadError } = await supabase
        .from('mf_finance_ledger_entries')
        .select('id,description,source,type,amount,account_id,category')
        .eq('user_id', userId)
        .order('date', { ascending: false })
        .limit(2000);
      if (loadError) throw loadError;

      const candidates = (data || []).filter((entry: any) => isGenericCategory(entry.category));
      if (!candidates.length) {
        setOrganizerMessage('Não há lançamentos genéricos para organizar agora.');
        return;
      }

      const { data: previewData, error: previewError } = await supabase.rpc('mf_preview_categorization_rules', {
        p_entries: candidates.map((entry: any) => ({
          id: entry.id,
          description: entry.description || '',
          source: entry.source || '',
          type: entry.type,
          amount: Number(entry.amount || 0),
          account_id: entry.account_id || null,
        })),
      });
      if (previewError) throw previewError;

      const matches = ((previewData || []) as CategorizationPreview[]).filter((item) => item.entry_id && item.rule_id && item.category_id && item.category_name);
      if (!matches.length) {
        setOrganizerMessage(`Encontrei ${candidates.length} lançamento${candidates.length === 1 ? '' : 's'} genérico${candidates.length === 1 ? '' : 's'}, mas nenhuma regra automática segura se aplica ainda. Crie uma regra para o MF poder organizar em lote.`);
        return;
      }

      const byCategory = new Map<string, { categoryId: string; categoryName: string; ids: string[] }>();
      matches.forEach((match) => {
        const categoryId = String(match.category_id);
        const categoryName = String(match.category_name);
        const key = `${categoryId}:${categoryName}`;
        const current = byCategory.get(key) || { categoryId, categoryName, ids: [] };
        current.ids.push(String(match.entry_id));
        byCategory.set(key, current);
      });

      let updated = 0;
      for (const group of byCategory.values()) {
        for (const ids of chunk(group.ids, 100)) {
          const { error: updateError } = await supabase
            .from('mf_finance_ledger_entries')
            .update({ category_id: group.categoryId, category: group.categoryName, categoria: group.categoryName })
            .eq('user_id', userId)
            .in('id', ids);
          if (updateError) throw updateError;
          updated += ids.length;
        }
      }

      window.dispatchEvent(new CustomEvent('mf:finance-data-changed'));
      await onDataChanged?.();
      const pending = candidates.length - updated;
      setOrganizerMessage(`${updated} lançamento${updated === 1 ? '' : 's'} organizado${updated === 1 ? '' : 's'} pelas suas regras automáticas.${pending > 0 ? ` ${pending} continuam genéricos porque ainda não há regra segura para eles.` : ''}`);
    } catch (error) {
      setOrganizerMessage(error instanceof Error ? error.message : 'Não foi possível organizar os lançamentos genéricos.');
    } finally {
      setOrganizing(false);
    }
  }

  async function exportHistory() {
    if (!filteredTransactions.length) return;
    const rows = filteredTransactions.map((row) => [
      safeDateKey(row.date) === 'sem-data' ? '' : safeDateKey(row.date),
      row.description || '',
      row.category || 'Geral',
      row.type === 'income' ? 'Entrada' : 'Saída',
      Math.abs(Number(row.amount) || 0),
      normalize(row.status) === 'pending' ? 'Pendente' : 'Realizado',
      row.source || '',
    ]);
    await downloadXlsx(`MFinanceiro_Historico_${new Date().toISOString().slice(0, 10)}.xlsx`, [{
      name: 'Lançamentos',
      rows: [['Data', 'Descrição', 'Categoria', 'Tipo', 'Valor', 'Situação', 'Origem'], ...rows],
      columnWidths: [13, 38, 22, 12, 14, 14, 18],
    }]);
  }

  return (
    <section className="history-shell flex h-full min-h-0 flex-col gap-3 overflow-hidden animate-fade-in">
      <div className="flex shrink-0 flex-col gap-2 lg:flex-row lg:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" size={16} />
          <input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Buscar lançamento, categoria ou valor" className="w-full rounded-xl border border-white/10 bg-white/5 py-2 pl-9 pr-3 text-xs outline-none focus:border-brand-primary" />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <select value={filterType} onChange={(event) => setFilterType(event.target.value as FilterType)} className="rounded-lg border border-white/10 bg-[#121212] px-3 py-2 text-xs outline-none">
            <option value="all">Todos</option><option value="income">Entradas</option><option value="expense">Saídas</option>
          </select>
          <button type="button" onClick={() => void exportHistory()} disabled={!filteredTransactions.length} className="flex items-center gap-2 rounded-lg border border-brand-primary/20 bg-brand-primary/10 px-3 py-2 text-xs font-bold text-brand-primary disabled:opacity-40"><FileDown size={14} /> Excel</button>
        </div>
      </div>

      {assistantOpen && <div className="shrink-0 rounded-xl border border-amber-400/20 bg-amber-400/[0.055] px-4 py-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-start gap-3"><WandSparkles size={17} className="mt-0.5 shrink-0 text-amber-300" /><div><strong className="text-xs text-white/85">Organizar lançamentos genéricos</strong><p className="mt-1 text-[10px] leading-relaxed text-white/45">O MF testa suas regras de categorização e aplica em lote somente correspondências determinísticas. Nenhum lançamento é classificado por palpite.</p>{organizerMessage && <p className="mt-2 text-[10px] font-semibold text-amber-100/80" role="status">{organizerMessage}</p>}</div></div>
          <div className="flex shrink-0 gap-2"><button type="button" onClick={() => navigate('/app/integracoes')} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[9px] font-black uppercase tracking-wider text-white/60">Criar regras</button><button type="button" onClick={() => void organizeGenericCategories()} disabled={organizing} className="flex items-center gap-2 rounded-lg bg-amber-300 px-3 py-2 text-[9px] font-black uppercase tracking-wider text-black disabled:opacity-50">{organizing && <Loader2 size={12} className="animate-spin" />}{organizing ? 'Organizando…' : 'Aplicar regras'}</button></div>
        </div>
      </div>}

      <div className="grid shrink-0 grid-cols-2 gap-2 lg:grid-cols-4">
        <div className="glass-card !p-3"><div className="text-[9px] font-bold uppercase text-white/40">Entradas realizadas</div><div className="truncate text-sm font-bold text-green-400">{formatMoney(summary.income)}</div></div>
        <div className="glass-card !p-3"><div className="text-[9px] font-bold uppercase text-white/40">Saídas realizadas</div><div className="truncate text-sm font-bold">{formatMoney(summary.expense)}</div></div>
        <div className="glass-card !p-3"><div className="text-[9px] font-bold uppercase text-white/40">Movimento líquido</div><div className={`truncate text-sm font-bold ${summary.net >= 0 ? 'text-brand-primary' : 'text-red-400'}`}>{formatMoney(summary.net)}</div></div>
        <div className="glass-card !p-3"><div className="text-[9px] font-bold uppercase text-white/40">Saldo atual</div><div className="truncate text-sm font-bold text-brand-primary">{formatMoney(currentBalance)}</div></div>
      </div>

      <div className="shrink-0 rounded-xl border border-brand-primary/15 bg-brand-primary/[0.055] px-3 py-2 text-[10px] leading-relaxed text-white/55">
        O saldo atual é derivado das contas e está {balanceConfirmed ? 'confirmado pelo usuário' : 'aguardando conferência'}. Base anterior aos {transactions.length} lançamentos carregados: <strong className="text-white/85">{formatMoney(balanceState.openingBase)}</strong>.
      </div>

      <div className="history-scroll min-h-0 flex-1 overflow-y-auto pr-1 no-scrollbar">
        <div className="space-y-2">
          {groups.map((group) => {
            const expanded = expandedDays.has(group.key);
            return (
              <article key={group.key} className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.03]">
                <button type="button" onClick={() => toggleDay(group.key)} className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-white/5">
                  <div className="flex min-w-0 items-center gap-2">{expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}<div className="min-w-0"><div className="truncate text-xs font-bold capitalize">{group.label}</div><div className="text-[10px] text-white/40">{group.items.length} lançamentos</div></div></div>
                  <div className="flex shrink-0 flex-wrap justify-end gap-3 text-[10px]">{group.income > 0 && <span className="text-green-400">+{formatMoney(group.income)}</span>}{group.expense > 0 && <span>-{formatMoney(group.expense)}</span>}{group.closingBalance !== undefined && <span className="text-white/45">Saldo: {formatMoney(group.closingBalance)}</span>}</div>
                </button>
                {expanded && <div className="border-t border-white/10">{group.items.map((transaction) => (
                  <div key={transaction.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-white/5 px-4 py-2 last:border-b-0 hover:bg-white/[0.03]">
                    {onEdit ? <button type="button" onClick={() => onEdit(transaction)} className="min-w-0 text-left"><div className="truncate text-xs font-semibold">{transaction.description || transaction.category || 'Lançamento'}</div><div className="truncate text-[10px] text-white/40">{transaction.category || 'Geral'}{transaction.source ? ` • ${transaction.source}` : ''}</div></button> : <div className="min-w-0"><div className="truncate text-xs font-semibold">{transaction.description || transaction.category || 'Lançamento'}</div><div className="truncate text-[10px] text-white/40">{transaction.category || 'Geral'}{transaction.source ? ` • ${transaction.source}` : ''}</div></div>}
                    <div className="flex items-center gap-3">
                      {onToggleStatus ? <button type="button" onClick={() => onToggleStatus(transaction.id, transaction.status === 'paid' ? 'pending' : 'paid')} className="text-[10px] text-white/40 hover:text-brand-primary">{transaction.status === 'pending' ? 'Pendente' : 'Pago'}</button> : null}
                      <div className={`min-w-[96px] text-right text-xs font-bold ${transaction.type === 'income' ? 'text-green-400' : ''}`}>{transaction.type === 'income' ? '+' : '-'} {formatMoney(Math.abs(Number(transaction.amount) || 0))}</div>
                      {onDelete && <button type="button" onClick={() => onDelete(transaction.id)} className="text-white/20 hover:text-red-400" aria-label="Excluir lançamento"><Trash2 size={14} /></button>}
                    </div>
                  </div>
                ))}</div>}
              </article>
            );
          })}

          {!groups.length && <div className="flex h-32 items-center justify-center text-xs text-white/30">Nenhum lançamento encontrado.</div>}
          <div className="flex flex-col items-center gap-2 py-3 text-[10px] text-white/35">
            <span>{transactions.length} de {totalCount} lançamentos carregados</span>
            {hasMore && <button type="button" onClick={() => void onLoadMore()} disabled={isLoadingMore} className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-xs font-bold text-white/70 hover:bg-white/10 disabled:opacity-45">{isLoadingMore && <Loader2 size={14} className="animate-spin" />}{isLoadingMore ? 'Carregando...' : 'Carregar mais lançamentos'}</button>}
          </div>
        </div>
      </div>
    </section>
  );
}
