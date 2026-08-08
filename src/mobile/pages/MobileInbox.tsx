import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronRight,
  FileText,
  Inbox,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Upload,
  X,
} from 'lucide-react';
import { useNavigate } from 'react-router';

import { supabase } from '../../lib/supabase';
import type { FinancialAccount, TransactionCategory } from '../../types';
import { MOBILE_ROUTES } from '../routes';
import './mobile-inbox.css';

type ExtractionStatus = 'uploaded' | 'processing' | 'reviewing' | 'failed';
type ReviewStatus = 'pending' | 'accepted' | 'edited' | 'rejected';

type InboxExtraction = {
  id: string;
  user_id: string;
  account_id?: string | null;
  source_file_path: string;
  source_file_name: string;
  source_mime_type: string;
  source_file_size: number;
  source_file_hash?: string | null;
  document_type: string;
  status: ExtractionStatus;
  provider?: string | null;
  model?: string | null;
  document_confidence?: number | null;
  result_metadata?: Record<string, unknown> | null;
  error_message?: string | null;
  created_at: string;
  updated_at: string;
};

type InboxItem = {
  id: string;
  extraction_id: string;
  user_id: string;
  line_number: number;
  transaction_date?: string | null;
  description?: string | null;
  signed_amount?: number | null;
  transaction_type?: 'income' | 'expense' | null;
  source_name?: string | null;
  external_id?: string | null;
  running_balance?: number | null;
  category_id?: string | null;
  category_name?: string | null;
  overall_confidence: number;
  field_confidence?: Record<string, number> | null;
  review_status: ReviewStatus;
};

type EditableItem = InboxItem & {
  amountText: string;
  dirty: boolean;
};

type MobileInboxProps = {
  userId: string;
  accounts: FinancialAccount[];
  categories: TransactionCategory[];
  onImported: () => Promise<void> | void;
};

const ALLOWED_MIME_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
const MAX_FILE_SIZE = 20 * 1024 * 1024;
const EXTRACTION_SELECT = 'id,user_id,account_id,source_file_path,source_file_name,source_mime_type,source_file_size,source_file_hash,document_type,status,provider,model,document_confidence,result_metadata,error_message,created_at,updated_at';

function parseMoneyInput(value: string) {
  const clean = value.trim().replace(/\s/g, '');
  if (!clean) return Number.NaN;
  if (clean.includes(',')) return Number(clean.replace(/\./g, '').replace(',', '.'));
  return Number(clean);
}

function confidenceText(value?: number | null) {
  const confidence = Number(value || 0);
  if (confidence >= 0.85) return 'Alta';
  if (confidence >= 0.65) return 'Média';
  return 'Baixa';
}

function statusLabel(status: ExtractionStatus) {
  if (status === 'uploaded') return 'Aguardando OCR';
  if (status === 'processing') return 'Analisando';
  if (status === 'reviewing') return 'Revisar';
  return 'Falhou';
}

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function safeFileName(name: string) {
  const cleaned = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return cleaned.slice(0, 140) || 'extrato';
}

