import { format } from 'date-fns';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  FileText,
  Inbox,
  Loader2,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';

import { supabase } from '../../lib/supabase';
import type {
  FinancialAccount,
  Transaction,
  TransactionCategory,
} from '../../types';
import { inferAdaptiveCategory } from '../lib/adaptive-category';
import { MOBILE_ROUTES } from '../routes';
import './mobile-inbox.css';

type DocumentExtraction = {
  id: string;
  user_id: string;
  account_id?: string | null;
  source_file_name: string;
  source_mime_type: string;
  source_file_size: number;
  status: 'uploaded' | 'processing' | 'reviewing' | 'failed';
  document_confidence?: number | null;
  result_metadata?: Record<string, unknown> | null;
  error_message?: string | null;
  created_at: string;
};

type ReviewState = {
  amount: string;
  description: string;
  dueDate: string;
  paymentStatus: '' | 'pending' | 'paid';
  categoryId: string;
  accountId: string;
};

type MobileDocumentInboxProps = {
  userId: string;
  accounts: FinancialAccount[];
  categories: TransactionCategory[];
  history?: Transaction[];
  onImported: () => Promise<void> | void;
};

const EXTRACTION_SELECT =
  'id,user_id,account_id,source_file_name,source_mime_type,source_file_size,status,document_confidence,result_metadata,error_message,created_at';

