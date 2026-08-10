import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, Loader2, Mic, MicOff, ShieldCheck, Sparkles } from 'lucide-react';
import { format } from 'date-fns';
import { useNavigate } from 'react-router';

import { supabase } from '../../lib/supabase';
import type { FinancialAccount, Transaction, TransactionCategory } from '../../types';
import { inferAdaptiveCategory } from '../lib/adaptive-category';
import { MOBILE_ROUTES } from '../routes';
import { parseVoiceEntry, type VoiceEntryType } from '../lib/voice-entry-parser';
import './mobile-voice.css';

type SpeechAlternativeLike = { transcript: string; confidence?: number };
type SpeechResultLike = { isFinal?: boolean; 0?: SpeechAlternativeLike };
type SpeechEventLike = { results?: { length: number; [index: number]: SpeechResultLike } };
type SpeechErrorLike = { error?: string };
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onresult: ((event: SpeechEventLike) => void) | null;
  onerror: ((event: SpeechErrorLike) => void) | null;
};
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

type VoiceWindow = Window & typeof globalThis & {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
};

function speechRecognitionConstructor() {
  const speechWindow = window as VoiceWindow;
  return speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition || null;
}

function parseMoneyInput(value: string) {
  const clean = value.trim().replace(/\s/g, '');
  if (!clean) return Number.NaN;
  if (clean.includes(',')) return Number(clean.replace(/\./g, '').replace(',', '.'));
  return Number(clean);
}

function normalizeAccount(row: any): FinancialAccount {
  return {
    ...row,
    opening_balance: Number(row.opening_balance || 0),
    current_balance: Number(row.current_balance || 0),
    transaction_count: Number(row.transaction_count || 0),
  } as FinancialAccount;
}

function normalizeTransaction(row: any): Transaction {
  return { ...row, amount: Number(row.amount || 0) } as Transaction;
}

