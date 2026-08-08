import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Power,
  Save,
  ShieldCheck,
  Wrench,
  X,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import {
  broadcastMaintenanceConfig,
  fetchMaintenanceConfig,
  type MaintenanceConfig,
} from '../lib/maintenance';

const DEFAULT_MESSAGE =
  'Estamos realizando melhorias importantes. O MFinanceiro estará disponível novamente em breve.';

export default function AdminMaintenanceControl() {
  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState<MaintenanceConfig>({
    maintenance_mode: false,
    maintenance_message: DEFAULT_MESSAGE,
  });
  const [message, setMessage] = useState(DEFAULT_MESSAGE);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadConfig = async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await fetchMaintenanceConfig(supabase);
      setConfig(next);
      setMessage(next.maintenance_message || DEFAULT_MESSAGE);
    } catch (err: any) {
      setError(String(err?.message || 'Não foi possível carregar o modo de manutenção.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadConfig(); }, []);

  const saveMode = async (enabled: boolean) => {
    const normalizedMessage = message.trim() || DEFAULT_MESSAGE;
    if (enabled && normalizedMessage.length < 10) {
      setError('Digite uma mensagem com pelo menos 10 caracteres.');
      return;
    }

    setSaving(true);
    setError(null);
    setFeedback(null);

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

      setConfig(next);
      setMessage(next.maintenance_message);
      window.dispatchEvent(new CustomEvent('mf:maintenance-changed', { detail: next }));
      void broadcastMaintenanceConfig(supabase, next).catch((broadcastError) => {
        console.warn('Falha ao transmitir manutenção por broadcast:', broadcastError);
      });
      setFeedback(enabled ? 'Modo manutenção ativado.' : 'Modo manutenção desativado.');
    } catch (err: any) {
      setError(String(err?.message || 'Não foi possível alterar o modo de manutenção.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`fixed right-5 top-[76px] z-[1200] flex items-center gap-2 rounded-2xl border px-4 py-2.5 text-xs font-black uppercase tracking-wider shadow-2xl backdrop-blur-xl transition-all ${
          config.maintenance_mode
            ? 'border-amber-400/40 bg-amber-500/15 text-amber-300 hover:bg-amber-500/25'
            : 'border-white/10 bg-[#0b0b0b]/90 text-white/70 hover:border-brand-primary/30 hover:text-brand-primary'
        }`}
        title="Controlar modo de manutenção"
      >
        <Wrench size={15} />
        Manutenção
        <span
          className={`h-2 w-2 rounded-full ${config.maintenance_mode ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400'}`}
        />
      </button>

      {open && (
        <div className="fixed inset-0 z-[1500] flex items-center justify-center bg-black/80 p-4 backdrop-blur-md">
          <section className="w-full max-w-xl overflow-hidden rounded-[28px] border border-white/10 bg-[#0a0a0a] shadow-2xl">
            <header className="flex items-center justify-between border-b border-white/10 px-6 py-5">
              <div className="flex items-center gap-3">
                <div className={`flex h-11 w-11 items-center justify-center rounded-2xl ${config.maintenance_mode ? 'bg-amber-500/15 text-amber-300' : 'bg-brand-primary/10 text-brand-primary'}`}>
                  <ShieldCheck size={22} />
                </div>
                <div>
                  <h2 className="text-lg font-black">Modo Manutenção</h2>
                  <p className="text-xs text-white/40">Disponível somente para administradores</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-xl p-2 text-white/40 transition-colors hover:bg-white/10 hover:text-white"
              >
                <X size={18} />
              </button>
            </header>

            <div className="space-y-5 p-6">
              <div className={`flex items-start gap-3 rounded-2xl border p-4 ${config.maintenance_mode ? 'border-amber-400/20 bg-amber-500/10' : 'border-emerald-400/20 bg-emerald-500/10'}`}>
                {config.maintenance_mode ? (
                  <AlertTriangle className="mt-0.5 shrink-0 text-amber-300" size={20} />
                ) : (
                  <CheckCircle2 className="mt-0.5 shrink-0 text-emerald-300" size={20} />
                )}
                <div>
                  <strong className={config.maintenance_mode ? 'text-amber-200' : 'text-emerald-200'}>
                    {config.maintenance_mode ? 'Site bloqueado para usuários comuns' : 'Site disponível normalmente'}
                  </strong>
                  <p className="mt-1 text-xs leading-relaxed text-white/50">
                    Administradores continuam com acesso para testar o sistema e desativar esta função.
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
                  rows={4}
                  maxLength={240}
                  className="w-full resize-none rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm leading-relaxed text-white outline-none transition-colors focus:border-brand-primary/50"
                  placeholder={DEFAULT_MESSAGE}
                />
                <span className="mt-1 block text-right text-[10px] text-white/25">{message.length}/240</span>
              </label>

              {loading && (
                <div className="flex items-center gap-2 text-xs text-white/40">
                  <Loader2 size={14} className="animate-spin" /> Carregando configuração...
                </div>
              )}
              {feedback && <div className="rounded-xl bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">{feedback}</div>}
              {error && <div className="rounded-xl bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => void saveMode(!config.maintenance_mode)}
                  disabled={saving || loading}
                  className={`flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-black transition-all disabled:cursor-not-allowed disabled:opacity-50 ${
                    config.maintenance_mode
                      ? 'bg-emerald-400 text-black hover:brightness-110'
                      : 'bg-amber-400 text-black hover:brightness-110'
                  }`}
                >
                  {saving ? <Loader2 size={17} className="animate-spin" /> : <Power size={17} />}
                  {config.maintenance_mode ? 'Desativar manutenção' : 'Ativar manutenção'}
                </button>

                <button
                  type="button"
                  onClick={() => void saveMode(config.maintenance_mode)}
                  disabled={saving || loading}
                  className="flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-bold text-white/70 transition-all hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Save size={17} /> Salvar mensagem
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
