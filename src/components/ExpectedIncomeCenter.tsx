import {
  CalendarDays,
  ChevronDown,
  ChevronUp,
  Save,
  WalletCards,
} from 'lucide-react';
import type React from 'react';
import { lazy, Suspense, useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';
import { formatCurrency } from '../lib/formatters';
import { supabase } from '../lib/supabase';

const IncomePayrollCenter = lazy(() => import('./IncomePayrollCenter'));

type SettingsSnapshot = {
  net_salary_estimated?: number | null;
  payday_cycle?: string | null;
  payday_1?: number | null;
  payday_2?: number | null;
  payday_1_percentage?: number | null;
  payday_2_percentage?: number | null;
};

export default function ExpectedIncomeCenter({ userId }: { userId: string }) {
  const { isPrivate } = useApp();
  const [settings, setSettings] = useState<SettingsSnapshot | null>(null);
  const [amount, setAmount] = useState('');
  const [payday, setPayday] = useState('5');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    const { data, error: loadError } = await supabase
      .from('mf_user_settings')
      .select(
        'net_salary_estimated,payday_cycle,payday_1,payday_2,payday_1_percentage,payday_2_percentage',
      )
      .eq('user_id', userId)
      .maybeSingle();
    if (loadError) {
      setError(loadError.message);
      return;
    }
    const snapshot = (data || {}) as SettingsSnapshot;
    setSettings(snapshot);
    setAmount(String(Number(snapshot.net_salary_estimated || 0)));
    setPayday(String(Number(snapshot.payday_1 || 5)));
  }

  useEffect(() => {
    void load();
  }, [load]);

  async function saveSimple(event: React.FormEvent) {
    event.preventDefault();
    const value = Number(amount);
    const day = Number(payday);
    if (!Number.isFinite(value) || value < 0) {
      setError('Informe uma renda mensal válida.');
      return;
    }
    if (!Number.isInteger(day) || day < 1 || day > 31) {
      setError('O dia de recebimento deve ficar entre 1 e 31.');
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    const { error: saveError } = await supabase
      .from('mf_user_settings')
      .update({
        net_salary_estimated: value,
        payday_1: day,
      })
      .eq('user_id', userId);
    setSaving(false);
    if (saveError) setError(saveError.message);
    else {
      setMessage('Receita prevista atualizada.');
      await load();
    }
  }

  const splitIncome = settings?.payday_cycle === 'biweekly';
  const secondDay = Number(settings?.payday_2 || 20);
  const firstShare = Number(
    settings?.payday_1_percentage ?? (splitIncome ? 60 : 100),
  );
  const secondShare = Number(
    settings?.payday_2_percentage ?? (splitIncome ? 40 : 0),
  );
  const monthly = Number(settings?.net_salary_estimated || 0);

  return (
    <div className="space-y-4 animate-fade-in">
      <div>
        <h2 className="text-xl font-black">Receitas previstas</h2>
        <p className="text-sm text-white/40">
          Informe a renda recorrente que realmente pode entrar no seu
          planejamento. Holerite e descontos ficam como detalhe opcional.
        </p>
      </div>

      {(error || message) && (
        <div
          className={`rounded-xl border px-4 py-3 text-xs ${error ? 'border-red-500/25 bg-red-500/10 text-red-200' : 'border-green-500/25 bg-green-500/10 text-green-200'}`}
        >
          {error || message}
        </div>
      )}

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,.8fr)]">
        <form
          onSubmit={saveSimple}
          className="glass-card mf-tool-surface space-y-4"
        >
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-brand-primary/15 p-2 text-brand-primary">
              <WalletCards size={18} />
            </div>
            <div>
              <h3 className="text-sm font-bold">Renda recorrente principal</h3>
              <p className="mt-1 text-[10px] text-white/40">
                Use o valor líquido que você espera ter disponível no mês.
              </p>
            </div>
          </div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-white/40">
            Valor mensal previsto
            <input
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-3 text-sm text-white outline-none focus:border-brand-primary"
            />
          </label>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-white/40">
            Dia principal de recebimento
            <input
              type="number"
              min="1"
              max="31"
              value={payday}
              onChange={(event) => setPayday(event.target.value)}
              className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-3 text-sm text-white outline-none focus:border-brand-primary"
            />
          </label>
          <button
            disabled={saving}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-primary px-4 py-3 text-xs font-black text-black disabled:opacity-50"
          >
            <Save size={14} />
            {saving ? 'Salvando...' : 'Salvar previsão'}
          </button>
          <p className="text-[10px] leading-relaxed text-white/30">
            Receitas pontuais continuam sendo registradas como entradas pelo
            botão “Lançar”. Esta tela serve para a base recorrente usada nas
            projeções.
          </p>
        </form>

        <section className="glass-card mf-tool-surface space-y-3">
          <div className="flex items-center gap-3">
            <CalendarDays size={18} className="text-brand-primary" />
            <div>
              <h3 className="text-sm font-bold">Como o mês está configurado</h3>
              <p className="text-[10px] text-white/40">
                Resumo usado pela Agenda e pelo Planejamento.
              </p>
            </div>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <div className="text-[9px] uppercase tracking-widest text-white/35">
              Renda prevista
            </div>
            <strong className="mt-1 block text-2xl">
              {formatCurrency(monthly, isPrivate)}
            </strong>
          </div>
          {splitIncome ? (
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <span className="text-white/35">1ª parte</span>
                <strong className="mt-1 block">
                  Dia {Number(settings?.payday_1 || 5)} · {firstShare}%
                </strong>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <span className="text-white/35">2ª parte</span>
                <strong className="mt-1 block">
                  Dia {secondDay} · {secondShare}%
                </strong>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs">
              <span className="text-white/35">Recebimento</span>
              <strong className="ml-2">
                Dia {Number(settings?.payday_1 || 5)}
              </strong>
            </div>
          )}
        </section>
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/[0.02]">
        <button
          type="button"
          onClick={() => setAdvancedOpen((value) => !value)}
          className="flex w-full items-center justify-between gap-3 p-4 text-left"
        >
          <div>
            <h3 className="text-sm font-bold">
              Folha e holerite <span className="text-white/30">(opcional)</span>
            </h3>
            <p className="mt-1 text-[10px] text-white/40">
              Para quem quer detalhar bruto, INSS, IRRF, benefícios, descontos e
              divisão de pagamentos.
            </p>
          </div>
          {advancedOpen ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
        </button>
        {advancedOpen && (
          <div className="border-t border-white/10 p-3">
            <Suspense
              fallback={<div className="mf-loading">Carregando folha...</div>}
            >
              <IncomePayrollCenter userId={userId} />
            </Suspense>
          </div>
        )}
      </section>
    </div>
  );
}