function metadataText(metadata: Record<string, unknown> | null | undefined, key: string) {
  const value = metadata?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function metadataWarnings(metadata: Record<string, unknown> | null | undefined) {
  const warnings = metadata?.warnings;
  return Array.isArray(warnings) ? warnings.filter((item): item is string => typeof item === 'string').slice(0, 5) : [];
}

function initialCategoryId(item: InboxItem, categories: TransactionCategory[]) {
  if (item.category_id && categories.some((category) => category.id === item.category_id)) return item.category_id;
  const key = String(item.category_name || '').trim().toLocaleLowerCase('pt-BR');
  return categories.find((category) => category.name.trim().toLocaleLowerCase('pt-BR') === key)?.id || '';
}

function itemAmount(item: InboxItem) {
  const value = Math.abs(Number(item.signed_amount || 0));
  return value > 0 ? String(value).replace('.', ',') : '';
}

export default function MobileInbox({ userId, accounts, categories, onImported }: MobileInboxProps) {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [queue, setQueue] = useState<InboxExtraction[]>([]);
  const [selected, setSelected] = useState<InboxExtraction | null>(null);
  const [items, setItems] = useState<EditableItem[]>([]);
  const [uploadAccountId, setUploadAccountId] = useState(() => accounts.find((account) => account.is_default)?.id || accounts[0]?.id || '');
  const [reviewAccountId, setReviewAccountId] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingItems, setLoadingItems] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const expenseCategories = useMemo(
    () => categories.filter((category) => category.is_active && (category.category_type === 'expense' || category.category_type === 'both')),
    [categories],
  );
  const incomeCategories = useMemo(
    () => categories.filter((category) => category.is_active && (category.category_type === 'income' || category.category_type === 'both')),
    [categories],
  );

  const refreshQueue = useCallback(async () => {
    setError(null);
    try {
      const { data, error: loadError } = await supabase
        .from('mf_document_extractions')
        .select(EXTRACTION_SELECT)
        .eq('user_id', userId)
        .eq('document_type', 'statement')
        .in('status', ['uploaded', 'processing', 'reviewing', 'failed'])
        .order('created_at', { ascending: false })
        .limit(30);
      if (loadError) throw loadError;
      setQueue((data || []) as InboxExtraction[]);
    } catch (loadError: any) {
      setError(loadError?.message || 'Não foi possível carregar o MF Inbox.');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { void refreshQueue(); }, [refreshQueue]);

  async function processExtraction(extraction: InboxExtraction, force = false) {
    if (busy && !force) return;
    setBusy(`ocr-${extraction.id}`);
    setError(null);
    setNotice(null);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('statement-ocr', {
        body: { extractionId: extraction.id },
      });
      if (invokeError) throw invokeError;
      if (data?.error) throw new Error(String(data.error));

      const { data: refreshedExtraction, error: refreshError } = await supabase
        .from('mf_document_extractions')
        .select(EXTRACTION_SELECT)
        .eq('id', extraction.id)
        .eq('user_id', userId)
        .single();
      if (refreshError || !refreshedExtraction) throw refreshError || new Error('O OCR terminou, mas a revisão não pôde ser carregada.');

      setNotice('OCR concluído. Revise os lançamentos antes de importar.');
      await refreshQueue();
      await openExtraction(refreshedExtraction as InboxExtraction);
    } catch (processError: any) {
      const message = processError?.message || 'Não foi possível analisar o extrato.';
      await refreshQueue();
      setError(message);
    } finally {
      setBusy(null);
    }
  }

  async function uploadStatement(file?: File) {
    if (!file || busy) return;
    setError(null);
    setNotice(null);

    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      setError('Envie um extrato em PDF, JPEG, PNG ou WebP.');
      return;
    }
    if (file.size < 1 || file.size > MAX_FILE_SIZE) {
      setError('O arquivo deve ter até 20 MB.');
      return;
    }
    if (!uploadAccountId) {
      setError('Escolha a conta financeira relacionada ao extrato.');
      return;
    }

    setBusy('upload');
    const objectPath = `${userId}/mobile-inbox/${crypto.randomUUID()}-${safeFileName(file.name)}`;
    let uploaded = false;
    try {
      const { error: uploadError } = await supabase.storage
        .from('mf-import-documents')
        .upload(objectPath, file, { contentType: file.type, upsert: false });
      if (uploadError) throw uploadError;
      uploaded = true;

      const { data: extraction, error: insertError } = await supabase
        .from('mf_document_extractions')
        .insert({
          user_id: userId,
          account_id: uploadAccountId,
          source_file_path: objectPath,
          source_file_name: file.name.slice(0, 240),
          source_mime_type: file.type,
          source_file_size: file.size,
          document_type: 'statement',
          status: 'uploaded',
          result_metadata: { uploaded_from: 'MF Inbox Mobile' },
        })
        .select(EXTRACTION_SELECT)
        .single();
      if (insertError || !extraction) throw insertError || new Error('Não foi possível registrar o documento.');

      setNotice('Extrato enviado. Iniciando análise segura.');
      await refreshQueue();
      await processExtraction(extraction as InboxExtraction, true);
    } catch (uploadError: any) {
      if (uploaded) {
        const { data: registered } = await supabase
          .from('mf_document_extractions')
          .select('id')
          .eq('user_id', userId)
          .eq('source_file_path', objectPath)
          .maybeSingle();
        if (!registered) await supabase.storage.from('mf-import-documents').remove([objectPath]);
      }
      setError(uploadError?.message || 'Não foi possível enviar o extrato.');
    } finally {
      setBusy(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function openExtraction(extraction: InboxExtraction) {
    setSelected(extraction);
    setReviewAccountId(extraction.account_id || accounts.find((account) => account.is_default)?.id || accounts[0]?.id || '');
    setItems([]);
    setLoadingItems(extraction.status === 'reviewing');
    setError(null);

    if (extraction.status !== 'reviewing') return;
    try {
      const { data, error: itemError } = await supabase
        .from('mf_document_extraction_items')
        .select('id,extraction_id,user_id,line_number,transaction_date,description,signed_amount,transaction_type,source_name,external_id,running_balance,category_id,category_name,overall_confidence,field_confidence,review_status')
        .eq('user_id', userId)
        .eq('extraction_id', extraction.id)
        .order('line_number');
      if (itemError) throw itemError;

      setItems(((data || []) as InboxItem[]).map((item) => ({
        ...item,
        category_id: initialCategoryId(item, categories),
        amountText: itemAmount(item),
        dirty: false,
      })));
    } catch (itemError: any) {
      setError(itemError?.message || 'Não foi possível carregar os itens extraídos.');
    } finally {
      setLoadingItems(false);
    }
  }

  function patchItem(id: string, patch: Partial<EditableItem>) {
    setItems((current) => current.map((item) => item.id === id ? { ...item, ...patch, dirty: true } : item));
  }

  function toggleIncluded(item: EditableItem) {
    patchItem(item.id, { review_status: item.review_status === 'rejected' ? 'pending' : 'rejected' });
  }

  function compatibleCategories(item: EditableItem) {
    return item.transaction_type === 'income' ? incomeCategories : expenseCategories;
  }

  function selectedCategory(item: EditableItem) {
    return compatibleCategories(item).find((category) => category.id === item.category_id);
  }

  const validation = useMemo(() => {
    const included = items.filter((item) => item.review_status !== 'rejected');
    const invalid = included.filter((item) => {
      const amount = parseMoneyInput(item.amountText);
      return !item.transaction_date
        || !item.description?.trim()
        || !item.transaction_type
        || !Number.isFinite(amount)
        || amount <= 0
        || !selectedCategory(item);
    });
    return { included, invalid };
  }, [items, expenseCategories, incomeCategories]);

  async function persistReview() {
    if (!selected) return;
    const reviewedAt = new Date().toISOString();
    const rows = items.map((item) => {
      const amount = parseMoneyInput(item.amountText);
      const category = selectedCategory(item);
      const rejected = item.review_status === 'rejected';
      return {
        id: item.id,
        extraction_id: item.extraction_id,
        user_id: userId,
        line_number: item.line_number,
        transaction_date: item.transaction_date || null,
        description: item.description?.trim() || null,
        signed_amount: Number.isFinite(amount) && amount > 0 && item.transaction_type
          ? (item.transaction_type === 'expense' ? -Math.abs(amount) : Math.abs(amount))
          : null,
        transaction_type: item.transaction_type || null,
        source_name: item.source_name || null,
        external_id: item.external_id || null,
        running_balance: item.running_balance ?? null,
        category_id: category?.id || null,
        category_name: category?.name || item.category_name || null,
        overall_confidence: Number(item.overall_confidence || 0),
        field_confidence: item.field_confidence || {},
        review_status: rejected ? 'rejected' : item.dirty ? 'edited' : item.review_status === 'accepted' ? 'accepted' : 'pending',
        reviewed_at: reviewedAt,
      };
    });

    const { error: reviewError } = await supabase
      .from('mf_document_extraction_items')
      .upsert(rows, { onConflict: 'id' });
    if (reviewError) throw reviewError;

    if (reviewAccountId !== selected.account_id) {
      const { error: extractionError } = await supabase
        .from('mf_document_extractions')
        .update({ account_id: reviewAccountId })
        .eq('id', selected.id)
        .eq('user_id', userId);
      if (extractionError) throw extractionError;
    }
  }

  async function saveReviewOnly() {
    if (!selected || busy) return;
    setBusy('save-review');
    setError(null);
    setNotice(null);
    try {
      await persistReview();
      setItems((current) => current.map((item) => ({
        ...item,
        review_status: item.review_status === 'rejected' ? 'rejected' : item.dirty ? 'edited' : item.review_status,
        dirty: false,
      })));
      setNotice('Revisão salva. Nada foi importado ainda.');
    } catch (saveError: any) {
      setError(saveError?.message || 'Não foi possível salvar a revisão.');
    } finally {
      setBusy(null);
    }
  }

  async function importReviewed() {
    if (!selected || busy) return;
    setError(null);
    setNotice(null);

    if (!reviewAccountId) {
      setError('Selecione a conta financeira do extrato.');
      return;
    }
    if (!validation.included.length) {
      setError('Inclua pelo menos um lançamento para importar.');
      return;
    }
    if (validation.invalid.length) {
      setError(`Corrija ou ignore ${validation.invalid.length} lançamento(s) incompleto(s) antes de importar.`);
      return;
    }

    setBusy('import');
    try {
      await persistReview();

      const entries = validation.included.map((item) => {
        const category = selectedCategory(item)!;
        return {
          selected: true,
          date: item.transaction_date,
          description: item.description?.trim(),
          category: category.name,
          amount: Math.abs(parseMoneyInput(item.amountText)),
          type: item.transaction_type,
          source: item.source_name || metadataText(selected.result_metadata, 'institution_name') || 'OCR/IA',
          external_id: item.external_id || null,
        };
      });

      const { data: importResult, error: importError } = await supabase.rpc('mf_commit_statement_import_v3', {
        p_entries: entries,
        p_account_id: reviewAccountId,
        p_balance_mode: 'keep',
        p_statement_balance: null,
        p_file_name: selected.source_file_name,
        p_file_type: selected.source_mime_type,
        p_file_size: selected.source_file_size,
        p_file_hash: selected.source_file_hash || null,
        p_parser_name: `statement-ocr:${selected.model || 'reviewed'}`,
        p_raw_metadata: {
          ...(selected.result_metadata || {}),
          document_extraction_id: selected.id,
          document_confidence: selected.document_confidence ?? null,
          reviewed_from: 'MF Inbox Mobile',
        },
      });
      if (importError) throw importError;

      const acceptedIds = validation.included.map((item) => item.id);
      if (acceptedIds.length) {
        const { error: acceptedError } = await supabase
          .from('mf_document_extraction_items')
          .update({ review_status: 'accepted', reviewed_at: new Date().toISOString() })
          .eq('user_id', userId)
          .eq('extraction_id', selected.id)
          .in('id', acceptedIds);
        if (acceptedError) throw acceptedError;
      }

      const nextMetadata = {
        ...(selected.result_metadata || {}),
        import_batch_id: importResult?.batch_id || null,
        import_summary: importResult || {},
        imported_from: 'MF Inbox Mobile',
      };
      const { error: finishError } = await supabase
        .from('mf_document_extractions')
        .update({
          account_id: reviewAccountId,
          status: 'completed',
          result_metadata: nextMetadata,
          completed_at: new Date().toISOString(),
        })
        .eq('id', selected.id)
        .eq('user_id', userId);
      if (finishError) throw finishError;

      await onImported();
      setSelected(null);
      setItems([]);
      setNotice(`${Number(importResult?.inserted_count || 0)} lançamento(s) importado(s); ${Number(importResult?.duplicate_count || 0)} duplicado(s) ignorado(s).`);
      await refreshQueue();
    } catch (importError: any) {
      setError(importError?.message || 'Não foi possível importar os lançamentos revisados.');
    } finally {
      setBusy(null);
    }
  }

  if (selected) {
    const institution = metadataText(selected.result_metadata, 'institution_name');
    const periodStart = metadataText(selected.result_metadata, 'period_start');
    const periodEnd = metadataText(selected.result_metadata, 'period_end');
    const warnings = metadataWarnings(selected.result_metadata);

    return (
      <div className="mf-mobile-focus-page">
        <header className="mf-mobile-focus-header">
          <button type="button" className="mf-mobile-icon-button" onClick={() => { setSelected(null); setItems([]); setError(null); }} aria-label="Voltar para o Inbox"><ArrowLeft size={21} /></button>
          <div><span className="mf-mobile-eyebrow">MF Inbox</span><h1>Revisar extrato</h1></div>
          <span className="mf-mobile-icon-button mf-mobile-inbox__header-icon" aria-hidden="true"><Inbox size={19} /></span>
        </header>

        <main className="mf-mobile-inbox-review">
          <section className="mf-mobile-inbox-document">
            <FileText size={22} />
            <div><strong>{selected.source_file_name}</strong><small>{formatFileSize(selected.source_file_size)}{institution ? ` · ${institution}` : ''}</small></div>
            <span data-confidence={confidenceText(selected.document_confidence).toLowerCase()}>{confidenceText(selected.document_confidence)}</span>
          </section>

          {(periodStart || periodEnd) ? <p className="mf-mobile-inbox-period">Período identificado: {periodStart || '—'} até {periodEnd || '—'}</p> : null}
          {warnings.map((warning, index) => <div key={`${warning}-${index}`} className="mf-mobile-feedback warning"><AlertTriangle size={15} />{warning}</div>)}

          {selected.status === 'failed' ? (
            <section className="mf-mobile-inbox-state-card" data-tone="danger">
              <AlertTriangle size={25} /><strong>A análise falhou</strong><p>{selected.error_message || 'O OCR não conseguiu processar este documento.'}</p>
              <button type="button" onClick={() => void processExtraction(selected)} disabled={busy === `ocr-${selected.id}`}><RefreshCw size={16} />Tentar OCR novamente</button>
            </section>
          ) : selected.status === 'uploaded' ? (
            <section className="mf-mobile-inbox-state-card">
              <ShieldCheck size={25} /><strong>Pronto para analisar</strong><p>O arquivo está privado e ainda não passou pelo OCR.</p>
              <button type="button" onClick={() => void processExtraction(selected)} disabled={busy === `ocr-${selected.id}`}><RefreshCw size={16} />Processar extrato</button>
            </section>
          ) : selected.status === 'processing' ? (
            <section className="mf-mobile-inbox-state-card"><Loader2 className="animate-spin" size={27} /><strong>Analisando o extrato</strong><p>Quando o OCR terminar, os lançamentos aparecerão para sua revisão.</p><button type="button" onClick={() => { setSelected(null); void refreshQueue(); }}><RefreshCw size={16} />Atualizar fila</button></section>
          ) : loadingItems ? (
            <section className="mf-mobile-inbox-state-card"><Loader2 className="animate-spin" size={27} /><strong>Carregando revisão</strong></section>
          ) : (
            <>
              <label className="mf-mobile-field">
                <span>Conta do extrato</span>
                <select value={reviewAccountId} onChange={(event) => setReviewAccountId(event.target.value)}>
                  <option value="">Selecione a conta</option>
                  {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
                </select>
              </label>

              <section className="mf-mobile-inbox-review-summary">
                <div><small>Incluídos</small><strong>{validation.included.length}</strong></div>
                <div><small>Ignorados</small><strong>{items.length - validation.included.length}</strong></div>
                <div data-warning={validation.invalid.length ? 'true' : 'false'}><small>Precisam ajuste</small><strong>{validation.invalid.length}</strong></div>
              </section>

              <div className="mf-mobile-inbox-items">
                {items.map((item) => {
                  const included = item.review_status !== 'rejected';
                  const categoryOptions = compatibleCategories(item);
                  const effectiveCategory = selectedCategory(item);
                  return (
                    <article key={item.id} className="mf-mobile-inbox-item" data-included={included ? 'true' : 'false'}>
                      <div className="mf-mobile-inbox-item__head">
                        <div><span>Linha {item.line_number}</span><small>Confiança {Math.round(Number(item.overall_confidence || 0) * 100)}%</small></div>
                        <button type="button" onClick={() => toggleIncluded(item)} aria-label={included ? 'Ignorar lançamento' : 'Incluir lançamento'}>{included ? <Check size={17} /> : <X size={17} />}{included ? 'Incluir' : 'Ignorado'}</button>
                      </div>

                      <label className="mf-mobile-field"><span>Descrição</span><input value={item.description || ''} onChange={(event) => patchItem(item.id, { description: event.target.value })} disabled={!included} /></label>
                      <div className="mf-mobile-inbox-item__grid">
                        <label className="mf-mobile-field"><span>Data</span><input type="date" value={item.transaction_date || ''} onChange={(event) => patchItem(item.id, { transaction_date: event.target.value })} disabled={!included} /></label>
                        <label className="mf-mobile-field"><span>Valor</span><input inputMode="decimal" value={item.amountText} onChange={(event) => patchItem(item.id, { amountText: event.target.value.replace(/[^0-9,.]/g, '') })} disabled={!included} /></label>
                      </div>

                      <div className="mf-mobile-segmented" role="group" aria-label={`Tipo da linha ${item.line_number}`}>
                        <button type="button" data-active={item.transaction_type === 'expense'} onClick={() => patchItem(item.id, { transaction_type: 'expense', category_id: '' })} disabled={!included}>Saída</button>
                        <button type="button" data-active={item.transaction_type === 'income'} onClick={() => patchItem(item.id, { transaction_type: 'income', category_id: '' })} disabled={!included}>Entrada</button>
                      </div>

                      <label className="mf-mobile-field"><span>Categoria</span><select value={effectiveCategory?.id || ''} onChange={(event) => patchItem(item.id, { category_id: event.target.value })} disabled={!included}><option value="">Selecione</option>{categoryOptions.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
                    </article>
                  );
                })}
                {!items.length ? <div className="mf-mobile-inbox-empty"><Inbox size={27} /><strong>Nenhuma linha foi extraída</strong><p>Você pode tentar o OCR novamente com um arquivo mais legível.</p></div> : null}
              </div>

              {error ? <div className="mf-mobile-feedback error">{error}</div> : null}
              {notice ? <div className="mf-mobile-feedback success"><Check size={15} />{notice}</div> : null}

              <div className="mf-mobile-inbox-review-actions">
                <button type="button" className="mf-mobile-secondary-button" onClick={() => void saveReviewOnly()} disabled={Boolean(busy) || !items.length}>{busy === 'save-review' ? <Loader2 className="animate-spin" size={16} /> : <ShieldCheck size={16} />}Salvar revisão</button>
                <button type="button" className="mf-mobile-primary-button" onClick={() => void importReviewed()} disabled={Boolean(busy) || !validation.included.length || Boolean(validation.invalid.length)}>{busy === 'import' ? <Loader2 className="animate-spin" size={17} /> : <Check size={17} />}Importar confirmados</button>
              </div>
              <p className="mf-mobile-inbox-disclaimer">A importação usa a deduplicação existente do MF por identificador/fingerprint e mantém o saldo atual da conta, registrando as movimentações sem recalibrar o saldo manualmente.</p>
            </>
          )}
        </main>
      </div>
    );
  }

  return (
    <div className="mf-mobile-focus-page">
      <header className="mf-mobile-focus-header">
        <button type="button" className="mf-mobile-icon-button" onClick={() => navigate(MOBILE_ROUTES.more)} aria-label="Voltar para Mais"><ArrowLeft size={21} /></button>
        <div><span className="mf-mobile-eyebrow">MF Inbox</span><h1>Revisões</h1></div>
        <button type="button" className="mf-mobile-icon-button" onClick={() => void refreshQueue()} aria-label="Atualizar Inbox"><RefreshCw size={18} /></button>
      </header>

      <main className="mf-mobile-inbox">
        <section className="mf-mobile-inbox-upload">
          <div className="mf-mobile-inbox-upload__icon"><Upload size={23} /></div>
          <div><strong>Enviar extrato para revisão</strong><p>PDF ou foto de extrato bancário. O OCR nunca importa automaticamente.</p></div>
          {accounts.length > 1 ? <label className="mf-mobile-field"><span>Conta relacionada</span><select value={uploadAccountId} onChange={(event) => setUploadAccountId(event.target.value)}>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label> : null}
          <button type="button" className="mf-mobile-primary-button" onClick={() => fileInputRef.current?.click()} disabled={busy === 'upload'}>{busy === 'upload' ? <Loader2 className="animate-spin" size={17} /> : <Upload size={17} />}Escolher extrato</button>
          <input ref={fileInputRef} hidden type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(event) => void uploadStatement(event.target.files?.[0])} />
          <small>Até 20 MB · PDF, JPEG, PNG ou WebP · armazenamento privado por usuário</small>
        </section>

        {error ? <div className="mf-mobile-feedback error">{error}</div> : null}
        {notice ? <div className="mf-mobile-feedback success"><Check size={15} />{notice}</div> : null}

        <section className="mf-mobile-inbox-queue">
          <div className="mf-mobile-inbox-queue__title"><div><span>Fila de revisão</span><small>Somente extratos ainda não finalizados</small></div><b>{queue.length}</b></div>

          {loading ? <div className="mf-mobile-inbox-empty"><Loader2 className="animate-spin" size={26} /><strong>Carregando Inbox</strong></div> : queue.length ? queue.map((extraction) => (
            <button key={extraction.id} type="button" className="mf-mobile-inbox-queue-item" onClick={() => void openExtraction(extraction)}>
              <span className="mf-mobile-inbox-queue-item__icon"><FileText size={19} /></span>
              <div><strong>{extraction.source_file_name}</strong><small>{statusLabel(extraction.status)} · {formatFileSize(extraction.source_file_size)} · {new Date(extraction.created_at).toLocaleDateString('pt-BR')}</small></div>
              <span className="mf-mobile-inbox-status" data-status={extraction.status}>{extraction.status === 'processing' ? <Loader2 className="animate-spin" size={14} /> : statusLabel(extraction.status)}</span>
              <ChevronRight size={17} />
            </button>
          )) : <div className="mf-mobile-inbox-empty"><Inbox size={29} /><strong>Nada para revisar</strong><p>Quando um extrato for analisado, ele ficará aqui até você confirmar ou corrigir as linhas.</p></div>}
        </section>
      </main>
    </div>
  );
}
