import { format } from 'date-fns';
import {
  ArrowLeft,
  Camera,
  Check,
  FileImage,
  FileText,
  Keyboard,
  Loader2,
  RotateCcw,
  ScanLine,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import type React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';

import { supabase } from '../../lib/supabase';
import type {
  FinancialAccount,
  Transaction,
  TransactionCategory,
} from '../../types';
import {
  type AdaptiveCategorySuggestion,
  inferAdaptiveCategory,
} from '../lib/adaptive-category';
import {
  analyzeDocumentWithOcr,
  completeDocumentOcrExtraction,
  DOCUMENT_OCR_ENABLED,
  type DocumentOcrMetadata,
} from '../lib/document-ocr';
import {
  type ParsedFinancialCode,
  parseFinancialCode,
} from '../lib/financial-code-parser';
import { MOBILE_ROUTES } from '../routes';
import type { MobileScannedDraft } from '../types';
import './mobile-scan.css';

type MobileScanProps = {
  userId: string;
  accounts: FinancialAccount[];
  categories: TransactionCategory[];
  history?: Transaction[];
  onSaved: () => Promise<void> | void;
  initialFile?: File | null;
  initialText?: string;
  captureSource?: string;
};

type DetectedBarcode = { rawValue: string; format?: string };
type BarcodeDetectorInstance = {
  detect(source: ImageBitmapSource): Promise<DetectedBarcode[]>;
};
type BarcodeDetectorConstructor = {
  new (options?: { formats?: string[] }): BarcodeDetectorInstance;
  getSupportedFormats?: () => Promise<string[]>;
};

type ReviewState = {
  amount: string;
  description: string;
  dueDate: string;
  categoryId: string;
  accountId: string;
  status: 'pending' | 'paid';
};

function detectorConstructor() {
  return (
    globalThis as typeof globalThis & {
      BarcodeDetector?: BarcodeDetectorConstructor;
    }
  ).BarcodeDetector;
}

function parseMoneyInput(value: string) {
  const clean = value.trim().replace(/\s/g, '');
  if (!clean) return Number.NaN;
  if (clean.includes(','))
    return Number(clean.replace(/\./g, '').replace(',', '.'));
  return Number(clean);
}

async function detectCodeFromImage(file: File) {
  if (!file.type.startsWith('image/')) return null;
  const Detector = detectorConstructor();
  if (!Detector || typeof createImageBitmap !== 'function') return null;

  try {
    const supported = Detector.getSupportedFormats
      ? await Detector.getSupportedFormats()
      : [];
    const desired = ['qr_code', 'code_128', 'itf', 'ean_13'].filter(
      (formatName) => supported.includes(formatName),
    );
    const detector = desired.length
      ? new Detector({ formats: desired })
      : new Detector();
    const bitmap = await createImageBitmap(file);
    try {
      const results = await detector.detect(bitmap);
      return (
        results.find((item) => item.rawValue?.trim())?.rawValue?.trim() || null
      );
    } finally {
      bitmap.close();
    }
  } catch {
    return null;
  }
}

function confidenceLabel(confidence?: MobileScannedDraft['confidence']) {
  if (confidence === 'high') return 'Confiança alta';
  if (confidence === 'medium') return 'Revisar dados';
  return 'Confirmação necessária';
}

function reviewConfidence(value: number): MobileScannedDraft['confidence'] {
  if (value >= 0.85) return 'high';
  if (value >= 0.65) return 'medium';
  return 'low';
}

function firstUsefulWarning(metadata: DocumentOcrMetadata) {
  return Array.isArray(metadata.warnings) && metadata.warnings.length
    ? metadata.warnings.slice(0, 2).join(' ')
    : '';
}

export default function MobileScan({
  userId,
  accounts,
  categories,
  history = [],
  onSaved,
  initialFile = null,
  initialText = '',
  captureSource = 'MF Scan Mobile',
}: MobileScanProps) {
  const navigate = useNavigate();
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const initialHandledRef = useRef(false);
  const [rawInput, setRawInput] = useState('');
  const [parsed, setParsed] = useState<ParsedFinancialCode | null>(null);
  const [draft, setDraft] = useState<MobileScannedDraft | null>(null);
  const [adaptiveSuggestion, setAdaptiveSuggestion] =
    useState<AdaptiveCategorySuggestion | null>(null);
  const [fileName, setFileName] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [ocrExtractionId, setOcrExtractionId] = useState('');
  const [processing, setProcessing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [review, setReview] = useState<ReviewState>(() => ({
    amount: '',
    description: '',
    dueDate: '',
    categoryId: '',
    accountId:
      accounts.find((item) => item.is_default)?.id || accounts[0]?.id || '',
    status: 'pending',
  }));

  const expenseCategories = useMemo(
    () =>
      categories.filter(
        (item) =>
          item.is_active &&
          (item.category_type === 'both' || item.category_type === 'expense'),
      ),
    [categories],
  );
  const selectedCategory =
    expenseCategories.find((item) => item.id === review.categoryId) ||
    expenseCategories[0];
  const effectiveCategoryId = selectedCategory?.id || '';

  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );

  function learnedSuggestion(nextDraft: MobileScannedDraft) {
    return inferAdaptiveCategory({
      merchantText: nextDraft.merchant || nextDraft.description || '',
      type: 'expense',
      history,
      categories,
    });
  }

  function applyDraft(
    nextDraft: MobileScannedDraft,
    nextParsed?: ParsedFinancialCode | null,
  ) {
    const defaultDescription =
      nextDraft.description || nextDraft.merchant || 'Documento financeiro';
    const learned = learnedSuggestion(nextDraft);
    setDraft(nextDraft);
    setParsed(nextParsed || null);
    setAdaptiveSuggestion(learned);
    setReview((current) => ({
      ...current,
      amount: nextDraft.amount
        ? String(nextDraft.amount).replace('.', ',')
        : '',
      description: defaultDescription,
      dueDate: nextDraft.dueDate || '',
      categoryId:
        learned?.confidence === 'high'
          ? learned.categoryId
          : current.categoryId || expenseCategories[0]?.id || '',
      accountId:
        current.accountId ||
        accounts.find((item) => item.is_default)?.id ||
        accounts[0]?.id ||
        '',
      status:
        nextDraft.dueDate ||
        nextDraft.documentKind?.includes('boleto') ||
        nextDraft.documentKind?.includes('pix')
          ? 'pending'
          : current.status,
    }));
  }

  function resetScan() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setFileName('');
    setSelectedFile(null);
    setParsed(null);
    setDraft(null);
    setAdaptiveSuggestion(null);
    setOcrExtractionId('');
    setRawInput('');
    setNotice(null);
    setError(null);
    setSaved(false);
    setReview((current) => ({
      ...current,
      amount: '',
      description: '',
      dueDate: '',
      status: 'pending',
    }));
  }

  function analyzePastedCode() {
    setError(null);
    setNotice(null);
    setSaved(false);
    if (!rawInput.trim()) {
      setError(
        'Cole um Pix Copia e Cola, linha digitável ou código de barras.',
      );
      return;
    }
    const result = parseFinancialCode(rawInput);
    applyDraft(result.draft, result);
    if (result.kind === 'unknown')
      setNotice(
        'O código foi recebido, mas o formato não foi identificado automaticamente. Confira os dados antes de salvar.',
      );
  }

  async function handleFile(file?: File) {
    if (!file) return;
    setProcessing(true);
    setError(null);
    setNotice(null);
    setSaved(false);
    setOcrExtractionId('');
    setFileName(file.name || 'captura');
    setSelectedFile(file);

    if (previewUrl) URL.revokeObjectURL(previewUrl);
    const nextPreview = file.type.startsWith('image/')
      ? URL.createObjectURL(file)
      : null;
    setPreviewUrl(nextPreview);

    try {
      const detected = await detectCodeFromImage(file);
      const localParsed = detected ? parseFinancialCode(detected) : null;
      if (detected) setRawInput(detected);

      if (localParsed) {
        applyDraft(localParsed.draft, localParsed);
        if (DOCUMENT_OCR_ENABLED)
          setNotice(
            'Código identificado. Se quiser enriquecer empresa, categoria e outros campos visuais, toque em “Analisar com IA”.',
          );
        return;
      }

      if (file.type === 'application/pdf') {
        applyDraft({
          description: file.name.replace(/\.pdf$/i, '') || 'Documento PDF',
          documentKind: 'pdf',
          confidence: 'low',
        });
        setNotice(
          DOCUMENT_OCR_ENABLED
            ? 'PDF recebido. Para extrair empresa, valor e vencimento, toque em “Analisar com IA”.'
            : 'PDF recebido. Confirme os dados manualmente.',
        );
        return;
      }

      applyDraft({
        description: file.name.replace(/\.[^.]+$/, '') || 'Documento capturado',
        documentKind: 'image',
        confidence: 'low',
      });
      if (DOCUMENT_OCR_ENABLED) {
        setNotice(
          'Imagem recebida. Toque em “Analisar com IA” para tentar extrair empresa, valor, vencimento e categoria.',
        );
      } else if (detectorConstructor()) {
        setNotice(
          'A imagem foi capturada, mas nenhum QR/código legível foi encontrado. Você pode preencher os dados manualmente.',
        );
      } else {
        setNotice(
          'Este navegador não oferece leitura nativa de QR/código. A câmera continua disponível e os dados podem ser confirmados manualmente.',
        );
      }
    } catch (scanError: any) {
      setError(scanError?.message || 'Não foi possível analisar o arquivo.');
    } finally {
      setProcessing(false);
      if (cameraInputRef.current) cameraInputRef.current.value = '';
      if (galleryInputRef.current) galleryInputRef.current.value = '';
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function analyzeSelectedFileWithOcr() {
    if (!selectedFile || !DOCUMENT_OCR_ENABLED || processing) return;
    setProcessing(true);
    setError(null);
    setNotice(null);
    setSaved(false);

    try {
      const ocrResult = await analyzeDocumentWithOcr({
        file: selectedFile,
        userId,
        accountId:
          review.accountId ||
          accounts.find((item) => item.is_default)?.id ||
          accounts[0]?.id ||
          null,
        captureSource,
      });

      if (!ocrResult) {
        setNotice(
          'OCR visual indisponível neste ambiente. Você ainda pode confirmar os dados manualmente.',
        );
        return;
      }

      setOcrExtractionId(ocrResult.extractionId);
      const metadata = ocrResult.metadata;
      const fallbackDraft = draft || {
        description:
          selectedFile.name.replace(/\.[^.]+$/, '') || 'Documento capturado',
        documentKind: selectedFile.type === 'application/pdf' ? 'pdf' : 'image',
        confidence: 'low' as const,
      };
      const mergedDraft: MobileScannedDraft = {
        amount:
          Number(metadata.amount || 0) > 0
            ? Number(metadata.amount)
            : fallbackDraft.amount,
        description:
          metadata.description ||
          metadata.merchant_name ||
          fallbackDraft.description,
        merchant: metadata.merchant_name || fallbackDraft.merchant,
        category: metadata.category_hint || fallbackDraft.category,
        dueDate: metadata.due_date || fallbackDraft.dueDate,
        documentKind: metadata.document_kind || fallbackDraft.documentKind,
        barcode: fallbackDraft.barcode,
        pixPayload: fallbackDraft.pixPayload,
        confidence: reviewConfidence(ocrResult.documentConfidence),
      };
      const learned = learnedSuggestion(mergedDraft);
      applyDraft(mergedDraft, parsed);

      const suggestedCategory = metadata.category_hint
        ? expenseCategories.find(
            (category) =>
              category.name.trim().toLocaleLowerCase('pt-BR') ===
              String(metadata.category_hint).trim().toLocaleLowerCase('pt-BR'),
          )
        : null;
      setReview((current) => ({
        ...current,
        categoryId:
          learned?.confidence === 'high'
            ? learned.categoryId
            : suggestedCategory?.id || current.categoryId,
        status:
          metadata.payment_status === 'paid'
            ? 'paid'
            : metadata.payment_status === 'pending'
              ? 'pending'
              : current.status,
        dueDate:
          metadata.payment_status === 'paid'
            ? ''
            : metadata.due_date || current.dueDate,
      }));

      const warning = firstUsefulWarning(metadata);
      setNotice(
        warning ||
          'Documento analisado com IA. Confira todos os campos antes de registrar.',
      );
    } catch (ocrError: any) {
      const fallbackMessage =
        ocrError?.message || 'O OCR visual não conseguiu concluir a leitura.';
      setNotice(
        `${fallbackMessage} A captura continua disponível para revisão manual.`,
      );
    } finally {
      setProcessing(false);
    }
  }

  useEffect(() => {
    if (initialHandledRef.current) return;
    if (initialFile) {
      initialHandledRef.current = true;
      void handleFile(initialFile);
      return;
    }
    const sharedText = initialText.trim();
    if (!sharedText) return;
    initialHandledRef.current = true;
    setRawInput(sharedText);
    const result = parseFinancialCode(sharedText);
    applyDraft(result.draft, result);
    if (result.kind === 'unknown')
      setNotice(
        'O conteúdo compartilhado foi recebido. Confira e complete os dados antes de salvar.',
      );
  }, [initialFile, initialText, handleFile, applyDraft]);

  async function saveReviewedEntry(event: React.FormEvent) {
    event.preventDefault();
    if (saving || processing || saved) return;
    setError(null);
    setNotice(null);

    const amount = parseMoneyInput(review.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Confirme um valor maior que zero.');
      return;
    }
    if (!review.accountId) {
      setError('Selecione a conta financeira.');
      return;
    }
    if (!effectiveCategoryId || !selectedCategory) {
      setError('Selecione uma categoria.');
      return;
    }

    setSaving(true);
    try {
      const paymentMethod =
        parsed?.kind === 'pix'
          ? 'pix'
          : parsed?.kind === 'boleto'
            ? 'boleto'
            : 'other';
      const sourceLabel =
        captureSource === 'MF Share Mobile' ? 'MF Share' : 'MF Scan';
      const learnedNote =
        adaptiveSuggestion?.confidence === 'high' &&
        adaptiveSuggestion.categoryId === effectiveCategoryId
          ? ` Categoria sugerida pelo histórico do usuário (${adaptiveSuggestion.matchCount} correspondências).`
          : '';
      const { error: rpcError } = await supabase.rpc(
        'mf_create_finance_entry_v3',
        {
          p_type: 'expense',
          p_amount: amount,
          p_date: format(new Date(), 'yyyy-MM-dd'),
          p_description: review.description.trim() || selectedCategory.name,
          p_account_id: review.accountId,
          p_category_id: effectiveCategoryId,
          p_category: selectedCategory.name,
          p_payment_method: paymentMethod,
          p_status: review.status,
          p_card_id: null,
          p_installment_count: 1,
          p_due_date:
            review.status === 'pending' && review.dueDate
              ? review.dueDate
              : null,
          p_notes:
            `${parsed?.label ? `Capturado pelo ${sourceLabel}: ${parsed.label}` : `Capturado pelo ${sourceLabel}`}.${learnedNote}`.trim(),
          p_source: captureSource,
        },
      );
      if (rpcError) throw rpcError;

      if (ocrExtractionId) {
        try {
          await completeDocumentOcrExtraction(ocrExtractionId, userId);
        } catch (finalizeError) {
          console.warn(
            'MF Scan saved the ledger entry but could not finalize the OCR extraction:',
            finalizeError,
          );
        }
      }

      await onSaved();
      setSaved(true);
      setNotice(
        review.status === 'pending'
          ? 'Conta registrada como compromisso pendente.'
          : 'Despesa registrada no MF.',
      );
    } catch (saveError: any) {
      setError(saveError?.message || 'Não foi possível salvar a captura.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mf-mobile-focus-page">
      <header className="mf-mobile-focus-header">
        <button
          type="button"
          className="mf-mobile-icon-button"
          onClick={() => navigate(MOBILE_ROUTES.home)}
          aria-label="Voltar para a Home"
        >
          <ArrowLeft size={21} />
        </button>
        <div>
          <span className="mf-mobile-eyebrow">MF Scan</span>
          <h1>Captura inteligente</h1>
        </div>
        <button
          type="button"
          className="mf-mobile-icon-button"
          onClick={resetScan}
          aria-label="Nova captura"
        >
          <RotateCcw size={19} />
        </button>
      </header>

      {!draft ? (
        <section className="mf-mobile-scan-capture">
          <div className="mf-mobile-scan-hero">
            <div className="mf-mobile-scan-orb">
              <ScanLine size={34} />
            </div>
            <h2>Mostre a conta para o MF</h2>
            <p>
              Capture um QR, boleto ou documento. O MF tenta identificar os
              dados e sempre pede sua confirmação.
            </p>
          </div>

          <button
            type="button"
            className="mf-mobile-scan-main-action"
            onClick={() => cameraInputRef.current?.click()}
            disabled={processing}
          >
            {processing ? (
              <Loader2 className="animate-spin" size={22} />
            ) : (
              <Camera size={22} />
            )}
            Abrir câmera
          </button>
          <input
            ref={cameraInputRef}
            hidden
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(event) => void handleFile(event.target.files?.[0])}
          />

          <div className="mf-mobile-scan-secondary-actions">
            <button
              type="button"
              onClick={() => galleryInputRef.current?.click()}
            >
              <FileImage size={20} />
              <span>Galeria</span>
            </button>
            <button type="button" onClick={() => fileInputRef.current?.click()}>
              <FileText size={20} />
              <span>Arquivo/PDF</span>
            </button>
          </div>
          <input
            ref={galleryInputRef}
            hidden
            type="file"
            accept="image/*"
            onChange={(event) => void handleFile(event.target.files?.[0])}
          />
          <input
            ref={fileInputRef}
            hidden
            type="file"
            accept="image/*,application/pdf"
            onChange={(event) => void handleFile(event.target.files?.[0])}
          />

          <div className="mf-mobile-code-paste">
            <div className="mf-mobile-code-paste__title">
              <Keyboard size={18} />
              <span>Ou cole um código</span>
            </div>
            <textarea
              value={rawInput}
              onChange={(event) => setRawInput(event.target.value)}
              placeholder="Pix Copia e Cola, linha digitável ou código de barras"
              rows={3}
            />
            <button type="button" onClick={analyzePastedCode}>
              Analisar código
            </button>
          </div>

          <div className="mf-mobile-scan-safety">
            <ShieldCheck size={18} />
            <span>
              O MF Scan não paga boletos nem executa Pix. Ele apenas captura
              dados para seu controle financeiro.
            </span>
          </div>
          {error ? (
            <div className="mf-mobile-feedback error">{error}</div>
          ) : null}
        </section>
      ) : (
        <form className="mf-mobile-scan-review" onSubmit={saveReviewedEntry}>
          {previewUrl ? (
            <img
              className="mf-mobile-scan-preview-image"
              src={previewUrl}
              alt="Documento capturado para revisão"
            />
          ) : null}
          {fileName && !previewUrl ? (
            <div className="mf-mobile-file-chip">
              <FileText size={18} />
              <span>{fileName}</span>
            </div>
          ) : null}

          <div className="mf-mobile-scan-result-head">
            <div>
              <span>{parsed?.label || 'Documento capturado'}</span>
              <small>{confidenceLabel(draft.confidence)}</small>
            </div>
            <ShieldCheck size={21} />
          </div>

          {selectedFile &&
          DOCUMENT_OCR_ENABLED &&
          !ocrExtractionId &&
          !saved ? (
            <button
              className="mf-mobile-secondary-button"
              type="button"
              onClick={() => void analyzeSelectedFileWithOcr()}
              disabled={processing}
            >
              {processing ? (
                <Loader2 className="animate-spin" size={18} />
              ) : (
                <ScanLine size={18} />
              )}
              {processing ? 'Analisando documento...' : 'Analisar com IA'}
            </button>
          ) : null}

          {adaptiveSuggestion ? (
            <div
              className={`mf-mobile-feedback ${adaptiveSuggestion.confidence === 'high' ? 'success' : 'warning'}`}
            >
              <Sparkles size={16} />
              <span>
                {adaptiveSuggestion.confidence === 'high'
                  ? `Pelo seu histórico, ${adaptiveSuggestion.categoryName} foi pré-selecionada (${adaptiveSuggestion.matchCount} casos parecidos).`
                  : `Seu histórico sugere ${adaptiveSuggestion.categoryName}. Confirme se faz sentido.`}
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

          {parsed?.dynamicPix ? (
            <div className="mf-mobile-feedback warning">
              QR Pix dinâmico identificado. O valor completo pode depender do
              payload do PSP; confirme os campos abaixo.
            </div>
          ) : null}
          {!saved && notice ? (
            <div className="mf-mobile-feedback warning">{notice}</div>
          ) : null}

          <label className="mf-mobile-amount-field mf-mobile-scan-amount">
            <span>Valor identificado</span>
            <div>
              <small>R$</small>
              <input
                inputMode="decimal"
                value={review.amount}
                onChange={(event) => {
                  setSaved(false);
                  setReview((current) => ({
                    ...current,
                    amount: event.target.value.replace(/[^0-9,.]/g, ''),
                  }));
                }}
                placeholder="0,00"
              />
            </div>
          </label>

          <label className="mf-mobile-field">
            <span>Descrição</span>
            <input
              value={review.description}
              onChange={(event) => {
                setSaved(false);
                setReview((current) => ({
                  ...current,
                  description: event.target.value,
                }));
              }}
              placeholder="Ex.: Conta de energia"
            />
          </label>

          <div
            className="mf-mobile-segmented"
            role="group"
            aria-label="Situação da captura"
          >
            <button
              type="button"
              data-active={review.status === 'pending'}
              onClick={() => {
                setSaved(false);
                setReview((current) => ({ ...current, status: 'pending' }));
              }}
            >
              A pagar
            </button>
            <button
              type="button"
              data-active={review.status === 'paid'}
              onClick={() => {
                setSaved(false);
                setReview((current) => ({
                  ...current,
                  status: 'paid',
                  dueDate: '',
                }));
              }}
            >
              Já pago
            </button>
          </div>

          {review.status === 'pending' ? (
            <label className="mf-mobile-field">
              <span>
                Vencimento <em>se houver</em>
              </span>
              <input
                type="date"
                value={review.dueDate}
                onChange={(event) => {
                  setSaved(false);
                  setReview((current) => ({
                    ...current,
                    dueDate: event.target.value,
                  }));
                }}
              />
            </label>
          ) : null}

          <label className="mf-mobile-field">
            <span>Categoria</span>
            <select
              value={effectiveCategoryId}
              onChange={(event) => {
                setSaved(false);
                setReview((current) => ({
                  ...current,
                  categoryId: event.target.value,
                }));
              }}
            >
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
                onChange={(event) => {
                  setSaved(false);
                  setReview((current) => ({
                    ...current,
                    accountId: event.target.value,
                  }));
                }}
              >
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {parsed?.rawValue ? (
            <details className="mf-mobile-scan-code-details">
              <summary>Ver código detectado</summary>
              <code>{parsed.rawValue}</code>
            </details>
          ) : null}
          {error ? (
            <div className="mf-mobile-feedback error">{error}</div>
          ) : null}
          {saved && notice ? (
            <div className="mf-mobile-feedback success">
              <Check size={16} />
              {notice}
            </div>
          ) : null}

          <button
            className="mf-mobile-primary-button"
            type="submit"
            disabled={saving || processing || saved || !userId}
          >
            {saving ? (
              <Loader2 className="animate-spin" size={18} />
            ) : (
              <Check size={18} />
            )}
            {saved ? 'Registrado' : 'Confirmar no MF'}
          </button>
          <button
            className="mf-mobile-secondary-button"
            type="button"
            onClick={resetScan}
          >
            Escanear outro documento
          </button>
        </form>
      )}
    </div>
  );
}
