import React, { useState, useCallback, useEffect, useRef } from 'react';
import { FinancialAccount, ImportedTransaction, StatementImportOptions } from '../types';
import {
  analyzeDelimitedContent,
  buildTextPreview,
  cloneFileForSession,
  detectFileFormat,
  ensureMinimumTransactionFields,
  getInvalidLineReasons,
  hashImportFile,
  inferEmptyResultReason,
  normalizeImportedTransactions,
} from '../features/importer/import-file';
import {
  calculateImportBalanceValidation,
  removeImportedTransaction,
  toggleImportedTransaction,
  updateImportedTransaction,
} from '../features/importer/import-review';
import type {
  DelimitedAnalysis,
  ImportDiagnostics,
  ParserDebugSummary,
  SpreadsheetAnalysis,
} from '../features/importer/import-types';
import { parseCsvTransactions } from '../features/importer/csv-parser';
import { parseOfxTransactions } from '../features/importer/ofx-parser';
import { extractStatementWithOcr } from '../features/importer/ocr-service';
import { analyzeSpreadsheetContent } from '../features/importer/spreadsheet-parser';
import { standardizeBankCsv } from '../lib/bank-csv-normalizer';
import { supabase } from '../lib/supabase';
import { createOperationalCorrelationId, reportOperationalEvent } from '../lib/operational-observability';
import {
  Upload,
  FileText,
  CheckCircle2,
  Filter,
  Trash2,
  Check,
  X,
  ChevronRight,
  Database,
  Info,
  Loader2,
  ArrowRightLeft,
  ShieldCheck,
  AlertCircle
} from 'lucide-react';

