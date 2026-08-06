import React, { useState } from 'react';
import { ArrowLeft, CheckCircle2, Loader2, Save, ShieldCheck, Wrench } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { MaintenanceConfig } from '../lib/maintenance';

const DEFAULT_MESSAGE =
  'Estamos realizando melhorias importantes. O MFinanceiro estará disponível novamente em breve.';

interface MaintenanceAdminPanelProps {
  config: MaintenanceConfig;
  onBack: () => void;
  onChanged: (next: MaintenanceConfig) => void;
}

export default function MaintenanceAdminPanel({
  config,
  onBack,
  onChanged,
}: MaintenanceAdminPanelProps) {
  const [message, setMessage] = useState(config.maintenance_message || DEFAULT_MESSAGE);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const updateMaintenance = async (enabled: boolean) => {
    const normalizedMessage = message.trim() || DEFAULT_MESSAGE;
    if (normalizedMessage.length < 10) {
      setError('Digite uma mensagem com pelo menos 10 caracteres.');
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const { data, error: rpcError } = await supabase.rpc('mf_set_maintenance_mode', {
        p_enabled: enabled,
        p_message: normalizedMessage,
      });
      if (rpcError) throw rpcError;

      const row = Array.isArray(data) ? data[0] : data;
      const next: MaintenanceConfig = {
        maintenance_mode: Boolean(row?.maintenance_mode ?? enabled),
        maintenance_message: String(row?.maintenance_message || normalizedMessage),
      };

      setMessage(next.maintenance_message);
      setSuccess(enabled ? 'Mensagem atualizada.' : 'Manutenção desativada. Abrindo o sistema...');
      window.dispatchEvent(new CustomEvent('mf:maintenance-changed', { detail: next }));
      onChanged(next);
    } catch (err: any) {
      setError(String(err?.message || 'Não foi possível alterar o modo de manutenção.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden bg-[#050505] p-5">
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-[560px] w-[560px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-primary/10 blur-[140px]" />

      <main className="relative z-10 w-full max-w-2xl overflow-hidden rounded-[30px] border border-white/10 bg-[#0a0a0a]/95 shadow-2xl backdrop-blur-2xl">
        <header className="flex items-center justify-between gap-4 border-b border-white/10 px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/15 text-amber-300">
              <ShieldCheck size={23} />
            </div>
            <div>
              <span className="block text-[10px] font-black uppercase tracking-[0.2em] text-amber-300">
                Acesso administrativo
              </span>
              <h1 className="text-xl font-black text-white">Gerenciar manutenção</h1>
            </div>
          </div>
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold text-white/60 transition-colors hover:bg-white/10 hover:text-white"
          >
            <ArrowLeft size={15} /> Voltar
          </button>
        </header>

        <div className="space-y-5 p-6">
          <div className="flex items-start gap-3 rounded-2xl border border-amber-400/20 bg-amber-500/10 p-4">
            <Wrench className="mt-0.5 shrink-0 text-amber-300" size={20} />
            <div>
              <strong className="text-sm text-amber-200">O site está bloqueado para todos</strong>
              <p className="mt-1 text-xs leading-relaxed text-white/50">
                Esta área serve somente para editar a mensagem ou desativar a manutenção. O Dashboard permanece inacessível enquanto o modo estiver ativo.
              </p>
            </div>
          </div>

          <label className="block">
            <span className="mb-2 block text-[10px] font-black uppercase tracking-[0.18em] text-white/40">
              Mensagem exibida aos usuários
            </span>
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              rows={5}
              maxLength={240}
              className="w-full resize-none rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm leading-relaxed text-white outline-none transition-colors focus:border-brand-primary/50"
            />
            <span className="mt-1 block text-right text-[10px] text-white/25">{message.length}/240</span>
          </label>

          {error && <div className="rounded-xl bg-red-500/10 px-4 py-3 text-xs text-red-300">{error}</div>}
          {success && (
            <div className="flex items-center gap-2 rounded-xl bg-emerald-500/10 px-4 py-3 text-xs text-emerald-300">
              <CheckCircle2 size={15} /> {success}
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => void updateMaintenance(true)}
              disabled={saving}
              className="flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-bold text-white/70 transition-all hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? <Loader2 size={17} className="animate-spin" /> : <Save size={17} />}
              Salvar mensagem
            </button>

            <button
              type="button"
              onClick={() => void updateMaintenance(false)}
              disabled={saving}
              className="flex items-center justify-center gap-2 rounded-2xl bg-emerald-400 px-4 py-3 text-sm font-black text-black transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? <Loader2 size={17} className="animate-spin" /> : <CheckCircle2 size={17} />}
              Desativar e abrir o sistema
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
