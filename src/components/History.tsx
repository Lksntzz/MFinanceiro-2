import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, FileDown, Search, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Transaction } from '../types';
import { ReportService } from '../services/reportService';

interface HistoryProps {
  transactions: Transaction[];
  onEdit?: (transaction: Transaction) => void;
  onDelete?: (id: string) => void;
  onDeleteAll?: () => void;
  onToggleStatus?: (id: string, status: 'paid' | 'pending') => void;
}

type FilterType = 'all' | 'income' | 'expense';

type DayGroup = {
  key: string;
  label: string;
  items: Transaction[];
  income: number;
  expense: number;
};

function safeDateKey(raw: string | undefined): string {
  if (!raw) return 'sem-data';
  return raw.includes('T') ? raw.split('T')[0] : raw.slice(0, 10);
}

function formatMoney(value: number): string {
  return value.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

export default function History({
  transactions,
  onEdit,
  onDelete,
  onDeleteAll,
  onToggleStatus,
}: HistoryProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [expandedDays, setExpandedDays] = useState<Set<string>>(() => new Set());

  const filteredTransactions = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();
    return transactions.filter((transaction) => {
      const matchesType = filterType === 'all' || transaction.type === filterType;
      if (!matchesType) return false;
      if (!search) return true;

      const searchable = [
        transaction.description,
        transaction.category,
        transaction.source,
        String(transaction.amount),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return searchable.includes(search);
    });
  }, [transactions, searchTerm, filterType]);

  const groups = useMemo<DayGroup[]>(() => {
    const grouped = new Map<string, Transaction[]>();

    for (const transaction of filteredTransactions) {
      const key = safeDateKey(transaction.date);
      const current = grouped.get(key) ?? [];
      current.push(transaction);
      grouped.set(key, current);
    }

    return [...grouped.entries()]
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([key, items]) => {
        const sortedItems = [...items].sort(
          (a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime(),
        );
        const parsed = key === 'sem-data' ? null : new Date(`${key}T12:00:00`);
        const label = parsed
          ? format(parsed, "EEEE, dd 'de' MMMM", { locale: ptBR })
          : 'Sem data';

        return {
          key,
          label,
          items: sortedItems,
          income: sortedItems
            .filter((item) => item.type === 'income')
            .reduce((sum, item) => sum + Math.abs(Number(item.amount) || 0), 0),
          expense: sortedItems
            .filter((item) => item.type === 'expense')
            .reduce((sum, item) => sum + Math.abs(Number(item.amount) || 0), 0),
        };
      });
  }, [filteredTransactions]);

  const summary = useMemo(() => {
    const income = filteredTransactions
      .filter((item) => item.type === 'income')
      .reduce((sum, item) => sum + Math.abs(Number(item.amount) || 0), 0);
    const expense = filteredTransactions
      .filter((item) => item.type === 'expense')
      .reduce((sum, item) => sum + Math.abs(Number(item.amount) || 0), 0);

    return { income, expense, balance: income - expense };
  }, [filteredTransactions]);

  function toggleDay(key: string) {
    setExpandedDays((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
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
            onClick={() => ReportService.exportTransactionsToExcel(filteredTransactions)}
            className="flex items-center gap-2 rounded-lg border border-brand-primary/20 bg-brand-primary/10 px-3 py-2 text-xs font-bold text-brand-primary"
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

      <div className="grid shrink-0 grid-cols-3 gap-2">
        <div className="glass-card !p-3">
          <div className="text-[9px] font-bold uppercase text-white/40">Entradas</div>
          <div className="truncate text-sm font-bold text-green-400">{formatMoney(summary.income)}</div>
        </div>
        <div className="glass-card !p-3">
          <div className="text-[9px] font-bold uppercase text-white/40">Saídas</div>
          <div className="truncate text-sm font-bold">{formatMoney(summary.expense)}</div>
        </div>
        <div className="glass-card !p-3">
          <div className="text-[9px] font-bold uppercase text-white/40">Saldo</div>
          <div className={`truncate text-sm font-bold ${summary.balance >= 0 ? 'text-brand-primary' : 'text-red-400'}`}>
            {formatMoney(summary.balance)}
          </div>
        </div>
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
                  <div className="flex shrink-0 gap-3 text-[10px]">
                    {group.income > 0 && <span className="text-green-400">+{formatMoney(group.income)}</span>}
                    {group.expense > 0 && <span>-{formatMoney(group.expense)}</span>}
                  </div>
                </button>

                {expanded && (
                  <div className="border-t border-white/10">
                    {group.items.map((transaction) => (
                      <div
                        key={transaction.id}
                        className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-white/5 px-4 py-2 last:border-b-0 hover:bg-white/[0.03]"
                      >
                        <button
                          type="button"
                          onClick={() => onEdit?.(transaction)}
                          className="min-w-0 text-left"
                        >
                          <div className="truncate text-xs font-semibold">
                            {transaction.description || transaction.category || 'Lançamento'}
                          </div>
                          <div className="truncate text-[10px] text-white/40">
                            {transaction.category || 'Geral'}
                            {transaction.source ? ` • ${transaction.source}` : ''}
                          </div>
                        </button>

                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            onClick={() => onToggleStatus?.(
                              transaction.id,
                              transaction.status === 'paid' ? 'pending' : 'paid',
                            )}
                            className="text-[10px] text-white/40 hover:text-brand-primary"
                          >
                            {transaction.status === 'pending' ? 'Pendente' : 'Pago'}
                          </button>
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
                    ))}
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
        </div>
      </div>
    </section>
  );
}