export default function MobileVoice({ userId }: { userId: string }) {
  const navigate = useNavigate();
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [categories, setCategories] = useState<TransactionCategory[]>([]);
  const [history, setHistory] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [type, setType] = useState<VoiceEntryType>('expense');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [interpretation, setInterpretation] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const speechSupported = Boolean(speechRecognitionConstructor());
  const compatibleCategories = useMemo(
    () => categories.filter((category) => category.is_active && (category.category_type === 'both' || category.category_type === type)),
    [categories, type],
  );
  const selectedCategory = compatibleCategories.find((category) => category.id === categoryId) || null;

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const ensured = await supabase.rpc('mf_ensure_financial_structure');
        if (ensured.error) throw ensured.error;
        const [accountsResult, categoriesResult, historyResult] = await Promise.all([
          supabase.from('mf_account_balances').select('*').eq('user_id', userId).eq('is_active', true).order('is_default', { ascending: false }).order('created_at'),
          supabase.from('mf_transaction_categories').select('*').eq('user_id', userId).eq('is_active', true).order('sort_order').order('name'),
          supabase.from('mf_finance_ledger_entries')
            .select('id,user_id,account_id,category_id,amount,category,description,date,type,status,source,affects_balance')
            .eq('user_id', userId)
            .in('type', ['income', 'expense'])
            .order('date', { ascending: false })
            .limit(500),
        ]);
        if (accountsResult.error) throw accountsResult.error;
        if (categoriesResult.error) throw categoriesResult.error;
        if (historyResult.error) throw historyResult.error;
        if (!active) return;
        const nextAccounts = (accountsResult.data || []).map(normalizeAccount);
        setAccounts(nextAccounts);
        setCategories((categoriesResult.data || []) as TransactionCategory[]);
        setHistory((historyResult.data || []).map(normalizeTransaction));
        setAccountId(nextAccounts.find((account) => account.is_default)?.id || nextAccounts[0]?.id || '');
      } catch (loadError: any) {
        if (active) setError(loadError?.message || 'Não foi possível preparar o MF Voice.');
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
      recognitionRef.current?.abort();
      recognitionRef.current = null;
    };
  }, [userId]);

  function applyTranscript(text: string) {
    const clean = text.trim();
    setTranscript(clean);
    setSaved(false);
    setError(null);
    if (!clean) {
      setInterpretation([]);
      return;
    }

    const parsed = parseVoiceEntry(clean, categories, accounts);
    const adaptive = inferAdaptiveCategory({ merchantText: clean, type: parsed.type, history, categories });
    const learnedCategoryId = adaptive?.confidence === 'high' ? adaptive.categoryId : parsed.categoryId;
    setType(parsed.type);
    setAmount(parsed.amount ? String(parsed.amount).replace('.', ',') : '');
    setDescription(parsed.description);
    setCategoryId(learnedCategoryId);
    setAccountId(parsed.accountId || accountId);
    setInterpretation([
      adaptive?.confidence === 'high'
        ? `MF aprendeu com ${adaptive.matchCount} lançamentos parecidos e sugeriu ${adaptive.categoryName}.`
        : adaptive?.confidence === 'medium'
          ? `Seu histórico aponta ${adaptive.categoryName}, mas confirme a categoria.`
          : parsed.confidence === 'high'
            ? 'Interpretação com boa confiança.'
            : parsed.confidence === 'medium'
              ? 'Revise os campos destacados.'
              : 'Complete os campos antes de salvar.',
      ...parsed.warnings.filter((warning) => !(adaptive?.confidence === 'high' && warning.includes('categoria'))),
    ]);
  }

  function startListening() {
    const Constructor = speechRecognitionConstructor();
    if (!Constructor) {
      setError('Este navegador não oferece reconhecimento de voz direto. Use o ditado do teclado ou digite a frase abaixo.');
      return;
    }

    setError(null);
    setSaved(false);
    const recognition = new Constructor();
    recognition.lang = 'pt-BR';
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => setListening(true);
    recognition.onend = () => {
      setListening(false);
      recognitionRef.current = null;
    };
    recognition.onerror = (event) => {
      const reason = event.error || 'unknown';
      setListening(false);
      recognitionRef.current = null;
      if (reason === 'not-allowed' || reason === 'service-not-allowed') {
        setError('Permissão de microfone/voz não concedida. Você ainda pode usar o ditado do teclado ou digitar a frase.');
      } else if (reason === 'no-speech') {
        setError('Não ouvi uma frase completa. Tente novamente falando perto do microfone.');
      } else {
        setError('O reconhecimento de voz não concluiu. Você pode tentar novamente ou editar a frase manualmente.');
      }
    };
    recognition.onresult = (event) => {
      let finalText = '';
      const results = event.results;
      if (results) {
        for (let index = 0; index < results.length; index += 1) {
          const result = results[index];
          if (result?.[0]?.transcript) finalText += `${result[0].transcript} `;
        }
      }
      if (finalText.trim()) applyTranscript(finalText.trim());
    };

    recognitionRef.current = recognition;
    recognition.start();
  }

  function stopListening() {
    recognitionRef.current?.stop();
  }

  async function saveEntry(event: React.FormEvent) {
    event.preventDefault();
    if (saving || saved) return;
    setError(null);

    const parsedAmount = parseMoneyInput(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setError('Confirme um valor maior que zero.');
      return;
    }
    if (!accountId) {
      setError('Selecione uma conta financeira.');
      return;
    }
    if (!selectedCategory) {
      setError('Selecione uma categoria antes de salvar.');
      return;
    }

    setSaving(true);
    try {
      const { error: rpcError } = await supabase.rpc('mf_create_finance_entry_v3', {
        p_type: type,
        p_amount: parsedAmount,
        p_date: format(new Date(), 'yyyy-MM-dd'),
        p_description: description.trim() || selectedCategory.name,
        p_account_id: accountId,
        p_category_id: selectedCategory.id,
        p_category: selectedCategory.name,
        p_payment_method: 'unspecified',
        p_status: 'paid',
        p_card_id: null,
        p_installment_count: 1,
        p_due_date: null,
        p_notes: transcript.trim() ? `Frase revisada no MF Voice: ${transcript.trim().slice(0, 240)}` : 'Lançamento revisado no MF Voice',
        p_source: 'MF Voice Mobile',
      });
      if (rpcError) throw rpcError;
      setSaved(true);
    } catch (saveError: any) {
      setError(saveError?.message || 'Não foi possível salvar o lançamento por voz.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="mf-mobile-loading"><Loader2 className="animate-spin" size={30} /><span>Preparando MF Voice</span></div>;
  }

  return (
    <div className="mf-mobile-focus-page mf-mobile-voice-page">
      <header className="mf-mobile-focus-header">
        <button type="button" className="mf-mobile-icon-button" onClick={() => navigate(MOBILE_ROUTES.quick)} aria-label="Voltar para o MF Quick">
          <ArrowLeft size={21} />
        </button>
        <div>
          <span className="mf-mobile-eyebrow">MF Voice</span>
          <h1>Fale. Revise. Salve.</h1>
        </div>
        <div className="mf-mobile-voice-header-mark"><Sparkles size={19} /></div>
      </header>

      <section className="mf-mobile-voice-capture">
        <button type="button" className="mf-mobile-voice-mic" data-listening={listening} onClick={listening ? stopListening : startListening}>
          {listening ? <MicOff size={34} /> : <Mic size={34} />}
        </button>
        <strong>{listening ? 'Ouvindo…' : speechSupported ? 'Toque e fale uma frase' : 'Use o ditado do teclado'}</strong>
        <p>Exemplo: “Gastei 48 reais de gasolina.” O MF nunca salva apenas pela fala; a revisão abaixo é obrigatória.</p>
      </section>

      <form className="mf-mobile-voice-form" onSubmit={saveEntry}>
        <label className="mf-mobile-field">
          <span>Frase reconhecida</span>
          <textarea
            rows={3}
            value={transcript}
            onChange={(event) => setTranscript(event.target.value)}
            onBlur={() => applyTranscript(transcript)}
            placeholder="Gastei 48 reais de gasolina"
          />
        </label>
        <button type="button" className="mf-mobile-secondary-button" onClick={() => applyTranscript(transcript)}>Interpretar frase</button>

        {interpretation.length ? (
          <div className="mf-mobile-voice-interpretation">
            {interpretation.map((item, index) => <span key={`${item}-${index}`}>{item}</span>)}
          </div>
        ) : null}

        <div className="mf-mobile-segmented" role="group" aria-label="Tipo do lançamento por voz">
          <button type="button" data-active={type === 'expense'} onClick={() => { setType('expense'); setCategoryId(''); setSaved(false); }}>Despesa</button>
          <button type="button" data-active={type === 'income'} onClick={() => { setType('income'); setCategoryId(''); setSaved(false); }}>Receita</button>
        </div>

        <label className="mf-mobile-amount-field">
          <span>Valor</span>
          <div><small>R$</small><input inputMode="decimal" value={amount} onChange={(event) => { setSaved(false); setAmount(event.target.value.replace(/[^0-9,.]/g, '')); }} placeholder="0,00" /></div>
        </label>

        <label className="mf-mobile-field">
          <span>Categoria</span>
          <select value={categoryId} onChange={(event) => { setSaved(false); setCategoryId(event.target.value); }}>
            <option value="">Selecione</option>
            {compatibleCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
        </label>

        {accounts.length > 1 ? (
          <label className="mf-mobile-field">
            <span>Conta</span>
            <select value={accountId} onChange={(event) => { setSaved(false); setAccountId(event.target.value); }}>
              {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
            </select>
          </label>
        ) : null}

        <label className="mf-mobile-field">
          <span>Descrição</span>
          <input value={description} onChange={(event) => { setSaved(false); setDescription(event.target.value); }} placeholder="Descrição do lançamento" />
        </label>

        <div className="mf-mobile-scan-safety"><ShieldCheck size={18} /><span>O MF não armazena áudio nesta versão. O serviço de reconhecimento pode ser fornecido pelo próprio navegador/sistema.</span></div>
        {error ? <div className="mf-mobile-feedback error">{error}</div> : null}
        {saved ? <div className="mf-mobile-feedback success"><Check size={16} />Lançamento salvo pelo MF Voice.</div> : null}

        <button type="submit" className="mf-mobile-primary-button" disabled={saving || saved}>
          {saving ? <Loader2 className="animate-spin" size={18} /> : <Check size={18} />}
          {saved ? 'Registrado' : 'Confirmar lançamento'}
        </button>
      </form>
    </div>
  );
}
