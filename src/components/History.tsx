
import React, { useState, useMemo } from 'react';
import { Transaction } from '../types';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { 
  Search, 
  Filter, 
  ArrowUpRight, 
  ArrowDownRight, 
  Trash2,
  Calendar as CalendarIcon,
  Tag,
  CreditCard,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';

interface HistoryProps {
  transactions: Transaction[];
  onEdit?: (t: Transaction) => void;
  onDelete?: (id: string) => void;
  onDeleteAll?: () => void;
}

export default function History({ transactions, onEdit, onDelete, onDeleteAll }: HistoryProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'income' | 'expense'>('all');
  const [filterCategory, setFilterCategory] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 15;

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
      return matchesSearch && matchesType && matchesCategory;
    });
  }, [transactions, searchTerm, filterType, filterCategory]);

  // Pagination
  const totalPages = Math.ceil(filteredTransactions.length / itemsPerPage);
  const paginatedTransactions = filteredTransactions.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  // Summary for filtered period
  const summary = useMemo(() => {
    const income = filteredTransactions.filter(t => t.type === 'income').reduce((sum, t) => sum + t.amount, 0);
    const expense = filteredTransactions.filter(t => t.type === 'expense').reduce((sum, t) => sum + Math.abs(t.amount), 0);
    return { income, expense, balance: income - expense, count: filteredTransactions.length };
  }, [filteredTransactions]);

  const formatTransactionDate = (raw: string) => {
    if (raw.includes('T')) {
      const parsedIso = new Date(raw);
      if (!isNaN(parsedIso.getTime())) {
        return format(
          new Date(parsedIso.getFullYear(), parsedIso.getMonth(), parsedIso.getDate(), 12, 0, 0, 0),
          'dd MMM yyyy',
          { locale: ptBR }
        );
      }
    }

    const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) {
      const year = Number(iso[1]);
      const month = Number(iso[2]);
      const day = Number(iso[3]);
      return format(new Date(year, month - 1, day, 12, 0, 0, 0), 'dd MMM yyyy', { locale: ptBR });
    }

    const br = raw.match(/^(\d{2})[/-](\d{2})[/-](\d{2,4})/);
    if (br) {
      const day = Number(br[1]);
      const month = Number(br[2]);
      const year = Number(br[3].length === 2 ? `20${br[3]}` : br[3]);
      return format(new Date(year, month - 1, day, 12, 0, 0, 0), 'dd MMM yyyy', { locale: ptBR });
    }

    const parsed = new Date(raw);
    if (isNaN(parsed.getTime())) return '??/??/????';
    return format(
      new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate(), 12, 0, 0, 0),
      'dd MMM yyyy',
      { locale: ptBR }
    );
  };

  const handleDeleteSingle = (t: Transaction) => {
    if (!onDelete) return;
    const ok = window.confirm(`Apagar o lançamento "${t.description || t.category}"? Essa ação é irreversível.`);
    if (!ok) return;
    onDelete(t.id);
  };

  const handleDeleteAll = () => {
    if (!onDeleteAll) return;
    if (transactions.length === 0) {
      alert('Não há lançamentos para apagar.');
      return;
    }
    const ok = window.confirm(`Apagar TODOS os ${transactions.length} lançamentos? Essa ação é irreversível.`);
    if (!ok) return;
    onDeleteAll();
  };

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
          <Filter size={16} className="text-white/40" />
          <select 
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as any)}
            className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs outline-none focus:border-brand-primary"
          >
            <option value="all">Todos os tipos</option>
            <option value="income">Entradas</option>
            <option value="expense">Saídas</option>
          </select>

          <select 
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs outline-none focus:border-brand-primary"
          >
            <option value="all">Todas categorias</option>
            {categories.filter(c => c !== 'all').map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
        </div>

        <button
          type="button"
          onClick={handleDeleteAll}
          className="ml-auto px-3 py-1.5 rounded-lg bg-red-500/20 border border-red-500/40 text-red-300 text-xs font-bold uppercase tracking-wider hover:bg-red-500/30 transition-colors"
        >
          Apagar todos
        </button>
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
                <th className="p-4 text-[10px] uppercase text-white/40 font-bold">Data</th>
                <th className="p-4 text-[10px] uppercase text-white/40 font-bold">Descrição</th>
                <th className="p-4 text-[10px] uppercase text-white/40 font-bold">Categoria</th>
                <th className="p-4 text-[10px] uppercase text-white/40 font-bold">Origem</th>
                <th className="p-4 text-[10px] uppercase text-white/40 font-bold text-right">Valor</th>
                <th className="p-4 text-[10px] uppercase text-white/40 font-bold text-center">Ações</th>
              </tr>
            </thead>
            <tbody>
              {paginatedTransactions.map((t) => (
                <tr key={t.id} className="border-b border-white/5 hover:bg-white/5 transition-colors group">
                  <td className="p-4 text-sm text-white/60">
                    {formatTransactionDate(t.date)}
                  </td>
                  <td className="p-4 text-sm font-medium">
                    {t.description || t.category}
                  </td>
                  <td className="p-4">
                    <span className="text-[10px] px-2 py-1 bg-white/5 rounded-full border border-white/10 text-white/60">
                      {t.category}
                    </span>
                  </td>
                  <td className="p-4 text-sm text-white/40 flex items-center gap-2">
                    <CreditCard size={14} />
                    <span>Principal</span>
                  </td>
                  <td className={`p-4 text-sm font-bold text-right ${t.type === 'income' ? 'text-green-400' : 'text-white'}`}>
                    {t.type === 'income' ? '+' : '-'} R$ {Math.abs(t.amount).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </td>
                  <td className="p-4 text-center">
                    <button
                      type="button"
                      onClick={() => handleDeleteSingle(t)}
                      className="p-1 text-white/30 hover:text-red-400 transition-colors"
                      title="Apagar lançamento"
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
              {paginatedTransactions.length === 0 && (
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
