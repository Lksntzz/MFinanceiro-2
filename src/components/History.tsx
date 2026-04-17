
import React, { useState, useMemo } from 'react';
import { Transaction } from '../types';
import { format, startOfWeek, isSameDay, isSameWeek, isSameMonth } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { 
  Search, 
  Filter, 
  ArrowUpRight, 
  ArrowDownRight, 
  MoreVertical, 
  Calendar as CalendarIcon,
  Tag,
  CreditCard,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Circle,
  Trash2,
  LayoutGrid,
  List
} from 'lucide-react';

interface HistoryProps {
  transactions: Transaction[];
  onEdit?: (t: Transaction) => void;
  onDelete?: (id: string) => void;
  onDeleteAll?: () => void;
  onToggleStatus?: (id: string, status: 'paid' | 'pending') => void;
}

export default function History({ transactions, onEdit, onDelete, onDeleteAll, onToggleStatus }: HistoryProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'income' | 'expense'>('all');
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'paid' | 'pending'>('all');
  const [groupBy, setGroupBy] = useState<'none' | 'day' | 'week' | 'month'>('day');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 50; // Increased for grouped view

  // Categories for filter
  const categories = useMemo(() => {
    return ['all', ...new Set(transactions.map(t => t.category))];
  }, [transactions]);

  // Filtered transactions
  const filteredTransactions = useMemo(() => {
    return transactions.filter(t => {
      const matchesSearch = (t.description || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                          t.category.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          t.amount.toString().includes(searchTerm);
      const matchesType = filterType === 'all' || t.type === filterType;
      const matchesCategory = filterCategory === 'all' || t.category === filterCategory;
      const matchesStatus = filterStatus === 'all' || t.status === filterStatus;
      return matchesSearch && matchesType && matchesCategory && matchesStatus;
    });
  }, [transactions, searchTerm, filterType, filterCategory, filterStatus]);

  // Grouping logic
  const groupedTransactions = useMemo(() => {
    if (groupBy === 'none') return [{ title: 'Todos', items: filteredTransactions }];

    const groups: Record<string, Transaction[]> = {};
    filteredTransactions.forEach(t => {
      let key = '';
      const dateStr = t.date.includes('T') ? t.date.split('T')[0] : t.date;
      const date = new Date(dateStr + 'T12:00:00');

      if (groupBy === 'day') key = dateStr;
      else if (groupBy === 'week') {
        const sw = startOfWeek(date, { locale: ptBR, weekStartsOn: 0 });
        key = format(sw, 'yyyy-MM-dd');
      }
      else if (groupBy === 'month') key = format(date, 'yyyy-MM');

      if (!groups[key]) groups[key] = [];
      groups[key].push(t);
    });

    return Object.entries(groups)
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([key, items]) => {
        let title = key;
        if (groupBy === 'day') title = format(new Date(key + 'T12:00:00'), "dd 'de' MMMM", { locale: ptBR });
        else if (groupBy === 'week') title = `Semana de ${format(new Date(key + 'T12:00:00'), 'dd/MM')}`;
        else if (groupBy === 'month') title = format(new Date(key + '-01T12:00:00'), 'MMMM yyyy', { locale: ptBR });
        return { title, items: items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()) };
      });
  }, [filteredTransactions, groupBy]);

  // Pagination for grouped transactions or flat
  const totalPages = Math.ceil(filteredTransactions.length / itemsPerPage);
  
  const paginatedItems = useMemo(() => {
    return filteredTransactions.slice(
      (currentPage - 1) * itemsPerPage,
      currentPage * itemsPerPage
    );
  }, [filteredTransactions, currentPage, itemsPerPage]);

  const paginatedGroups = useMemo(() => {
    const items = paginatedItems;
    if (items.length === 0) return [];
    if (groupBy === 'none') return [{ title: 'Lançamentos', items }];

    const groups: Record<string, Transaction[]> = {};
    items.forEach(t => {
      let key = '';
      const dateStr = t.date.includes('T') ? t.date.split('T')[0] : t.date;
      const date = new Date(dateStr + 'T12:00:00');

      if (groupBy === 'day') key = dateStr;
      else if (groupBy === 'week') key = format(startOfWeek(date, { locale: ptBR, weekStartsOn: 0 }), 'yyyy-MM-dd');
      else if (groupBy === 'month') key = format(date, 'yyyy-MM');

      if (!groups[key]) groups[key] = [];
      groups[key].push(t);
    });

    return Object.entries(groups)
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([key, items]) => {
        let title = key;
        if (groupBy === 'day') title = format(new Date(key + 'T12:00:00'), "dd 'de' MMMM", { locale: ptBR });
        else if (groupBy === 'week') title = `Semana de ${format(new Date(key + 'T12:00:00'), 'dd/MM')}`;
        else if (groupBy === 'month') title = format(new Date(key + '-01T12:00:00'), 'MMMM yyyy', { locale: ptBR });
        return { title, items };
      });
  }, [paginatedItems, groupBy]);

  // Summary for filtered period
  const summary = useMemo(() => {
    const income = filteredTransactions.filter(t => t.type === 'income').reduce((sum, t) => sum + t.amount, 0);
    const expense = filteredTransactions.filter(t => t.type === 'expense').reduce((sum, t) => sum + Math.abs(t.amount), 0);
    return { income, expense, balance: income - expense, count: filteredTransactions.length };
  }, [filteredTransactions]);

  return (
    <div className="flex-1 flex flex-col gap-4 overflow-hidden animate-fade-in">
      {/* Filters & Search */}
      <div className="glass-card !p-4 flex flex-wrap items-center gap-4 shrink-0">
        <div className="flex-1 min-w-[200px] relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" size={18} />
          <input 
            type="text" 
            placeholder="Buscar descrição, categoria ou valor..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-xl py-2 pl-10 pr-4 outline-none focus:border-brand-primary transition-all text-sm"
          />
        </div>
        
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 p-1 bg-white/5 rounded-lg border border-white/10 mr-2">
            <button 
              onClick={() => { setGroupBy('day'); setCurrentPage(1); }}
              className={`px-3 py-1 text-[10px] font-bold rounded-md transition-all ${groupBy === 'day' ? 'bg-brand-primary text-black' : 'text-white/40 hover:text-white'}`}
            >
              Dia
            </button>
            <button 
              onClick={() => { setGroupBy('week'); setCurrentPage(1); }}
              className={`px-3 py-1 text-[10px] font-bold rounded-md transition-all ${groupBy === 'week' ? 'bg-brand-primary text-black' : 'text-white/40 hover:text-white'}`}
            >
              Semana
            </button>
            <button 
              onClick={() => { setGroupBy('month'); setCurrentPage(1); }}
              className={`px-3 py-1 text-[10px] font-bold rounded-md transition-all ${groupBy === 'month' ? 'bg-brand-primary text-black' : 'text-white/40 hover:text-white'}`}
            >
              Mês
            </button>
            <button 
              onClick={() => { setGroupBy('none'); setCurrentPage(1); }}
              className={`px-3 py-1 text-[10px] font-bold rounded-md transition-all ${groupBy === 'none' ? 'bg-brand-primary text-black' : 'text-white/40 hover:text-white'}`}
            >
              Total
            </button>
          </div>

          <Filter size={16} className="text-white/40" />
          <select 
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as any)}
            className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs outline-none focus:border-brand-primary"
          >
            <option value="all">Tipos</option>
            <option value="income">Entradas</option>
            <option value="expense">Saídas</option>
          </select>

          <select 
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs outline-none focus:border-brand-primary max-w-[120px]"
          >
            <option value="all">Categorias</option>
            {categories.filter(c => c !== 'all').map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>

          {onDeleteAll && transactions.length > 0 && (
            <button 
              onClick={() => onDeleteAll()}
              className="flex items-center gap-2 px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg text-xs font-bold border border-red-500/20 transition-all ml-2"
            >
              <Trash2 size={14} />
              Apagar Tudo
            </button>
          )}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-4 shrink-0">
        <div className="glass-card !p-3 flex flex-col justify-between border-green-500/20">
          <span className="text-[10px] text-white/40 uppercase font-bold">Entradas</span>
          <div className="text-lg font-bold text-green-400">R$ {summary.income.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
        </div>
        <div className="glass-card !p-3 flex flex-col justify-between border-red-500/20">
          <span className="text-[10px] text-white/40 uppercase font-bold">Saídas</span>
          <div className="text-lg font-bold text-white">R$ {summary.expense.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
        </div>
        <div className="glass-card !p-3 flex flex-col justify-between">
          <span className="text-[10px] text-white/40 uppercase font-bold">Saldo do Período</span>
          <div className={`text-lg font-bold ${summary.balance >= 0 ? 'text-brand-primary' : 'text-red-400'}`}>
            R$ {summary.balance.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
          </div>
        </div>
        <div className="glass-card !p-3 flex flex-col justify-between">
          <span className="text-[10px] text-white/40 uppercase font-bold">Lançamentos</span>
          <div className="text-lg font-bold">{summary.count} itens</div>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 glass-card !p-0 overflow-hidden flex flex-col">
        <div className="overflow-x-auto overflow-y-auto no-scrollbar flex-1">
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 bg-[#1a1a1a] z-10">
              <tr className="border-b border-white/5">
                <th className="p-4 text-[10px] uppercase text-white/40 font-bold">Lançamento</th>
                <th className="p-4 text-[10px] uppercase text-white/40 font-bold">Categoria</th>
                <th className="p-4 text-[10px] uppercase text-white/40 font-bold">Origem</th>
                <th className="p-4 text-[10px] uppercase text-white/40 font-bold text-right">Valor</th>
                <th className="p-4 text-[10px] uppercase text-white/40 font-bold text-center">Status</th>
                <th className="p-4 text-[10px] uppercase text-white/40 font-bold text-center">Ações</th>
              </tr>
            </thead>
            <tbody>
              {paginatedGroups.map((group) => (
                <React.Fragment key={group.title}>
                  {groupBy !== 'none' && (
                    <tr className="bg-white/[0.02]">
                      <td colSpan={6} className="p-2 px-4 text-[10px] font-bold text-white/40 uppercase tracking-wider border-y border-white/5 bg-[#121212]">
                        {group.title}
                      </td>
                    </tr>
                  )}
                  {group.items.map((t) => (
                    <tr key={t.id} className="border-b border-white/5 hover:bg-white/5 transition-colors group">
                      <td className="p-4">
                        <div className="flex flex-col">
                          <span className="text-sm font-medium">{t.description || t.category}</span>
                          <span className="text-[10px] text-white/40">
                            {(() => {
                              try {
                                const dateStr = t.date.includes('T') ? t.date.split('T')[0] : t.date;
                                return format(new Date(dateStr + 'T12:00:00'), 'dd MMM yyyy', { locale: ptBR });
                              } catch {
                                return '??/??/????';
                              }
                            })()}
                          </span>
                        </div>
                      </td>
                      <td className="p-4">
                        <span className="text-[10px] px-2 py-1 bg-white/5 rounded-full border border-white/10 text-white/60">
                          {t.category}
                        </span>
                      </td>
                      <td className="p-4 text-sm text-white/40 flex items-center gap-2 h-full py-6">
                        <CreditCard size={14} />
                        <span className="truncate max-w-[80px]">{t.source || 'Principal'}</span>
                      </td>
                      <td className={`p-4 text-sm font-bold text-right ${t.type === 'income' ? 'text-green-400' : 'text-white'}`}>
                        {t.type === 'income' ? '+' : '-'} R$ {Math.abs(t.amount).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="p-4 text-center">
                        <button 
                          onClick={() => onToggleStatus?.(t.id, t.status === 'paid' ? 'pending' : 'paid')}
                          className={`p-1 transition-colors ${t.status === 'paid' ? 'text-green-500' : 'text-white/20 hover:text-white'}`}
                        >
                          {t.status === 'paid' ? <CheckCircle2 size={18} /> : <Circle size={18} />}
                        </button>
                      </td>
                      <td className="p-4 text-center">
                        <div className="flex items-center justify-center gap-1 opacity-100 lg:opacity-0 group-hover:opacity-100 transition-opacity">
                          <button 
                            onClick={() => onDelete?.(t.id)}
                            className="p-1.5 text-white/20 hover:text-red-400 transition-colors"
                            title="Excluir lançamento"
                          >
                            <Trash2 size={16} />
                          </button>
                          <button className="p-1.5 text-white/20 hover:text-white transition-colors">
                            <MoreVertical size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </React.Fragment>
              ))}
              {paginatedGroups.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-12 text-center text-white/40">
                    Nenhum lançamento encontrado com os filtros atuais.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        {totalPages > 1 && (
          <div className="p-4 border-t border-white/5 flex items-center justify-between bg-white/5 shrink-0">
            <span className="text-xs text-white/40">
              Mostrando {(currentPage - 1) * itemsPerPage + 1} - {Math.min(currentPage * itemsPerPage, filteredTransactions.length)} de {filteredTransactions.length}
            </span>
            <div className="flex items-center gap-2">
              <button 
                disabled={currentPage === 1}
                onClick={() => setCurrentPage(p => p - 1)}
                className="p-1.5 rounded-lg bg-white/5 border border-white/10 disabled:opacity-30 hover:bg-white/10 transition-all"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="text-xs font-bold px-3">{currentPage} / {totalPages}</span>
              <button 
                disabled={currentPage === totalPages}
                onClick={() => setCurrentPage(p => p + 1)}
                className="p-1.5 rounded-lg bg-white/5 border border-white/10 disabled:opacity-30 hover:bg-white/10 transition-all"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
