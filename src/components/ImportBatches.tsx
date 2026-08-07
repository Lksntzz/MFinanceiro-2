import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, ChevronRight, FileClock, Loader2, RefreshCw } from 'lucide-react';

import { supabase } from '../lib/supabase';
import { FinancialAccount, StatementImportBatch, StatementImportRow } from '../types';

interface ImportBatchesProps {
  userId: string;
  accounts: FinancialAccount[];
}

function money(value: number | null | undefined): string {
  return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export default function ImportBatches({ userId, accounts }: ImportBatchesProps) {
  const [batches, setBatches] = useState<StatementImportBatch[]>([]);
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [rows, setRows] = useState<StatementImportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accountNames = useMemo(() => new Map(accounts.map((account) => [account.id, account.name])), [accounts]);
  const selectedBatch = batches.find((batch) => batch.id === selectedBatchId) || null;

  async function loadBatches() {
    setLoading(true);
    setError(null);
    const { data, error: queryError } = await supabase
      .from('mf_statement_import_batches')
      .select('id,user_id,account_id,status,source_format,file_name,parser_name,period_start,period_end,balance_mode,balance_before,balance_after,net_amount,requested_count,inserted_count,duplicate_count,rejected_count,ignored_count,error_message,created_at,completed_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(0, 49);
    if (queryError) setError(queryError.message);
    else setBatches((data || []) as StatementImportBatch[]);
    setLoading(false);
  }

  async function selectBatch(batchId: string) {
    setSelectedBatchId(batchId);
    setRowsLoading(true);
    setError(null);
    const { data, error: queryError } = await supabase
      .from('mf_statement_import_rows')
      .select('id,batch_id,line_number,transaction_date,description,category_name,signed_amount,status,error_message,ledger_entry_id')
      .eq('batch_id', batchId)
      .order('line_number')
      .range(0, 199);
    if (queryError) setError(queryError.message);
    else setRows((data || []) as StatementImportRow[]);
    setRowsLoading(false);
  }

  useEffect(() => {
    void loadBatches();
  }, [userId]);

  if (loading) return <div className="flex h-48 items-center justify-center gap-2 text-xs text-white/40"><Loader2 size={16} className="animate-spin" /> Carregando lotes...</div>;

  return (
    <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(300px,0.8fr)_minmax(0,1.2fr)]">
      <section className="glass-card min-h-0 overflow-hidden !p-0">
        <div className="flex items-center justify-between border-b border-white/10 p-4"><div className="flex items-center gap-2"><FileClock size={16} className="text-brand-primary" /><h3 className="text-sm font-bold">Lotes importados</h3></div><button type="button" onClick={() => void loadBatches()} className="text-white/35 hover:text-white" aria-label="Atualizar lotes"><RefreshCw size={14} /></button></div>
        <div className="max-h-[560px] space-y-1 overflow-y-auto p-2 no-scrollbar">
          {batches.map((batch) => (
            <button key={batch.id} type="button" onClick={() => void selectBatch(batch.id)} className={`w-full rounded-xl border p-3 text-left transition ${selectedBatchId === batch.id ? 'border-brand-primary/40 bg-brand-primary/10' : 'border-transparent hover:border-white/10 hover:bg-white/[0.03]'}`}>
              <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="truncate text-xs font-bold">{batch.file_name || `Lote ${batch.source_format.toUpperCase()}`}</div><div className="mt-1 text-[9px] text-white/40">{accountNames.get(batch.account_id) || 'Conta'} · {new Date(batch.created_at).toLocaleString('pt-BR')}</div></div><ChevronRight size={14} className="mt-1 shrink-0 text-white/25" /></div>
              <div className="mt-2 flex flex-wrap gap-2 text-[9px]"><span className="text-green-400">{batch.inserted_count} importados</span><span className="text-yellow-300">{batch.duplicate_count} duplicados</span>{batch.rejected_count > 0 && <span className="text-red-300">{batch.rejected_count} rejeitados</span>}</div>
            </button>
          ))}
          {batches.length === 0 && <div className="py-12 text-center text-xs text-white/30">Nenhum lote registrado ainda.</div>}
        </div>
      </section>

      <section className="glass-card min-h-0 overflow-hidden !p-0">
        {error && <div className="m-3 rounded-xl border border-red-500/25 bg-red-500/10 p-3 text-xs text-red-200" role="alert">{error}</div>}
        {!selectedBatch ? (
          <div className="flex h-64 flex-col items-center justify-center gap-2 text-center text-white/30"><FileClock size={28} /><p className="text-xs">Selecione um lote para ver as linhas e a conciliação.</p></div>
        ) : (
          <>
            <div className="border-b border-white/10 p-4">
              <div className="flex items-start justify-between gap-4"><div><h3 className="text-sm font-bold">{selectedBatch.file_name || 'Importação sem arquivo'}</h3><p className="mt-1 text-[10px] text-white/40">{selectedBatch.period_start || 'Período não identificado'} até {selectedBatch.period_end || '—'} · saldo {money(selectedBatch.balance_before)} → {money(selectedBatch.balance_after)}</p></div>{selectedBatch.status === 'completed' ? <CheckCircle2 size={18} className="text-green-400" /> : <AlertCircle size={18} className="text-yellow-300" />}</div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] sm:grid-cols-4"><div className="rounded-lg bg-white/5 p-2"><span className="text-white/35">Linhas</span><strong className="block">{selectedBatch.requested_count}</strong></div><div className="rounded-lg bg-green-500/10 p-2"><span className="text-green-300/70">Importadas</span><strong className="block text-green-300">{selectedBatch.inserted_count}</strong></div><div className="rounded-lg bg-yellow-500/10 p-2"><span className="text-yellow-200/70">Duplicadas</span><strong className="block text-yellow-200">{selectedBatch.duplicate_count}</strong></div><div className="rounded-lg bg-red-500/10 p-2"><span className="text-red-200/70">Rejeitadas</span><strong className="block text-red-200">{selectedBatch.rejected_count}</strong></div></div>
            </div>
            <div className="max-h-[450px] overflow-y-auto no-scrollbar">
              {rowsLoading ? <div className="flex h-40 items-center justify-center"><Loader2 size={16} className="animate-spin text-brand-primary" /></div> : rows.map((row) => (
                <div key={row.id} className="grid grid-cols-[42px_minmax(0,1fr)_auto] items-center gap-3 border-b border-white/5 px-4 py-2.5 text-[10px]"><span className="text-white/25">#{row.line_number}</span><div className="min-w-0"><div className="truncate font-semibold text-white/75">{row.description || row.error_message || 'Linha sem descrição'}</div><div className="mt-0.5 truncate text-white/35">{row.transaction_date || 'sem data'} · {row.category_name || 'sem categoria'} · {row.status}</div></div><strong className={Number(row.signed_amount || 0) >= 0 ? 'text-green-400' : 'text-white/70'}>{money(row.signed_amount)}</strong></div>
              ))}
              {!rowsLoading && rows.length === 0 && <div className="flex h-40 items-center justify-center text-xs text-white/30">Nenhuma linha persistida.</div>}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