function metadataString(
  metadata: Record<string, unknown> | null | undefined,
  key: string,
) {
  const value = metadata?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function metadataNumber(
  metadata: Record<string, unknown> | null | undefined,
  key: string,
) {
  const value = Number(metadata?.[key]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function metadataWarnings(
  metadata: Record<string, unknown> | null | undefined,
) {
  const value = metadata?.warnings;
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === 'string')
        .slice(0, 5)
    : [];
}

function parseMoneyInput(value: string) {
  const clean = value.trim().replace(/\s/g, '');
  if (!clean) return Number.NaN;
  if (clean.includes(','))
    return Number(clean.replace(/\./g, '').replace(',', '.'));
  return Number(clean);
}

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function confidenceLabel(value?: number | null) {
  const confidence = Number(value || 0);
  if (confidence >= 0.85) return 'Alta';
  if (confidence >= 0.65) return 'Média';
  return 'Baixa';
}

function documentKindLabel(metadata?: Record<string, unknown> | null) {
  const kind = metadataString(metadata, 'document_kind');
  if (kind === 'utility_bill') return 'Conta de consumo';
  if (kind === 'receipt') return 'Recibo';
  if (kind === 'invoice') return 'Fatura';
  if (kind === 'payment_slip') return 'Boleto';
  if (kind === 'pix_charge') return 'Cobrança Pix';
  if (kind === 'bill') return 'Conta';
  return 'Documento';
}

export default function MobileDocumentInbox({
  userId,
  accounts,
  categories,
  history = [],
  onImported,
}: MobileDocumentInboxProps) {
  const navigate = useNavigate();
  const [queue, setQueue] = useState<DocumentExtraction[]>([]);
  const [selected, setSelected] = useState<DocumentExtraction | null>(null);
  const [review, setReview] = useState<ReviewState>({
    amount: '',
    description: '',
    dueDate: '',
    paymentStatus: '',
    categoryId: '',
    accountId: '',
  });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const expenseCategories = useMemo(
    () =>
      categories.filter(
        (category) =>
          category.is_active &&
          (category.category_type === 'expense' ||
            category.category_type === 'both'),
      ),
    [categories],
  );

  const refreshQueue = useCallback(async () => {
    setError(null);
    try {
      const { data, error: loadError } = await supabase
        .from('mf_document_extractions')
        .select(EXTRACTION_SELECT)
        .eq('user_id', userId)
        .eq('document_type', 'other')
        .in('status', ['uploaded', 'processing', 'reviewing', 'failed'])
        .order('created_at', { ascending: false })
        .limit(30);
      if (loadError) throw loadError;
      setQueue((data || []) as DocumentExtraction[]);
    } catch (loadError: any) {
      setError(
        loadError?.message || 'Não foi possível carregar contas e recibos.',
      );
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void refreshQueue();
  }, [refreshQueue]);

  function buildReview(extraction: DocumentExtraction) {
    const metadata = extraction.result_metadata || {};
    const merchant = metadataString(metadata, 'merchant_name');
    const description =
      metadataString(metadata, 'description') ||
      merchant ||
      extraction.source_file_name.replace(/\.[^.]+$/, '');
    const amount = metadataNumber(metadata, 'amount');
    const hint = metadataString(metadata, 'category_hint');
    const hintedCategory = hint
      ? expenseCategories.find(
          (category) =>
            category.name.trim().toLocaleLowerCase('pt-BR') ===
            hint.toLocaleLowerCase('pt-BR'),
        )
      : null;
    const adaptive = inferAdaptiveCategory({
      merchantText: merchant || description,
      type: 'expense',
      history,
      categories,
    });
    const paymentStatus = metadataString(metadata, 'payment_status');

    setReview({
      amount: amount ? String(amount).replace('.', ',') : '',
      description,
      dueDate: metadataString(metadata, 'due_date'),
      paymentStatus:
        paymentStatus === 'paid' || paymentStatus === 'pending'
          ? paymentStatus
          : '',
      categoryId:
        adaptive?.confidence === 'high'
          ? adaptive.categoryId
          : hintedCategory?.id || '',
      accountId:
        extraction.account_id ||
        accounts.find((account) => account.is_default)?.id ||
        accounts[0]?.id ||
        '',
    });
  }

  function openExtraction(extraction: DocumentExtraction) {
    setSelected(extraction);
    setError(null);
    setNotice(null);
    buildReview(extraction);
  }

  async function processExtraction(extraction: DocumentExtraction) {
    if (busy) return;
    setBusy(`ocr-${extraction.id}`);
    setError(null);
    setNotice(null);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke(
        'document-ocr',
        { body: { extractionId: extraction.id } },
      );
      if (invokeError) throw invokeError;
      if (data?.error) throw new Error(String(data.error));

      const { data: refreshed, error: refreshError } = await supabase
        .from('mf_document_extractions')
        .select(EXTRACTION_SELECT)
        .eq('id', extraction.id)
        .eq('user_id', userId)
        .single();
      if (refreshError || !refreshed)
        throw (
          refreshError ||
          new Error('A análise terminou, mas não foi possível abrir a revisão.')
        );
      await refreshQueue();
      openExtraction(refreshed as DocumentExtraction);
      setNotice(
        'Análise concluída. Confira todos os campos antes de registrar.',
      );
    } catch (processError: any) {
      setError(
        processError?.message || 'Não foi possível analisar este documento.',
      );
      await refreshQueue();
    } finally {
      setBusy(null);
    }
  }

  const selectedCategory =
    expenseCategories.find((category) => category.id === review.categoryId) ||
    null;
  const adaptiveSuggestion = selected
    ? inferAdaptiveCategory({
        merchantText:
          metadataString(selected.result_metadata, 'merchant_name') ||
          review.description,
        type: 'expense',
        history,
        categories,
      })
    : null;

  async function confirmDocument(event: React.FormEvent) {
    event.preventDefault();
    if (!selected || busy) return;
    setError(null);
    setNotice(null);

    const amount = parseMoneyInput(review.amount);
    if (!Number.isFinite(amount) || amount <= 0)
      return setError('Confirme um valor maior que zero.');
    if (!review.description.trim()) return setError('Confirme a descrição.');
    if (!review.paymentStatus)
      return setError('Informe se a conta está a pagar ou já foi paga.');
    if (review.paymentStatus === 'pending' && !review.dueDate)
      return setError('Confirme o vencimento da conta pendente.');
    if (!review.accountId) return setError('Selecione a conta financeira.');
    if (!selectedCategory) return setError('Selecione a categoria.');

    setBusy('confirm');
    try {
      const { error: rpcError } = await supabase.rpc(
        'mf_create_finance_entry_v3',
        {
          p_type: 'expense',
          p_amount: amount,
          p_date: format(new Date(), 'yyyy-MM-dd'),
          p_description: review.description.trim(),
          p_account_id: review.accountId,
          p_category_id: selectedCategory.id,
          p_category: selectedCategory.name,
          p_payment_method: 'other',
          p_status: review.paymentStatus,
          p_card_id: null,
          p_installment_count: 1,
          p_due_date:
            review.paymentStatus === 'pending' ? review.dueDate : null,
          p_notes: `Revisado no MF Inbox · ${documentKindLabel(selected.result_metadata)}`,
          p_source: 'MF Inbox Document Mobile',
        },
      );
      if (rpcError) throw rpcError;

      const { error: finishError } = await supabase
        .from('mf_document_extractions')
        .update({
          account_id: review.accountId,
          status: 'completed',
          result_metadata: {
            ...(selected.result_metadata || {}),
            reviewed_from: 'MF Inbox Document Mobile',
            reviewed_category_id: selectedCategory.id,
            reviewed_category_name: selectedCategory.name,
            reviewed_payment_status: review.paymentStatus,
            reviewed_description: review.description.trim(),
            reviewed_amount: amount,
            reviewed_due_date:
              review.paymentStatus === 'pending' ? review.dueDate : null,
            requires_human_review: false,
          },
          completed_at: new Date().toISOString(),
        })
        .eq('id', selected.id)
        .eq('user_id', userId);
      if (finishError) throw finishError;

      await onImported();
      setSelected(null);
      setNotice('Documento confirmado e registrado no MF.');
      await refreshQueue();
    } catch (saveError: any) {
      setError(
        saveError?.message || 'Não foi possível confirmar este documento.',
      );
    } finally {
      setBusy(null);
    }
  }

  if (selected) {
    const warnings = metadataWarnings(selected.result_metadata);
    const ready = selected.status === 'reviewing';
    return (
      <div className="mf-mobile-focus-page">
        <header className="mf-mobile-focus-header">
          <button
            type="button"
            className="mf-mobile-icon-button"
            onClick={() => {
              setSelected(null);
              setError(null);
              setNotice(null);
            }}
            aria-label="Voltar para contas e recibos"
          >
            <ArrowLeft size={21} />
          </button>
          <div>
            <span className="mf-mobile-eyebrow">MF Inbox</span>
            <h1>Revisar documento</h1>
          </div>
          <span
            className="mf-mobile-icon-button mf-mobile-inbox__header-icon"
            aria-hidden="true"
          >
            <FileText size={19} />
          </span>
        </header>

        <main className="mf-mobile-inbox-review">
          <section className="mf-mobile-inbox-document">
            <FileText size={22} />
            <div>
              <strong>{selected.source_file_name}</strong>
              <small>
                {documentKindLabel(selected.result_metadata)} ·{' '}
                {formatFileSize(selected.source_file_size)}
              </small>
            </div>
            <span
              data-confidence={confidenceLabel(
                selected.document_confidence,
              ).toLowerCase()}
            >
              {confidenceLabel(selected.document_confidence)}
            </span>
          </section>

          {warnings.map((warning, index) => (
            <div
              key={`${warning}-${index}`}
              className="mf-mobile-feedback warning"
            >
              <AlertTriangle size={15} />
              {warning}
            </div>
          ))}
          {adaptiveSuggestion ? (
            <div
              className={`mf-mobile-feedback ${adaptiveSuggestion.confidence === 'high' ? 'success' : 'warning'}`}
            >
              <Sparkles size={15} />
              <span>
                Seu histórico sugere {adaptiveSuggestion.categoryName} (
                {adaptiveSuggestion.matchCount} casos parecidos).
              </span>
              {adaptiveSuggestion.confidence === 'medium' ? (
                <button
                  type="button"
                  onClick={() =>
                    setReview((current) => ({
                      ...current,
                      categoryId: adaptiveSuggestion.categoryId,
                    }))
                  }
                >
                  Usar
                </button>
              ) : null}
            </div>
          ) : null}

          {selected.status === 'failed' || selected.status === 'uploaded' ? (
            <section
              className="mf-mobile-inbox-state-card"
              data-tone={selected.status === 'failed' ? 'danger' : undefined}
            >
              {selected.status === 'failed' ? (
                <AlertTriangle size={25} />
              ) : (
                <ShieldCheck size={25} />
              )}
              <strong>
                {selected.status === 'failed'
                  ? 'A análise falhou'
                  : 'Documento ainda não analisado'}
              </strong>
              <p>
                {selected.error_message ||
                  'O arquivo continua privado e pode ser analisado quando você decidir.'}
              </p>
              <button
                type="button"
                onClick={() => void processExtraction(selected)}
                disabled={Boolean(busy)}
              >
                <ScanLine size={16} />
                Analisar com IA
              </button>
            </section>
          ) : selected.status === 'processing' ? (
            <section className="mf-mobile-inbox-state-card">
              <Loader2 className="animate-spin" size={27} />
              <strong>Analisando documento</strong>
              <p>Volte à fila e atualize em instantes.</p>
            </section>
          ) : ready ? (
            <form className="mf-mobile-inbox-items" onSubmit={confirmDocument}>
              <label className="mf-mobile-amount-field">
                <span>Valor</span>
                <div>
                  <small>R$</small>
                  <input
                    inputMode="decimal"
                    value={review.amount}
                    onChange={(event) =>
                      setReview((current) => ({
                        ...current,
                        amount: event.target.value.replace(/[^0-9,.]/g, ''),
                      }))
                    }
                    placeholder="0,00"
                  />
                </div>
              </label>
              <label className="mf-mobile-field">
                <span>Descrição</span>
                <input
                  value={review.description}
                  onChange={(event) =>
                    setReview((current) => ({
                      ...current,
                      description: event.target.value,
                    }))
                  }
                />
              </label>

              <div
                className="mf-mobile-segmented"
                role="group"
                aria-label="Situação do documento"
              >
                <button
                  type="button"
                  data-active={review.paymentStatus === 'pending'}
                  onClick={() =>
                    setReview((current) => ({
                      ...current,
                      paymentStatus: 'pending',
                    }))
                  }
                >
                  A pagar
                </button>
                <button
                  type="button"
                  data-active={review.paymentStatus === 'paid'}
                  onClick={() =>
                    setReview((current) => ({
                      ...current,
                      paymentStatus: 'paid',
                      dueDate: '',
                    }))
                  }
                >
                  Já pago
                </button>
              </div>

              {review.paymentStatus === 'pending' ? (
                <label className="mf-mobile-field">
                  <span>Vencimento</span>
                  <input
                    type="date"
                    value={review.dueDate}
                    onChange={(event) =>
                      setReview((current) => ({
                        ...current,
                        dueDate: event.target.value,
                      }))
                    }
                  />
                </label>
              ) : null}

              <label className="mf-mobile-field">
                <span>Categoria</span>
                <select
                  value={review.categoryId}
                  onChange={(event) =>
                    setReview((current) => ({
                      ...current,
                      categoryId: event.target.value,
                    }))
                  }
                >
                  <option value="">Selecione</option>
                  {expenseCategories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </label>
              {accounts.length > 1 ? (
                <label className="mf-mobile-field">
                  <span>Conta</span>
                  <select
                    value={review.accountId}
                    onChange={(event) =>
                      setReview((current) => ({
                        ...current,
                        accountId: event.target.value,
                      }))
                    }
                  >
                    <option value="">Selecione</option>
                    {accounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              {error ? (
                <div className="mf-mobile-feedback error">{error}</div>
              ) : null}
              {notice ? (
                <div className="mf-mobile-feedback success">
                  <Check size={15} />
                  {notice}
                </div>
              ) : null}
              <button
                type="submit"
                className="mf-mobile-primary-button"
                disabled={Boolean(busy)}
              >
                {busy === 'confirm' ? (
                  <Loader2 className="animate-spin" size={17} />
                ) : (
                  <Check size={17} />
                )}
                Confirmar no MF
              </button>
              <p className="mf-mobile-inbox-disclaimer">
                Nada é pago por esta tela. A confirmação apenas registra a conta
                ou despesa no seu controle financeiro.
              </p>
            </form>
          ) : null}
        </main>
      </div>
    );
  }

  return (
    <div className="mf-mobile-focus-page">
      <header className="mf-mobile-focus-header">
        <button
          type="button"
          className="mf-mobile-icon-button"
          onClick={() => navigate(MOBILE_ROUTES.more)}
          aria-label="Voltar para Mais"
        >
          <ArrowLeft size={21} />
        </button>
        <div>
          <span className="mf-mobile-eyebrow">MF Inbox</span>
          <h1>Contas e recibos</h1>
        </div>
        <button
          type="button"
          className="mf-mobile-icon-button"
          onClick={() => void refreshQueue()}
          aria-label="Atualizar fila"
        >
          <RefreshCw size={18} />
        </button>
      </header>

      <main className="mf-mobile-inbox">
        <section className="mf-mobile-inbox-upload">
          <div className="mf-mobile-inbox-upload__icon">
            <ScanLine size={23} />
          </div>
          <div>
            <strong>Capturar novo documento</strong>
            <p>
              Use o MF Scan para câmera, galeria, PDF ou conteúdo compartilhado.
            </p>
          </div>
          <button
            type="button"
            className="mf-mobile-primary-button"
            onClick={() => navigate(MOBILE_ROUTES.scan)}
          >
            <ScanLine size={17} />
            Abrir MF Scan
          </button>
        </section>

        {error ? <div className="mf-mobile-feedback error">{error}</div> : null}
        {notice ? (
          <div className="mf-mobile-feedback success">
            <Check size={15} />
            {notice}
          </div>
        ) : null}

        <section className="mf-mobile-inbox-queue">
          <div className="mf-mobile-inbox-queue__title">
            <div>
              <span>Fila de documentos</span>
              <small>Contas e recibos ainda não finalizados</small>
            </div>
            <b>{queue.length}</b>
          </div>
          {loading ? (
            <div className="mf-mobile-inbox-empty">
              <Loader2 className="animate-spin" size={26} />
              <strong>Carregando fila</strong>
            </div>
          ) : queue.length ? (
            queue.map((extraction) => (
              <button
                key={extraction.id}
                type="button"
                className="mf-mobile-inbox-queue-item"
                onClick={() => openExtraction(extraction)}
              >
                <span className="mf-mobile-inbox-queue-item__icon">
                  <FileText size={19} />
                </span>
                <div>
                  <strong>{extraction.source_file_name}</strong>
                  <small>
                    {documentKindLabel(extraction.result_metadata)} ·{' '}
                    {new Date(extraction.created_at).toLocaleDateString(
                      'pt-BR',
                    )}
                  </small>
                </div>
                <span
                  className="mf-mobile-inbox-status"
                  data-status={extraction.status}
                >
                  {extraction.status === 'processing' ? (
                    <Loader2 className="animate-spin" size={14} />
                  ) : extraction.status === 'reviewing' ? (
                    'Revisar'
                  ) : extraction.status === 'failed' ? (
                    'Falhou'
                  ) : (
                    'Analisar'
                  )}
                </span>
              </button>
            ))
          ) : (
            <div className="mf-mobile-inbox-empty">
              <Inbox size={29} />
              <strong>Nada para revisar</strong>
              <p>
                Documentos analisados pelo MF Scan e ainda não confirmados
                aparecerão aqui.
              </p>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
