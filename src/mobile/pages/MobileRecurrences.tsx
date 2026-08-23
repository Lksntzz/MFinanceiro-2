import { format, subMonths } from 'date-fns';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronUp,
  Loader2,
  RefreshCw,
  Repeat2,
  Sparkles,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';

import { formatCurrency } from '../../lib/formatters';
import { supabase } from '../../lib/supabase';
import {
  detectRecurringExpenses,
  type RecurrenceHistoryItem,
  type RecurrenceSuggestion,
} from '../lib/recurrence-detector';
import { MOBILE_ROUTES } from '../routes';
import './mobile-recurrences.css';

type ExistingRow = { name: string; category?: string | null };

type ReviewForm = {
  name: string;
  amount: string;
  dueDay: string;
  category: string;
};

function dismissalKey(userId: string) {
  return `mf-mobile-recurring-dismissed:${userId}`;
}

function readDismissed(userId: string) {
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(dismissalKey(userId)) || '[]',
    );
    return new Set(
      Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === 'string')
        : [],
    );
  } catch {
    return new Set<string>();
  }
}

function storeDismissed(userId: string, dismissed: Set<string>) {
  try {
    window.localStorage.setItem(
      dismissalKey(userId),
      JSON.stringify([...dismissed].slice(-100)),
    );
  } catch {
    // Local dismissal is optional; detection still works if storage is unavailable.
  }
}

function parseAmount(value: string) {
  const clean = value.trim().replace(/\s/g, '');
  if (!clean) return Number.NaN;
  return clean.includes(',')
    ? Number(clean.replace(/\./g, '').replace(',', '.'))
    : Number(clean);
}

