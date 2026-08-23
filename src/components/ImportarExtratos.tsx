import { AlertCircle, CheckCircle2, RotateCcw } from 'lucide-react';
import { useState } from 'react';

import type {
  FinancialAccount,
  ImportedTransaction,
  StatementImportOptions,
} from '../types';
import ImportarExtratosCore from './ImportarExtratosCore';

export { parseCsvTransactions } from '../features/importer/csv-parser';
export {
  detectFileFormat,
  normalizeImportedTransactions,
} from '../features/importer/import-file';
export { parseOfxTransactions } from '../features/importer/ofx-parser';
export { parsePdfTransactions } from '../features/importer/pdf-parser';
export { parseSpreadsheetTransactions } from '../features/importer/spreadsheet-parser';

export interface StatementImportResult {
  batch_id: string;
  inserted_count: number;
  duplicate_count: number;
  rejected_count: number;
  ignored_count: number;
}

interface ImportarExtratosProps {
  onImport: (
    transactions: ImportedTransaction[],
    newBalance: number | undefined,
    options: StatementImportOptions,
  ) => Promise<StatementImportResult>;
  onCancel: () => void;
  accounts: FinancialAccount[];
  accountHolderName?: string;
  internalAccountAliases?: string[];
}

export default function ImportarExtratos({
  onImport,
  onCancel,
  accounts,
  accountHolderName,
  internalAccountAliases,
}: ImportarExtratosProps) {
  const [result, setResult] = useState<StatementImportResult | null>(null);

  async function handleImport(
    transactions: ImportedTransaction[],
    newBalance: number | undefined,
    options: StatementImportOptions,
  ): Promise<number> {
    const nextResult = await onImport(transactions, newBalance, options);
    window.setTimeout(() => setResult(nextResult), 0);
    return Number(nextResult.inserted_count || 0);
  }

  if (!result) {
    return (
      <ImportarExtratosCore
        onImport={handleImport}
        onCancel={onCancel}
        accounts={accounts}
        accountHolderName={accountHolderName}
        internalAccountAliases={internalAccountAliases}
      />
    );
  }

  const inserted = Number(result.inserted_count || 0);
  const duplicates = Number(result.duplicate_count || 0);
  const rejected = Number(result.rejected_count || 0);
  const ignored = Number(result.ignored_count || 0);
  const noNewRows = inserted === 0;
  const onlyDuplicates =
    noNewRows && duplicates > 0 && rejected === 0 && ignored === 0;
  const hasWarnings = rejected > 0 || ignored > 0;

  const title =
    inserted > 0
      ? hasWarnings
        ? 'Importação concluída com ressalvas'
        : 'Importação concluída'
      : onlyDuplicates
        ? 'Nenhum lançamento novo'
        : 'Importação sem novos lançamentos';

  const description =
    inserted > 0
      ? `${inserted} lançamento(s) novo(s) foram adicionados ao ledger.`
      : onlyDuplicates
        ? `Os ${duplicates} lançamento(s) identificado(s) já existiam e não foram duplicados.`
        : rejected > 0
          ? `Nenhum lançamento foi adicionado. ${rejected} item(ns) foram rejeitados; consulte Lotes e conciliação para revisar os motivos.`
          : ignored > 0
            ? `Nenhum lançamento foi adicionado. ${ignored} item(ns) foram ignorados pelas regras de importação.`
            : 'O arquivo foi processado, mas não produziu alterações no ledger.';

  const warningOnly = noNewRows && hasWarnings;

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-5 overflow-y-auto p-4 animate-fade-in">
      <div
        className={`h-20 w-20 rounded-full flex items-center justify-center ${warningOnly ? 'bg-amber-500/20 text-amber-300' : 'bg-green-500/20 text-green-500'}`}
      >
        {warningOnly ? <AlertCircle size={48} /> : <CheckCircle2 size={48} />}
      </div>

      <div className="max-w-xl space-y-2 text-center">
        <h2 className="text-2xl font-bold">{title}</h2>
        <p className="text-sm leading-relaxed text-white/50">{description}</p>
      </div>

      <section
        className="grid w-full max-w-xl grid-cols-2 gap-2 sm:grid-cols-4"
        aria-label="Resumo da importação"
      >
        <ImportMetric
          label="Inseridos"
          value={inserted}
          className="text-green-400"
        />
        <ImportMetric
          label="Duplicados"
          value={duplicates}
          className="text-yellow-300"
        />
        <ImportMetric
          label="Rejeitados"
          value={rejected}
          className={rejected > 0 ? 'text-red-300' : ''}
        />
        <ImportMetric label="Ignorados" value={ignored} />
      </section>

      <div className="flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={() => setResult(null)}
          className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-5 py-3 text-xs font-bold text-white/70 transition hover:bg-white/10"
        >
          <RotateCcw size={14} /> Importar outro arquivo
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-xl bg-brand-primary px-6 py-3 text-xs font-bold uppercase tracking-wider text-black transition hover:brightness-110"
        >
          Voltar às movimentações
        </button>
      </div>

      {(rejected > 0 || ignored > 0) && (
        <p className="max-w-xl text-center text-[10px] leading-relaxed text-white/35">
          O histórico detalhado do processamento fica disponível em
          Movimentações → Lotes e conciliação.
        </p>
      )}
    </div>
  );
}

function ImportMetric({
  label,
  value,
  className = '',
}: {
  label: string;
  value: number;
  className?: string;
}) {
  return (
    <div className="glass-card !p-3 text-center">
      <span className="block text-[9px] font-bold uppercase tracking-wider text-white/35">
        {label}
      </span>
      <strong className={`mt-1 block text-lg ${className}`}>{value}</strong>
    </div>
  );
}
