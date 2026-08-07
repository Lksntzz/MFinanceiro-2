import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, FileDown, Loader2, Search, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import * as XLSX from 'xlsx';

import { Transaction } from '../types';

interface HistoryProps {
  transactions: Transaction[];
  onEdit?: (transaction: Transaction) => void;
  onDelete?: (id: string) => void;
  onDeleteAll?: () => void;
  onToggleStatus?: (id: string, status: 'paid' | 'pending') => void;
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
};

type DayGroup = {
  key: string;
  label: string;
  items: LedgerTransaction[];
  income: number;
  expense: number;
  closingBalance?: number;
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

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function formatMoney(value: number): string {
  return Number(value || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

function signedAmount(transaction: LedgerTransaction): number {
  const amount = Number(transaction.amount || 0);
  if (!Number.isFinite(amount)) return 0;
  if (amount !== 0) return amount;
  return transaction.type === 'income' ? Math.abs(amount) : -Math.abs(amount);
}

function affectsCurrentBalance(transaction: LedgerTransaction): boolean {
  const status = normalize(transaction.status || 'paid');
  return !['pending', 'duplicate', 'error'].includes(status) && transaction.affects_balance !== false;
}

export default function History({
  transactions,
  onEdit,
  onDelete,
  onDeleteAll,
  onToggleStatus,
  currentBalance,
  balanceConfirmed = false,
  totalCount,
  hasMore,
  isLoadingMore = false,
  onLoadMore,
}: HistoryProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [expandedDays, setExpandedDays] = useState<Set<string>>(() => new Set());
  const ledgerTransactions = transactions as LedgerTransaction[];

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

    return { allNet, openingBase, dayClosing };
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
        const sortedItems = [...items].sort(
          (a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime(),
        );
        const parsed = key === 'sem-data' ? null : new Date(`${key}T12:00:00`);

        return {
          key,
          label: parsed
            ? format(parsed, "EEEE, dd 'de' MMMM", { locale: ptBR })
            : 'Sem data',
          items: sortedItems,
          income: sortedItems
            .filter((item) => item.type === 'income')
            .reduce((sum, item) => sum + Math.abs(Number(item.amount) || 0), 0),
          expense: sortedItems
            .filter((item) => item.type === 'expense')
            .reduce((sum, item) => sum + Math.abs(Number(item.amount) || 0), 0),
          closingBalance: key === 'sem-data' ? undefined : balanceState.dayClosing.get(key),
        };
      });
  }, [filteredTransactions, balanceState.dayClosing]);

  const summary = useMemo(() => {
    const realized = filteredTransactions.filter(affectsCurrentBalance);
    const income = realized
      .filter((item) => signedAmount(item) > 0)
      .reduce((sum, item) => sum + Math.abs(signedAmount(item)), 0);
    const expense = realized
      .filter((item) => signedAmount(item) < 0)
      .reduce((sum, item) => sum + Math.abs(signedAmount(item)), 0);

    return { income: roundMoney(income), expense: roundMoney(expense), net: roundMoney(income - expense) };
  }, [filteredTransactions]);

  const filteredDifference = roundMoney(currentBalance - summary.net);

  function toggleDay(key: string) {
    setExpandedDays((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function exportHistory() {
    if (!filteredTransactions.length) return;
    const realized = filteredTransactions.filter(affectsCurrentBalance);
    const income = roundMoney(realized.filter((row) => signedAmount(row) > 0).reduce((sum, row) => sum + Math.abs(signedAmount(row)), 0));
    const expense = roundMoney(realized.filter((row) => signedAmount(row) < 0).reduce((sum, row) => sum + Math.abs(signedAmount(row)), 0));
    const net = roundMoney(income - expense);
    const keys = filteredTransactions.map((row) => safeDateKey(row.date)).filter((key) => key !== 'sem-data').sort();
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
      ['Saldo atual', currentBalance],
      ['Base anterior/ajustes fora do histórico', balanceState.openingBase],
      ['Saldo confirmado pelo usuário', balanceConfirmed ? 'Sim' : 'Não'],
    ];

    const transactionRows = [...filteredTransactions]
      .sort((a, b) => safeDateKey(a.date).localeCompare(safeDateKey(b.date)) || String(a.id).localeCompare(String(b.id)))
      .map((row) => {
        const key = safeDateKey(row.date);
        const amount = signedAmount(row);
        return {
          Data: key !== 'sem-data' ? new Date(`${key}T12:00:00`).toLocaleDateString('pt-BR') : '',
          Descrição: row.description || '',
          Categoria: row.category || 'Geral',
          Tipo: amount >= 0 ? 'Entrada' : 'Saída',
          Valor: Math.abs(amount),
          Situação: normalize(row.status) === 'pending' ? 'Pendente' : 'Realizado',
          'Afeta saldo': row.affects_balance === false ? 'Não' : 'Sim',
          Origem: row.source || '',
          'Forma de pagamento': row.payment_method || '',
          'Saldo ao fim do dia': key !== 'sem-data' ? balanceState.dayClosing.get(key) ?? '' : '',
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

  return (
    <section className="history-shell flex h-full min-h-0 flex-col gap-3 overflow-hidden animate-fade-in">
      <div className="flex shrink-0 flex-col gap-2 lg:flex-row lg:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" size={16} />
          <input
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Buscar lançamento, categoria ou valor"
            className="w-full rounded-xl border border-white/10 bg-white/5 py-2 pl-9 pr-3 text-xs outline-none focus:border-brand-primary"
          />
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <select
            value={filterType}
            onChange={(event) => setFilterType(event.target.value as FilterType)}
            className="rounded-lg border border-white/10 bg-[#121212] px-3 py-2 text-xs outline-none"
          >
            <option value="all">Todos</option>
            <option value="income">Entradas</option>
            <option value="expense">Saídas</option>
          </select>

          <button
            type="button"
            onClick={exportHistory}
            disabled={filteredTransactions.length === 0}
            className="flex items-center gap-2 rounded-lg border border-brand-primary/20 bg-brand-primary/10 px-3 py-2 text-xs font-bold text-brand-primary disabled:opacity-40"
          >
            <FileDown size={14} /> Excel
          </button>

          {onDeleteAll && transactions.length > 0 && (
            <button
              type="button"
              onClick={onDeleteAll}
              className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs font-bold text-red-400"
            >
              <Trash2 size={14} /> Limpar
            </button>
          )}
        </div>
      </div>

      <div className="grid shrink-0 grid-cols-2 gap-2 lg:grid-cols-4">
        <div className="glass-card !p-3">
          <div className="text-[9px] font-bold uppercase text-white/40">Entradas realizadas</div>
          <div className="truncate text-sm font-bold text-green-400">{formatMoney(summary.income)}</div>
        </div>
        <div className="glass-card !p-3">
          <div className="text-[9px] font-bold uppercase text-white/40">Saídas realizadas</div>
          <div className="truncate text-sm font-bold">{formatMoney(summary.expense)}</div>
        </div>
        <div className="glass-card !p-3">
          <div className="text-[9px] font-bold uppercase text-white/40">Movimento líquido</div>
          <div className={`truncate text-sm font-bold ${summary.net >= 0 ? 'text-brand-primary' : 'text-red-400'}`}>
            {formatMoney(summary.net)}
          </div>
        </div>
        <div className="glass-card !p-3">
          <div className="text-[9px] font-bold uppercase text-white/40">Saldo atual</div>
          <div className="truncate text-sm font-bold text-brand-primary">{formatMoney(currentBalance)}</div>
        </div>
      </div>

      <div className="shrink-0 rounded-xl border border-brand-primary/15 bg-brand-primary/[0.055] px-3 py-2 text-[10px] leading-relaxed text-white/55">
        O <strong className="text-white/85">movimento líquido</strong> considera os lançamentos carregados no filtro atual. O <strong className="text-white/85">saldo atual</strong> é derivado das contas e está {balanceConfirmed ? 'confirmado pelo usuário' : 'aguardando conferência'}. Diferença entre saldo e filtro: <strong className="text-white/85">{formatMoney(filteredDifference)}</strong>. Base anterior aos {transactions.length} lançamentos carregados: <strong className="text-white/85">{formatMoney(balanceState.openingBase)}</strong>.
      </div>

      <div className="history-scroll flex-1 min-h-0 overflow-y-auto pr-1 no-scrollbar">
        <div className="space-y-2">
          {groups.map((group) => {
            const expanded = expandedDays.has(group.key);
            return (
              <article key={group.key} className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.03]">
                <button
                  type="button"
                  onClick={() => toggleDay(group.key)}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-white/5"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    <div className="min-w-0">
                      <div className="truncate text-xs font-bold capitalize">{group.label}</div>
                      <div className="text-[10px] text-white/40">{group.items.length} lançamentos</div>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap justify-end gap-3 text-[10px]">
                    {group.income > 0 && <span className="text-green-400">+{formatMoney(group.income)}</span>}
                    {group.expense > 0 && <span>-{formatMoney(group.expense)}</span>}
                    {group.closingBalance !== undefined && <span className="text-white/45">Saldo ao fim do dia: {formatMoney(group.closingBalance)}</span>}
                  </div>
                </button>

                {expanded && (
                  <div className="border-t border-white/10">
                    {group.items.map((transaction) => {
                      const content = (
                        <>
                          <div className="truncate text-xs font-semibold">
                            {transaction.description || transaction.category || 'Lançamento'}
                          </div>
                          <div className="truncate text-[10px] text-white/40">
                            {transaction.category || 'Geral'}
                            {transaction.source ? ` • ${transaction.source}` : ''}
                          </div>
                        </>
                      );

                      return (
                        <div
                          key={transaction.id}
                          className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-white/5 px-4 py-2 last:border-b-0 hover:bg-white/[0.03]"
                        >
                          {onEdit ? (
                            <button type="button" onClick={() => onEdit(transaction)} className="min-w-0 text-left">
                              {content}
                            </button>
                          ) : (
                            <div className="min-w-0">{content}</div>
                          )}

                          <div className="flex items-center gap-3">
                            {onToggleStatus ? (
                              <button
                                type="button"
                                onClick={() => onToggleStatus(
                                  transaction.id,
                                  transaction.status === 'paid' ? 'pending' : 'paid',
                                )}
                                className="text-[10px] text-white/40 hover:text-brand-primary"
                              >
                                {transaction.status === 'pending' ? 'Pendente' : 'Pago'}
                              </button>
                            ) : transaction.status ? (
                              <span className="text-[10px] text-white/30">
                                {transaction.status === 'pending' ? 'Pendente' : 'Pago'}
                              </span>
                            ) : null}

                            <div className={`min-w-[96px] text-right text-xs font-bold ${transaction.type === 'income' ? 'text-green-400' : ''}`}>
                              {transaction.type === 'income' ? '+' : '-'} {formatMoney(Math.abs(Number(transaction.amount) || 0))}
                            </div>

                            {onDelete && (
                              <button
                                type="button"
                                onClick={() => onDelete(transaction.id)}
                                className="text-white/20 hover:text-red-400"
                                aria-label="Excluir lançamento"
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </article>
            );
          })}

          {groups.length === 0 && (
            <div className="flex h-32 items-center justify-center text-xs text-white/30">
              Nenhum lançamento encontrado.
            </div>
          )}

          <div className="flex flex-col items-center gap-2 py-3 text-[10px] text-white/35">
            <span>{transactions.length} de {totalCount} lançamentos carregados</span>
            {hasMore && (
              <button
                type="button"
                onClick={() => void onLoadMore()}
                disabled={isLoadingMore}
                className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-xs font-bold text-white/70 hover:bg-white/10 disabled:opacity-45"
              >
                {isLoadingMore && <Loader2 size={14} className="animate-spin" />}
                {isLoadingMore ? 'Carregando...' : 'Carregar mais lançamentos'}
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