export default function MobileRecurrences({ userId }: { userId: string }) {
  const navigate = useNavigate();
  const [suggestions, setSuggestions] = useState<RecurrenceSuggestion[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(() =>
    readDismissed(userId),
  );
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [review, setReview] = useState<ReviewForm>({
    name: '',
    amount: '',
    dueDay: '',
    category: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const visibleSuggestions = useMemo(
    () => suggestions.filter((suggestion) => !dismissed.has(suggestion.key)),
    [dismissed, suggestions],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const today = new Date();
      const historyStart = format(subMonths(today, 7), 'yyyy-MM-dd');
      const endDate = format(today, 'yyyy-MM-dd');
      const [historyResult, fixedResult, subscriptionResult] =
        await Promise.all([
          supabase
            .from('mf_finance_ledger_entries')
            .select(
              'id,description,amount,category,date,type,status,affects_balance',
            )
            .eq('user_id', userId)
            .eq('type', 'expense')
            .gte('date', historyStart)
            .lte('date', endDate)
            .order('date', { ascending: true })
            .limit(1500),
          supabase
            .from('mf_fixed_bills')
            .select('name,category')
            .eq('user_id', userId)
            .eq('active', true),
          supabase
            .from('mf_subscriptions')
            .select('name,category,status')
            .eq('user_id', userId),
        ]);
      if (historyResult.error) throw historyResult.error;
      if (fixedResult.error) throw fixedResult.error;
      if (subscriptionResult.error) throw subscriptionResult.error;

      const existing: ExistingRow[] = [
        ...((fixedResult.data || []) as ExistingRow[]),
        ...(
          (subscriptionResult.data || []) as Array<
            ExistingRow & { status?: string }
          >
        ).filter((item) => item.status !== 'cancelled'),
      ];
      const history = (historyResult.data || []).map((row: any) => ({
        ...row,
        amount: Number(row.amount || 0),
      })) as RecurrenceHistoryItem[];
      setSuggestions(detectRecurringExpenses(history, existing));
    } catch (loadError: any) {
      setError(
        loadError?.message ||
          'Não foi possível procurar recorrências no seu histórico.',
      );
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  function openReview(suggestion: RecurrenceSuggestion) {
    setReviewing(suggestion.key);
    setMessage(null);
    setError(null);
    setReview({
      name: suggestion.name,
      amount: String(suggestion.estimatedAmount).replace('.', ','),
      dueDay: String(suggestion.dueDay),
      category: suggestion.category,
    });
  }

  function dismiss(key: string) {
    const next = new Set(dismissed);
    next.add(key);
    setDismissed(next);
    storeDismissed(userId, next);
    if (reviewing === key) setReviewing(null);
  }

  function restoreDismissed() {
    const next = new Set<string>();
    setDismissed(next);
    storeDismissed(userId, next);
  }

  async function createRecurring(suggestion: RecurrenceSuggestion) {
    if (saving) return;
    setError(null);
    setMessage(null);

    const amount = parseAmount(review.amount);
    const dueDay = Number(review.dueDay);
    if (!review.name.trim()) {
      setError('Confirme um nome para a recorrência.');
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Confirme um valor estimado maior que zero.');
      return;
    }
    if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) {
      setError('O dia esperado precisa ficar entre 1 e 31.');
      return;
    }
    if (!review.category.trim()) {
      setError('Confirme a categoria da recorrência.');
      return;
    }

    setSaving(true);
    try {
      const { error: rpcError } = await supabase.rpc(
        'mf_create_fixed_bill_recurring',
        {
          p_name: review.name.trim(),
          p_amount: amount,
          p_due_day: dueDay,
          p_category: review.category.trim(),
        },
      );
      if (rpcError) throw rpcError;

      setMessage(
        `${review.name.trim()} agora está sendo acompanhada como recorrência.`,
      );
      setReviewing(null);
      const nextDismissed = new Set(dismissed);
      nextDismissed.delete(suggestion.key);
      setDismissed(nextDismissed);
      storeDismissed(userId, nextDismissed);
      await load();
    } catch (saveError: any) {
      setError(saveError?.message || 'Não foi possível criar a recorrência.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mf-mobile-focus-page mf-mobile-recurrences-page">
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
          <span className="mf-mobile-eyebrow">Inteligência do histórico</span>
          <h1>Recorrências</h1>
        </div>
        <button
          type="button"
          className="mf-mobile-icon-button"
          onClick={() => void load()}
          aria-label="Procurar novamente"
          disabled={loading}
        >
          <RefreshCw size={19} className={loading ? 'animate-spin' : ''} />
        </button>
      </header>

      <section className="mf-mobile-recurrence-intro">
        <div className="mf-mobile-recurrence-intro__icon">
          <Sparkles size={22} />
        </div>
        <div>
          <strong>O MF procura padrões, não valores idênticos.</strong>
          <p>
            Uma conta pode variar todo mês e ainda ser recorrente. Nada é criado
            sem sua revisão.
          </p>
        </div>
      </section>

      {loading ? (
        <div className="mf-mobile-recurrence-state">
          <Loader2 className="animate-spin" size={28} />
          <span>Analisando os últimos meses…</span>
        </div>
      ) : null}
      {error ? <div className="mf-mobile-feedback error">{error}</div> : null}
      {message ? (
        <div className="mf-mobile-feedback success">
          <Check size={16} />
          {message}
        </div>
      ) : null}

      {!loading && !error && visibleSuggestions.length === 0 ? (
        <div className="mf-mobile-recurrence-state">
          <Repeat2 size={30} />
          <strong>Nenhuma recorrência nova com confiança suficiente.</strong>
          <span>
            O MF exige pelo menos três meses de padrão antes de sugerir algo.
          </span>
          {dismissed.size ? (
            <button
              type="button"
              className="mf-mobile-secondary-button"
              onClick={restoreDismissed}
            >
              Mostrar sugestões ignoradas
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="mf-mobile-recurrence-list">
        {visibleSuggestions.map((suggestion) => {
          const expanded = reviewing === suggestion.key;
          return (
            <article className="mf-mobile-recurrence-card" key={suggestion.key}>
              <div className="mf-mobile-recurrence-card__top">
                <div>
                  <span
                    className={`mf-mobile-recurrence-confidence ${suggestion.confidence}`}
                  >
                    {suggestion.confidence === 'high'
                      ? 'Alta confiança'
                      : 'Boa possibilidade'}
                  </span>
                  <h2>{suggestion.name}</h2>
                  <p>{suggestion.reason}</p>
                </div>
                <Repeat2 size={22} />
              </div>

              <div className="mf-mobile-recurrence-metrics">
                <div>
                  <small>Valor típico</small>
                  <strong>{formatCurrency(suggestion.estimatedAmount)}</strong>
                </div>
                <div>
                  <small>Por volta do</small>
                  <strong>dia {suggestion.dueDay}</strong>
                </div>
                <div>
                  <small>Histórico</small>
                  <strong>{suggestion.distinctMonths} meses</strong>
                </div>
              </div>

              {suggestion.amountBehavior === 'variable' ? (
                <div className="mf-mobile-recurrence-variable">
                  Valor variável detectado — o valor sugerido é apenas uma
                  referência inicial.
                </div>
              ) : null}

              <button
                type="button"
                className="mf-mobile-recurrence-review-toggle"
                onClick={() =>
                  expanded ? setReviewing(null) : openReview(suggestion)
                }
              >
                {expanded ? (
                  <>
                    <ChevronUp size={17} />
                    Fechar revisão
                  </>
                ) : (
                  <>
                    <ChevronDown size={17} />
                    Revisar recorrência
                  </>
                )}
              </button>

              {expanded ? (
                <div className="mf-mobile-recurrence-review">
                  <label className="mf-mobile-field">
                    <span>Nome</span>
                    <input
                      value={review.name}
                      onChange={(event) =>
                        setReview((current) => ({
                          ...current,
                          name: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label className="mf-mobile-field">
                    <span>Valor de referência</span>
                    <input
                      inputMode="decimal"
                      value={review.amount}
                      onChange={(event) =>
                        setReview((current) => ({
                          ...current,
                          amount: event.target.value.replace(/[^0-9,.]/g, ''),
                        }))
                      }
                    />
                  </label>
                  <label className="mf-mobile-field">
                    <span>Dia esperado</span>
                    <input
                      inputMode="numeric"
                      value={review.dueDay}
                      onChange={(event) =>
                        setReview((current) => ({
                          ...current,
                          dueDay: event.target.value
                            .replace(/\D/g, '')
                            .slice(0, 2),
                        }))
                      }
                    />
                  </label>
                  <label className="mf-mobile-field">
                    <span>Categoria</span>
                    <input
                      value={review.category}
                      onChange={(event) =>
                        setReview((current) => ({
                          ...current,
                          category: event.target.value,
                        }))
                      }
                    />
                  </label>

                  <button
                    type="button"
                    className="mf-mobile-primary-button"
                    onClick={() => void createRecurring(suggestion)}
                    disabled={saving}
                  >
                    {saving ? (
                      <Loader2 className="animate-spin" size={18} />
                    ) : (
                      <Check size={18} />
                    )}
                    Acompanhar como recorrente
                  </button>
                  <button
                    type="button"
                    className="mf-mobile-secondary-button"
                    onClick={() => dismiss(suggestion.key)}
                    disabled={saving}
                  >
                    <X size={17} />
                    Ignorar por enquanto
                  </button>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>

      {visibleSuggestions.length > 0 && dismissed.size ? (
        <button
          type="button"
          className="mf-mobile-recurrence-restore"
          onClick={restoreDismissed}
        >
          Mostrar ignoradas neste aparelho
        </button>
      ) : null}
    </div>
  );
}