interface ImportarExtratosProps {
  onImport: (
    transactions: ImportedTransaction[],
    newBalance: number | undefined,
    options: StatementImportOptions,
  ) => Promise<number>;
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
  internalAccountAliases
}: ImportarExtratosProps) {
  const importSessionRef = useRef(0);
  const importCorrelationRef = useRef<string | null>(null);
  const pdfPasswordResolverRef = useRef<((password: string | null) => void) | null>(null);
  const [step, setStep] = useState<'upload' | 'processing' | 'review' | 'success'>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [bank, setBank] = useState<string>('auto');
  const [importedData, setImportedData] = useState<ImportedTransaction[]>([]);
  const [importDiagnostics, setImportDiagnostics] = useState<ImportDiagnostics | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [balanceMode, setBalanceMode] = useState<'keep' | 'apply_new' | 'statement'>('keep');
  const [reviewAcknowledged, setReviewAcknowledged] = useState(false);
  const [ocrExtractionId, setOcrExtractionId] = useState<string | null>(null);
  const [ocrStatementBalance, setOcrStatementBalance] = useState<number | undefined>(undefined);
  const [rejectedOcrItemIds, setRejectedOcrItemIds] = useState<string[]>([]);
  const [pdfPasswordPrompt, setPdfPasswordPrompt] = useState<{ fileName?: string; incorrect?: boolean } | null>(null);
  const [pdfPassword, setPdfPassword] = useState('');
  const [showPdfPassword, setShowPdfPassword] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [committedCount, setCommittedCount] = useState(0);
  const [selectedAccountId, setSelectedAccountId] = useState(
    () => accounts.find((account) => account.is_default && account.is_active)?.id
      || accounts.find((account) => account.is_active)?.id
      || '',
  );
  const readyItemsCount = importedData.filter(i => i.status === 'ready').length;
  const canConfirmImport = readyItemsCount > 0 && Boolean(selectedAccountId) && reviewAcknowledged;

  useEffect(() => {
    if (accounts.some((account) => account.id === selectedAccountId && account.is_active)) return;
    setSelectedAccountId(
      accounts.find((account) => account.is_default && account.is_active)?.id
        || accounts.find((account) => account.is_active)?.id
        || '',
    );
  }, [accounts, selectedAccountId]);

  useEffect(() => () => {
    pdfPasswordResolverRef.current?.(null);
    pdfPasswordResolverRef.current = null;
  }, []);

  const requestPdfPassword = useCallback((options: { fileName?: string; incorrect?: boolean }) => {
    pdfPasswordResolverRef.current?.(null);
    setPdfPassword('');
    setShowPdfPassword(false);
    setPdfPasswordPrompt(options);
    return new Promise<string | null>((resolve) => {
      pdfPasswordResolverRef.current = resolve;
    });
  }, []);

  const finishPdfPassword = useCallback((value: string | null) => {
    const resolve = pdfPasswordResolverRef.current;
    pdfPasswordResolverRef.current = null;
    setPdfPassword('');
    setPdfPasswordPrompt(null);
    resolve?.(value);
  }, []);

  const balanceValidation = calculateImportBalanceValidation(importedData, ocrStatementBalance);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      processFile(e.target.files[0]);
    }
    e.currentTarget.value = '';
  };

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const resetImportState = useCallback((targetStep: 'upload' | 'processing' = 'upload') => {
    importSessionRef.current += 1;
    importCorrelationRef.current = null;
    setFile(null);
    setImportedData([]);
    setImportDiagnostics(null);
    setBalanceMode('keep');
    setReviewAcknowledged(false);
    setOcrExtractionId(null);
    setOcrStatementBalance(undefined);
    setRejectedOcrItemIds([]);
    setImportError(null);
    setCommittedCount(0);
    setStep(targetStep);
  }, []);

  const processFile = async (selectedFile: File) => {
    const sessionId = ++importSessionRef.current;
    const correlationId = createOperationalCorrelationId();
    const startedAt = performance.now();
    importCorrelationRef.current = correlationId;
    const isStale = () => importSessionRef.current !== sessionId;
    const fileSnapshot = await cloneFileForSession(selectedFile);

    setFile(fileSnapshot);
    setImportedData([]);
    setImportDiagnostics(null);
    setStep('processing');
    setBalanceMode('keep');
    setReviewAcknowledged(false);
    setOcrExtractionId(null);
    setOcrStatementBalance(undefined);
    setRejectedOcrItemIds([]);
    setImportError(null);
    setCommittedCount(0);

    try {
      const detection = detectFileFormat(fileSnapshot);
      let parsed: ImportedTransaction[] = [];
      let csvAnalysis: DelimitedAnalysis | undefined;
      let sheetAnalysis: SpreadsheetAnalysis | undefined;
      let ofxContent = '';
      let rawTextPreview = '';
      let ocrDocumentConfidence: number | null = null;
      let currentOcrExtractionId: string | null = null;
      let currentOcrStatementBalance: number | undefined;
      let ocrWarnings: string[] = [];
      let parserDebug: ParserDebugSummary = { linesExtracted: 0, linesIgnored: 0, rejectedLineReasons: [] };
      let pdfDebugInfo: {
        totalPages: number;
        totalTextItems: number;
        linesExtracted: number;
        ignoredLines?: number;
        rejectedLineReasons?: string[];
        usedGenericFallback: boolean;
        isLikelyBankStatement?: boolean;
        hasTransactionPattern?: boolean;
        reason?: string;
        textPreview: string;
      } | null = null;

      if (!detection.supported || !detection.parserExists) {
        if (isStale()) return;
        reportOperationalEvent('statement.format_unsupported', 'statement-import', 'warning', {
          format: detection.format,
          parser_exists: detection.parserExists,
        }, { correlationId, durationMs: performance.now() - startedAt });
        setImportedData([]);
        setImportDiagnostics({
          fileName: selectedFile.name,
          mimeType: fileSnapshot.type || 'desconhecido',
          fileSize: fileSnapshot.size,
          fileLastModified: fileSnapshot.lastModified,
          formatLabel: detection.formatLabel,
          parserLabel: detection.parserLabel,
          parserExists: detection.parserExists,
          supported: detection.supported,
          totalFound: 0,
          validFound: 0,
          linesExtracted: 0,
          linesIgnored: 0,
          rejectedLineReasons: [],
          reason: detection.reason || 'Formato nao suportado para importacao.'
        });
        setStep('review');
        return;
      }

      if (detection.format === 'csv') {
        const rawContent = await fileSnapshot.text();
        const content = standardizeBankCsv(rawContent, fileSnapshot.name) || rawContent;
        rawTextPreview = buildTextPreview(content);
        csvAnalysis = analyzeDelimitedContent(content);
        parsed = parseCsvTransactions(content, bank);
        const rejected = getInvalidLineReasons(parsed);
        parserDebug = {
          linesExtracted: Math.max(csvAnalysis.nonEmptyLines - 1, 0),
          linesIgnored: rejected.length,
          rejectedLineReasons: rejected
        };
      } else if (detection.format === 'ofx') {
        ofxContent = await fileSnapshot.text();
        rawTextPreview = buildTextPreview(ofxContent);
        parsed = parseOfxTransactions(ofxContent, bank);
        const rejected = getInvalidLineReasons(parsed);
        parserDebug = {
          linesExtracted: (ofxContent.match(/<STMTTRN>/gi) || []).length,
          linesIgnored: rejected.length,
          rejectedLineReasons: rejected
        };
      } else if (detection.format === 'pdf') {
        const { parsePdfStatementWithDebug } = await import('../lib/import-parsers/pdf/parse-pdf-statement');
        const pdfResult = await parsePdfStatementWithDebug(fileSnapshot, bank, {
          accountHolderName,
          internalAccountAliases,
          requestPassword: requestPdfPassword,
        });
        parsed = pdfResult.transactions;
        pdfDebugInfo = pdfResult.debug;
        rawTextPreview = buildTextPreview(pdfResult.debug.textPreview);
        parserDebug = {
          linesExtracted: pdfResult.debug.linesExtracted,
          linesIgnored: pdfResult.debug.ignoredLines || 0,
          rejectedLineReasons: pdfResult.debug.rejectedLineReasons || []
        };
        const hasValidLocalRows = parsed.some((item) => item.status === 'ready' && Number(item.amount) > 0);
        if (!hasValidLocalRows) {
          try {
            const ocrResult = await extractStatementWithOcr(fileSnapshot, selectedAccountId);
            parsed = ocrResult.transactions;
            currentOcrExtractionId = ocrResult.extractionId;
            ocrDocumentConfidence = ocrResult.documentConfidence;
            currentOcrStatementBalance = ocrResult.statementBalance;
            ocrWarnings = ocrResult.warnings;
            parserDebug = {
              linesExtracted: parsed.length,
              linesIgnored: parsed.filter((item) => item.status !== 'ready').length,
              rejectedLineReasons: ocrWarnings,
            };
          } catch (ocrError) {
            reportOperationalEvent('statement.ocr_fallback_failed', 'statement-import', 'error', {
              format: detection.format,
              local_rows_valid: false,
            }, { correlationId });
            pdfDebugInfo = {
              ...pdfResult.debug,
              reason: `${pdfResult.debug.reason || 'PDF sem texto transacional.'} OCR/IA indisponível: ${ocrError instanceof Error ? ocrError.message : 'falha desconhecida'}`,
            };
          }
        }
      } else if (detection.format === 'xls' || detection.format === 'xlsx') {
        sheetAnalysis = await analyzeSpreadsheetContent(fileSnapshot);
        rawTextPreview = buildTextPreview(sheetAnalysis.csv);
        parsed = sheetAnalysis.csv.trim() ? parseCsvTransactions(sheetAnalysis.csv, bank) : [];
        const rejected = getInvalidLineReasons(parsed);
        parserDebug = {
          linesExtracted: Math.max(sheetAnalysis.nonEmptyRows - 1, 0),
          linesIgnored: rejected.length,
          rejectedLineReasons: rejected
        };
      } else if (detection.format === 'image') {
        const ocrResult = await extractStatementWithOcr(fileSnapshot, selectedAccountId);
        parsed = ocrResult.transactions;
        currentOcrExtractionId = ocrResult.extractionId;
        ocrDocumentConfidence = ocrResult.documentConfidence;
        currentOcrStatementBalance = ocrResult.statementBalance;
        ocrWarnings = ocrResult.warnings;
        parserDebug = {
          linesExtracted: parsed.length,
          linesIgnored: parsed.filter((item) => item.status !== 'ready').length,
          rejectedLineReasons: ocrWarnings,
        };
      }

      if (isStale()) return;

      const invalidDateCount = parsed.filter((item) => !item.date || Number.isNaN(new Date(item.date).getTime())).length;
      if (invalidDateCount > 0) {
        reportOperationalEvent('statement.invalid_date_fallback', 'statement-import', 'error', {
          format: detection.format, invalid_date_count: invalidDateCount, parsed_count: parsed.length,
        }, { correlationId, severity: 'high', impact: 'financial_risk' });
      }

      const normalized = ensureMinimumTransactionFields(normalizeImportedTransactions(parsed));
      const validFound = normalized.filter(
        (item) => item.status === 'ready' && item.amount > 0 && item.description !== 'Sem descricao'
      ).length;

      setImportedData(normalized);
      setOcrExtractionId(currentOcrExtractionId);
      setOcrStatementBalance(currentOcrStatementBalance);
      if (ocrDocumentConfidence !== null && ocrDocumentConfidence < 0.85) {
        reportOperationalEvent('statement.ocr_low_confidence', 'statement-import', 'warning', {
          format: detection.format, confidence: Math.round(ocrDocumentConfidence * 100) / 100, parsed_count: parsed.length,
        }, { correlationId });
      }
      if (pdfDebugInfo?.usedGenericFallback) {
        reportOperationalEvent('statement.parse_empty', 'statement-import', 'warning', {
          format: detection.format, generic_fallback_used: true, parsed_count: parsed.length,
        }, { correlationId, module: 'statement_import.pdf', operation: 'generic_fallback', errorCode: 'STATEMENT_PDF_GENERIC_FALLBACK' });
      }
      let debugNote: string | undefined;
      if (ocrDocumentConfidence !== null) {
        debugNote = `OCR/IA -> confiança do documento: ${Math.round(ocrDocumentConfidence * 100)}%; revisão humana obrigatória; ${ocrWarnings.join(' | ')}`;
      } else if (detection.format === 'pdf' && pdfDebugInfo) {
        const preview = pdfDebugInfo.textPreview ? ` | Texto extraido: "${pdfDebugInfo.textPreview}"` : '';
        debugNote = `PDF Debug -> paginas: ${pdfDebugInfo.totalPages}, itens de texto: ${pdfDebugInfo.totalTextItems}, linhas extraidas: ${pdfDebugInfo.linesExtracted}, linhas ignoradas: ${pdfDebugInfo.ignoredLines || 0}, perfil extrato: ${pdfDebugInfo.isLikelyBankStatement ? 'sim' : 'nao'}, padrao transacao: ${pdfDebugInfo.hasTransactionPattern ? 'sim' : 'nao'}, fallback generico: ${pdfDebugInfo.usedGenericFallback ? 'sim' : 'nao'}${preview}`;
      } else if ((detection.format === 'xls' || detection.format === 'xlsx') && sheetAnalysis) {
        debugNote = `XLSX Debug -> aba usada: ${sheetAnalysis.selectedSheetName || 'desconhecida'}, linhas nao vazias: ${sheetAnalysis.nonEmptyRows}, sinais de transacao: ${sheetAnalysis.hasTransactionSignals ? 'sim' : 'nao'}`;
      } else if (detection.format === 'csv' && csvAnalysis) {
        debugNote = `CSV Debug -> linhas nao vazias: ${csvAnalysis.nonEmptyLines}, sinais de transacao: ${csvAnalysis.hasTransactionSignals ? 'sim' : 'nao'}`;
      } else if (detection.format === 'ofx') {
        debugNote = `OFX Debug -> blocos STMTTRN: ${(ofxContent.match(/<STMTTRN>/gi) || []).length}`;
      }
      const zeroResultReason = inferEmptyResultReason({
        fileName: fileSnapshot.name,
        format: detection.format,
        csvAnalysis,
        sheetAnalysis,
        ofxContent,
        pdfReason: pdfDebugInfo?.reason,
      });
      if (validFound === 0) {
        reportOperationalEvent('statement.parse_empty', 'statement-import', 'warning', {
          format: detection.format, parsed_count: normalized.length, lines_extracted: parserDebug.linesExtracted, lines_ignored: parserDebug.linesIgnored,
        }, { correlationId, durationMs: performance.now() - startedAt });
      }
      setImportDiagnostics({
        fileName: selectedFile.name,
        mimeType: fileSnapshot.type || 'desconhecido',
        fileSize: fileSnapshot.size,
        fileLastModified: fileSnapshot.lastModified,
        formatLabel: detection.formatLabel,
        parserLabel: detection.parserLabel,
        parserExists: detection.parserExists,
        supported: detection.supported,
        totalFound: normalized.length,
        validFound,
        linesExtracted: parserDebug.linesExtracted,
        linesIgnored: parserDebug.linesIgnored,
        rejectedLineReasons: parserDebug.rejectedLineReasons,
        reason: validFound === 0
          ? zeroResultReason
          : undefined,
        debugNote,
        baseTextPreview: rawTextPreview,
        ocrExtractionId: currentOcrExtractionId || undefined,
        ocrDocumentConfidence: ocrDocumentConfidence ?? undefined,
      });
      if (isStale()) return;
      setStep('review');
    } catch (error) {
      if (isStale()) return;
      reportOperationalEvent('statement.process_failed', 'statement-import', 'error', { phase: 'process_file' }, {
        correlationId, durationMs: performance.now() - startedAt,
      });
      console.error('Erro ao processar arquivo:', error);
      setImportedData([]);
      setImportDiagnostics({
        fileName: selectedFile.name,
        mimeType: fileSnapshot.type || 'desconhecido',
        fileSize: fileSnapshot.size,
        fileLastModified: fileSnapshot.lastModified,
        formatLabel: detectFileFormat(fileSnapshot).formatLabel,
        parserLabel: detectFileFormat(fileSnapshot).parserLabel,
        parserExists: true,
        supported: true,
        totalFound: 0,
        validFound: 0,
        linesExtracted: 0,
        linesIgnored: 0,
        rejectedLineReasons: [],
        reason: 'Falha ao ler o arquivo. Verifique o formato e tente novamente.'
      });
      setStep('review');
    }
  };

  const handleToggleStatus = (id: string) => {
    setReviewAcknowledged(false);
    setImportedData((current) => toggleImportedTransaction(current, id));
  };

  const handleRemove = (id: string) => {
    setReviewAcknowledged(false);
    setImportedData((current) => {
      const result = removeImportedTransaction(current, id);
      if (result.rejectedExtractionItemId) {
        setRejectedOcrItemIds((rejected) => rejected.includes(result.rejectedExtractionItemId!)
          ? rejected
          : [...rejected, result.rejectedExtractionItemId!]);
      }
      return result.items;
    });
  };

  const handleUpdateItem = (id: string, patch: Partial<ImportedTransaction>) => {
    setReviewAcknowledged(false);
    setImportedData((current) => updateImportedTransaction(current, id, patch));
  };

  async function persistOcrReview() {
    if (!ocrExtractionId) return;

    const updates = importedData
      .filter((item) => item.extraction_item_id)
      .map((item) => supabase
        .from('mf_document_extraction_items')
        .update({
          transaction_date: item.date.slice(0, 10),
          description: item.description,
          signed_amount: item.type === 'income' ? Math.abs(item.amount) : -Math.abs(item.amount),
          transaction_type: item.type,
          source_name: item.bank_source || item.source || 'OCR/IA',
          external_id: item.source_id || null,
          running_balance: item.running_balance ?? null,
          category_name: item.category || 'Geral',
          reviewed_at: new Date().toISOString(),
          review_status: item.status === 'ready'
            ? (item.review_status === 'edited' ? 'edited' : 'accepted')
            : 'rejected',
          reviewer_notes: item.status === 'ready' ? 'Revisado antes da importação.' : 'Não selecionado na revisão.',
        })
        .eq('id', item.extraction_item_id!)
        .eq('extraction_id', ocrExtractionId));

    if (rejectedOcrItemIds.length) {
      updates.push(supabase
        .from('mf_document_extraction_items')
        .update({ review_status: 'rejected', reviewer_notes: 'Removido durante a revisão humana.' })
        .eq('extraction_id', ocrExtractionId)
        .in('id', rejectedOcrItemIds));
    }

    const results = await Promise.all(updates);
    const failed = results.find((result) => result.error);
    if (failed?.error) {
      reportOperationalEvent('statement.ocr_review_persist_failed', 'statement-import', 'error', { update_count: updates.length }, {
        correlationId: importCorrelationRef.current || undefined,
      });
      throw new Error(`Não foi possível salvar a revisão do OCR: ${failed.error.message}`);
    }
  }

  const handleFinalImport = async () => {
    if (!canConfirmImport || isImporting) return;

    const calibrationBalance = balanceMode === 'statement' && balanceValidation ? balanceValidation.statementFinal : undefined;

    setIsImporting(true);
    setImportError(null);
    const correlationId = importCorrelationRef.current || createOperationalCorrelationId();
    importCorrelationRef.current = correlationId;
    const startedAt = performance.now();

    try {
      if (!file || !selectedAccountId) throw new Error('Selecione um arquivo e a conta financeira de destino.');
      await persistOcrReview();
      const fileHash = await hashImportFile(file);
      const insertedCount = await onImport(importedData, calibrationBalance, {
        accountId: selectedAccountId,
        balanceMode,
        fileName: file.name,
        fileType: file.type || undefined,
        fileSize: file.size,
        fileHash,
        parserName: importDiagnostics?.parserLabel,
        correlationId,
        diagnostics: importDiagnostics
          ? { ...importDiagnostics } as unknown as Record<string, unknown>
          : undefined,
      });
      setCommittedCount(insertedCount);
      if (ocrExtractionId) {
        const { error: extractionError } = await supabase
          .from('mf_document_extractions')
          .update({ status: 'completed', completed_at: new Date().toISOString() })
          .eq('id', ocrExtractionId);
        if (extractionError) console.warn('A revisão OCR não pôde ser encerrada após a importação:', extractionError.message);
      }
      setStep('success');
    } catch (error) {
      console.error('Falha ao importar lançamentos:', error);
      reportOperationalEvent('statement.import_failed', 'statement-import', 'error', {
        selected_count: readyItemsCount, review_acknowledged: reviewAcknowledged, mode: balanceMode,
      }, { correlationId, durationMs: performance.now() - startedAt, severity: 'high', impact: 'financial_risk' });
      setImportError(
        error instanceof Error && error.message
          ? error.message
          : 'Não foi possível concluir a importação. Nenhum sucesso foi confirmado.'
      );
    } finally {
      setIsImporting(false);
    }
  };

  if (step === 'success') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-6 animate-fade-in">
        <div className="h-20 w-20 rounded-full bg-green-500/20 flex items-center justify-center text-green-500">
          <CheckCircle2 size={48} />
        </div>
        <div className="text-center space-y-2">
          <h2 className="text-2xl font-bold">Importacao Concluida!</h2>
          <p className="text-white/40 text-sm max-w-xs mx-auto">
            {committedCount} lancamentos foram adicionados ao seu ledger com sucesso.
          </p>
        </div>
        <button
          onClick={onCancel}
          className="px-8 py-3 bg-brand-primary text-white rounded-xl font-bold uppercase tracking-widest hover:bg-brand-primary/80 transition-all"
        >
          Voltar ao Dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col gap-4 overflow-hidden animate-fade-in">
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Database className="text-brand-secondary" size={24} /> Importar Extratos
          </h2>
          <p className="text-xs text-white/40">Traga suas movimentacoes bancarias para o MFinanceiro de forma inteligente.</p>
        </div>
        <button
          onClick={onCancel}
          disabled={isImporting}
          className="p-2 text-white/20 hover:text-white transition-colors disabled:cursor-not-allowed disabled:opacity-40"
        >
          <X size={20} />
        </button>
      </div>

      {step === 'upload' && (
        <div className="flex-1 flex flex-col gap-4 overflow-y-auto no-scrollbar">
          <div className="grid grid-cols-12 gap-4">
            <div className="col-span-8 space-y-4">
              <div
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
                className={`h-64 border-2 border-dashed rounded-2xl flex flex-col items-center justify-center gap-4 transition-all ${
                  isDragging ? 'border-brand-primary bg-brand-primary/5' : 'border-white/10 bg-white/5 hover:border-white/20'
                }`}
              >
                <div className="h-16 w-16 rounded-full bg-white/5 flex items-center justify-center text-white/40">
                  <Upload size={32} />
                </div>
                <div className="text-center">
                  <p className="font-bold text-sm">Arraste seu extrato aqui</p>
                  <p className="text-[10px] text-white/40 uppercase tracking-widest mt-1">Ou clique para selecionar</p>
                </div>
                <input
                  type="file"
                  className="absolute inset-0 opacity-0 cursor-pointer"
                  onChange={handleFileSelect}
                  accept=".csv,.ofx,.xls,.xlsx,.pdf,image/*"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="glass-card !p-4 flex items-start gap-3">
                  <div className="h-8 w-8 rounded-lg bg-brand-secondary/20 flex items-center justify-center text-brand-secondary">
                    <FileText size={18} />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold">Formatos Suportados</h4>
                    <p className="text-[10px] text-white/40 mt-1">CSV, OFX, Excel, PDF e imagens; OCR/IA exige revisão humana.</p>
                  </div>
                </div>
                <div className="glass-card !p-4 flex items-start gap-3">
                  <div className="h-8 w-8 rounded-lg bg-brand-primary/20 flex items-center justify-center text-brand-primary">
                    <ShieldCheck size={18} />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold">Seguranca de Dados</h4>
                    <p className="text-[10px] text-white/40 mt-1">Arquivos de OCR ficam em armazenamento privado e a chave de IA permanece no servidor.</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="col-span-4 space-y-4">
              <div className="glass-card !p-5 space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-widest flex items-center gap-2">
                  <Filter size={14} className="text-white/40" /> Configuracao
                </h3>
                <div>
                  <label className="text-[10px] text-white/40 uppercase font-bold block mb-1.5">Banco / Origem</label>
                  <select
                    value={bank}
                    onChange={(e) => setBank(e.target.value)}
                    className="w-full bg-[#121212] border border-white/10 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-brand-primary transition-all [&>option]:bg-[#121212] [&>option]:text-white"
                  >
                    <option value="auto">Deteccao Automatica</option>
                    <option value="nubank">Nubank</option>
                    <option value="inter">Inter</option>
                    <option value="santander">Santander</option>
                    <option value="bradesco">Bradesco</option>
                    <option value="mercadopago">Mercado Pago</option>
                    <option value="c6bank">C6 Bank</option>
                  </select>
                </div>
              </div>

              <div className="glass-card !p-5 bg-brand-primary/5 border-brand-primary/20">
                <h3 className="text-xs font-bold flex items-center gap-2 mb-2">
                  <Info size={14} className="text-brand-primary" /> Dica Pro
                </h3>
                <p className="text-[10px] text-white/60 leading-relaxed">
                  OFX costuma ter mais precisao na importacao por trazer identificadores unicos e valor consolidado por transacao.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {step === 'processing' && (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 animate-pulse">
          <Loader2 size={48} className="text-brand-secondary animate-spin" />
          <div className="text-center">
            <p className="font-bold">Interpretando Extrato...</p>
            {file?.name && <p className="text-[10px] text-white/60 mt-1">Arquivo atual: {file.name}</p>}
            <p className="text-[10px] text-white/40 uppercase tracking-widest mt-1">Normalizando dados e detectando duplicidades</p>
          </div>
        </div>
      )}

      {step === 'review' && (
        <div className="flex-1 flex flex-col gap-4 overflow-hidden">
          <div className="glass-card !p-3 shrink-0 border border-brand-primary/20">
            <label className="flex flex-col gap-1 text-[10px] font-bold uppercase tracking-widest text-white/45 sm:flex-row sm:items-center sm:justify-between">
              Conta financeira do extrato
              <select
                value={selectedAccountId}
                onChange={(event) => { setSelectedAccountId(event.target.value); setReviewAcknowledged(false); }}
                disabled={isImporting}
                className="min-w-[220px] rounded-lg border border-white/10 bg-[#121212] px-3 py-2 text-xs font-medium normal-case tracking-normal text-white outline-none focus:border-brand-primary disabled:opacity-50"
              >
                <option value="">Selecione uma conta</option>
                {accounts.filter((account) => account.is_active).map((account) => (
                  <option key={account.id} value={account.id}>{account.name} · {Number(account.current_balance || 0).toLocaleString('pt-BR', { style: 'currency', currency: account.currency || 'BRL' })}</option>
                ))}
              </select>
            </label>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {([
                { id: 'keep', label: 'Preservar saldo atual', detail: 'Importa o histórico sem alterar o saldo de hoje.' },
                { id: 'apply_new', label: 'Aplicar movimentações', detail: 'Soma entradas e saídas novas ao saldo.' },
                { id: 'statement', label: 'Usar saldo do extrato', detail: balanceValidation ? 'Calibra para o saldo final informado.' : 'O arquivo não trouxe saldo final.' },
              ] as const).map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  disabled={mode.id === 'statement' && !balanceValidation}
                  onClick={() => { setBalanceMode(mode.id); setReviewAcknowledged(false); }}
                  className={`rounded-xl border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-35 ${balanceMode === mode.id ? 'border-brand-primary/40 bg-brand-primary/10' : 'border-white/10 bg-white/[0.02]'}`}
                >
                  <strong className="block text-[10px]">{mode.label}</strong>
                  <span className="mt-1 block text-[9px] font-normal normal-case tracking-normal text-white/35">{mode.detail}</span>
                </button>
              ))}
            </div>
          </div>
          {balanceValidation && (
            <div className={`glass-card !p-3 shrink-0 border transition-all ${balanceValidation.isClose ? 'border-green-500/30 bg-green-500/10' : 'border-yellow-500/30 bg-yellow-500/10'}`}>
              <div className="flex items-center justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <div className="text-[10px] uppercase tracking-widest text-white/50 font-bold">Validação de Saldo</div>
                    {balanceValidation.isClose && (
                      <span className="text-[8px] bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded-full font-bold uppercase">Sincronizado</span>
                    )}
                  </div>
                  <div className="text-xs text-white/80 mt-1">Saldo final extraído do comprovante.</div>
                </div>
                <div className="text-right text-[11px] leading-5 shrink-0">
                  <div className="text-white/40">Esperado: <span className="text-white font-medium">R$ {balanceValidation.expectedFinal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                  <div>Final no Extrato: <span className="font-bold text-white text-sm">R$ {balanceValidation.statementFinal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                  <div className={balanceValidation.isClose ? 'text-green-300' : 'text-yellow-300'}>
                    Diferença: {balanceValidation.diff >= 0 ? '+' : '-'} R$ {Math.abs(balanceValidation.diff).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                </div>
              </div>
              {balanceMode === 'statement' && (
                <div className="mt-2 py-2 px-3 bg-brand-primary/10 rounded-lg border border-brand-primary/20 flex items-center gap-3">
                  <Info size={14} className="text-brand-primary shrink-0" />
                  <p className="text-[10px] text-brand-primary/80 leading-relaxed font-medium">
                    Ao confirmar, seu saldo atual no sistema será ajustado para <span className="font-bold">R$ {balanceValidation.statementFinal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span> após a importação.
                  </p>
                </div>
              )}
            </div>
          )}

          <div className="flex items-center gap-4 shrink-0">
            <div className="flex-1 glass-card !p-3 flex items-center justify-between">
              <div className="flex flex-wrap items-center gap-6">
                <div className="flex flex-col">
                  <span className="text-[8px] text-white/40 uppercase font-bold">Lancamentos</span>
                  <span className="text-sm font-bold">{importedData.length}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[8px] text-white/40 uppercase font-bold">Prontos</span>
                  <span className="text-sm font-bold text-green-400">{readyItemsCount}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[8px] text-white/40 uppercase font-bold">Erros</span>
                  <span className="text-sm font-bold text-red-400">{importedData.filter(i => i.status === 'error').length}</span>
                </div>
                <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-[9px] text-white/60">
                  <input type="checkbox" checked={reviewAcknowledged} onChange={(event) => setReviewAcknowledged(event.target.checked)} disabled={readyItemsCount === 0 || isImporting} />
                  Revisei os itens selecionados e o modo de saldo
                </label>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => resetImportState('upload')}
                  disabled={isImporting}
                  className="px-4 py-2 bg-white/10 text-white text-[10px] font-bold uppercase tracking-widest rounded-lg hover:bg-white/20 transition-all disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Novo Arquivo
                </button>
                <button
                  onClick={handleFinalImport}
                  disabled={!canConfirmImport || isImporting}
                  className={`px-4 py-2 text-[10px] font-bold uppercase tracking-widest rounded-lg transition-all flex items-center gap-2 ${
                    canConfirmImport && !isImporting
                      ? 'bg-brand-primary text-white hover:bg-brand-primary/80'
                      : 'bg-white/10 text-white/40 cursor-not-allowed'
                  }`}
                >
                  {isImporting ? (
                    <>
                      <Loader2 size={14} className="animate-spin" /> Importando...
                    </>
                  ) : (
                    <>
                      Confirmar Importacao <ChevronRight size={14} />
                    </>
                  )}
                </button>
              </div>
            </div>
            {importError && (
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200" role="alert">
                <AlertCircle size={16} className="mt-0.5 shrink-0" />
                <span>A importação não foi concluída: {importError}</span>
              </div>
            )}
          </div>

          {importDiagnostics && (
            <div className="glass-card !p-3 shrink-0 border border-white/10">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[11px]">
                <div>
                  <div className="text-white/40 uppercase text-[9px] font-bold">Arquivo atual</div>
                  <div className="font-bold truncate">{importDiagnostics.fileName}</div>
                </div>
                <div>
                  <div className="text-white/40 uppercase text-[9px] font-bold">Formato detectado</div>
                  <div className="font-bold">{importDiagnostics.formatLabel}</div>
                </div>
                <div>
                  <div className="text-white/40 uppercase text-[9px] font-bold">Parser</div>
                  <div className="font-bold">{importDiagnostics.parserLabel}</div>
                </div>
                <div>
                  <div className="text-white/40 uppercase text-[9px] font-bold">Tipo detectado</div>
                  <div className="font-bold">{importDiagnostics.mimeType || 'desconhecido'}</div>
                </div>
                <div>
                  <div className="text-white/40 uppercase text-[9px] font-bold">Parser disponivel</div>
                  <div className={`font-bold ${importDiagnostics.parserExists ? 'text-green-400' : 'text-red-400'}`}>
                    {importDiagnostics.parserExists ? 'Sim' : 'Nao'}
                  </div>
                </div>
              </div>
              <div className="mt-2 text-[10px] text-white/60">
                <span className="text-white/40 uppercase text-[9px] font-bold">Tamanho:</span>{' '}
                {(importDiagnostics.fileSize / 1024).toFixed(1)} KB{' '}
                <span className="text-white/30">|</span>{' '}
                <span className="text-white/40 uppercase text-[9px] font-bold">Modificado:</span>{' '}
                {new Date(importDiagnostics.fileLastModified).toLocaleString('pt-BR')}
              </div>
              <div className="mt-2 text-[11px]">
                <span className="text-white/40 uppercase text-[9px] font-bold">Lancamentos validos:</span>{' '}
                <span className="font-bold">{importDiagnostics.validFound}</span>
              </div>
              <div className="mt-1 text-[11px]">
                <span className="text-white/40 uppercase text-[9px] font-bold">Linhas extraidas:</span>{' '}
                <span className="font-bold">{importDiagnostics.linesExtracted}</span>{' '}
                <span className="text-white/30">|</span>{' '}
                <span className="text-white/40 uppercase text-[9px] font-bold">Linhas ignoradas:</span>{' '}
                <span className="font-bold">{importDiagnostics.linesIgnored}</span>
              </div>
              {importDiagnostics.reason && (
                <div className="mt-2 text-[11px] text-yellow-300">
                  {importDiagnostics.reason}
                </div>
              )}
              {importDiagnostics.baseTextPreview && (
                <div className="mt-2 text-[10px] text-white/60 break-words">
                  <span className="text-white/40 uppercase text-[9px] font-bold">Texto base identificado:</span>{' '}
                  {importDiagnostics.baseTextPreview}
                </div>
              )}
              {importDiagnostics.debugNote && (
                <div className="mt-2 text-[10px] text-white/50 break-words">
                  {importDiagnostics.debugNote}
                </div>
              )}
              {importDiagnostics.rejectedLineReasons.length > 0 && (
                <div className="mt-2 text-[10px] text-red-300 space-y-1">
                  <div className="text-[9px] uppercase text-red-200/80 font-bold">Motivos de rejeicao (amostra)</div>
                  {importDiagnostics.rejectedLineReasons.map((msg, idx) => (
                    <div key={`${idx}-${msg.slice(0, 20)}`}>- {msg}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex-1 overflow-y-auto no-scrollbar space-y-2">
            {importedData.map(item => (
              <div
                key={item.id}
                className={`grid grid-cols-[40px_minmax(0,1fr)] items-center gap-3 rounded-xl border p-3 transition-all md:grid-cols-[40px_minmax(0,1fr)_150px_auto] ${
                  item.status === 'ready' ? 'bg-white/5 border-white/5' : item.status === 'pending' ? 'border-yellow-500/20 bg-yellow-500/5' : 'bg-red-500/5 border-red-500/20'
                }`}
              >
                <div className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${
                  item.type === 'income' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                }`}>
                  <ArrowRightLeft size={20} />
                </div>

                <div className="min-w-0 space-y-2">
                  <div className="flex items-center gap-2">
                    <input aria-label="Descrição do lançamento" value={item.description} onChange={(event) => handleUpdateItem(item.id, { description: event.target.value })} className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/20 px-2 py-1.5 text-xs font-bold text-white outline-none focus:border-brand-primary/50" />
                    {item.status === 'error' && (
                      <span className="text-[8px] bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded uppercase font-bold">Campo faltando</span>
                    )}
                    {item.confidence < 0.85 && item.status !== 'error' && (
                      <span className="whitespace-nowrap rounded bg-yellow-500/15 px-1.5 py-0.5 text-[8px] font-bold text-yellow-200">REVISAR {Math.round(item.confidence * 100)}%</span>
                    )}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-[130px_minmax(0,1fr)]">
                    <input aria-label="Data do lançamento" type="date" value={item.date.slice(0, 10)} onChange={(event) => handleUpdateItem(item.id, { date: event.target.value })} className="rounded-lg border border-white/10 bg-black/20 px-2 py-1 text-[10px] text-white" />
                    <input aria-label="Categoria do lançamento" value={item.category} onChange={(event) => handleUpdateItem(item.id, { category: event.target.value })} className="min-w-0 rounded-lg border border-white/10 bg-black/20 px-2 py-1 text-[10px] text-white" />
                  </div>
                </div>

                <div className="col-start-2 text-right md:col-start-auto">
                  <label className="block text-[8px] font-bold uppercase text-white/35">{item.type === 'income' ? 'Entrada' : 'Saída'}
                    <input aria-label="Valor do lançamento" type="number" min="0.01" step="0.01" value={item.amount} onChange={(event) => handleUpdateItem(item.id, { amount: Math.abs(Number(event.target.value || 0)) })} className={`mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-2 py-1.5 text-right text-sm font-bold ${item.type === 'income' ? 'text-green-400' : 'text-white'}`} />
                  </label>
                  <div className="mt-1 text-[8px] text-white/40 uppercase font-bold">{item.bank_source} · confiança {Math.round(item.confidence * 100)}%</div>
                </div>

                <div className="col-start-2 flex items-center justify-end gap-1 md:col-start-auto">
                  <button
                    type="button"
                    aria-label={item.status === 'ready' ? `Não importar ${item.description}` : `Aprovar ${item.description}`}
                    onClick={() => handleToggleStatus(item.id)}
                    className={`p-2 rounded-lg transition-colors ${item.status === 'ready' ? 'text-green-400 bg-green-400/10' : 'text-white/20 hover:text-white/40 bg-white/5'}`}
                  >
                    <Check size={16} />
                  </button>
                  <button
                    type="button"
                    aria-label={`Remover ${item.description}`}
                    onClick={() => handleRemove(item.id)}
                    className="p-2 text-white/20 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
            {importedData.length === 0 && (
              <div className="p-4 rounded-xl border border-yellow-500/20 bg-yellow-500/5 text-xs text-yellow-300">
                {importDiagnostics?.reason || 'Nenhum lancamento valido encontrado. Revise o formato e tente novamente.'}
              </div>
            )}
          </div>
        </div>
      )}

      {pdfPasswordPrompt && (
        <div className="fixed inset-0 z-[200] grid place-items-center bg-black/80 p-5 backdrop-blur-md" role="dialog" aria-modal="true" aria-labelledby="mf-pdf-password-title">
          <form
            className="w-full max-w-md rounded-3xl border border-white/10 bg-[#151515] p-6 shadow-2xl"
            onSubmit={(event) => {
              event.preventDefault();
              if (pdfPassword) finishPdfPassword(pdfPassword);
            }}
          >
            <span className="inline-flex rounded-full bg-purple-500/15 px-2.5 py-1 text-[10px] font-black tracking-widest text-purple-300">PDF PROTEGIDO</span>
            <h3 id="mf-pdf-password-title" className="mt-3 text-xl font-black">{pdfPasswordPrompt.incorrect ? 'Senha incorreta' : 'Este extrato precisa de senha'}</h3>
            <p className="mt-2 text-xs leading-5 text-white/55">{pdfPasswordPrompt.incorrect ? 'A senha informada não abriu o PDF. Confira e tente novamente.' : 'A senha será usada somente nesta leitura e não será salva.'}</p>
            <div className="mt-4 truncate rounded-xl bg-white/5 px-3 py-2 text-[10px] text-white/45">{pdfPasswordPrompt.fileName || 'Arquivo PDF protegido'}</div>
            <label className="mt-4 block text-[10px] font-bold uppercase tracking-widest text-white/55">Senha do PDF
              <div className="mt-2 flex gap-2">
                <input autoFocus autoComplete="off" type={showPdfPassword ? 'text' : 'password'} value={pdfPassword} onChange={(event) => setPdfPassword(event.target.value)} className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/35 px-3 py-3 text-sm text-white outline-none focus:border-purple-400/60" />
                <button type="button" onClick={() => setShowPdfPassword((current) => !current)} className="rounded-xl border border-white/10 px-3 text-[10px] font-bold text-white/65">{showPdfPassword ? 'Ocultar' : 'Mostrar'}</button>
              </div>
            </label>
            {pdfPasswordPrompt.incorrect && <p className="mt-2 text-[10px] text-red-300">Senha incorreta. Tente novamente.</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => finishPdfPassword(null)} className="rounded-xl border border-white/10 px-4 py-2.5 text-xs font-bold text-white/65">Cancelar</button>
              <button type="submit" disabled={!pdfPassword} className="rounded-xl bg-purple-600 px-4 py-2.5 text-xs font-black text-white disabled:opacity-40">Abrir PDF</button>
            </div>
            <p className="mt-4 text-[9px] leading-4 text-white/30">A senha permanece apenas na memória durante a abertura do arquivo.</p>
          </form>
        </div>
      )}
    </div>
  );
}
