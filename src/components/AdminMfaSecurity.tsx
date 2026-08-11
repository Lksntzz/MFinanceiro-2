import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, KeyRound, Loader2, LockKeyhole, QrCode, ShieldCheck, X } from 'lucide-react';

import { supabase } from '../lib/supabase';

type AalState = {
  currentLevel: string | null;
  nextLevel: string | null;
};

type TotpFactor = {
  id: string;
  friendly_name?: string | null;
  status?: string | null;
};

type Enrollment = {
  factorId: string;
  qr: string;
  secret: string;
};

const EMPTY_AAL: AalState = { currentLevel: null, nextLevel: null };

export default function AdminMfaSecurity() {
  const [aal, setAal] = useState<AalState>(EMPTY_AAL);
  const [factors, setFactors] = useState<TotpFactor[]>([]);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [verifyCode, setVerifyCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refreshSecurity = useCallback(async () => {
    setError(null);
    const [aalResult, factorResult] = await Promise.all([
      supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
      supabase.auth.mfa.listFactors(),
    ]);
    if (aalResult.error) throw aalResult.error;
    if (factorResult.error) throw factorResult.error;

    setAal({
      currentLevel: aalResult.data.currentLevel ?? null,
      nextLevel: aalResult.data.nextLevel ?? null,
    });
    setFactors((factorResult.data.totp || []) as TotpFactor[]);
  }, []);

  useEffect(() => {
    let active = true;
    void refreshSecurity()
      .catch((loadError: any) => {
        if (active) setError(loadError?.message || 'Não foi possível verificar a proteção MFA.');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refreshSecurity]);

  const verifiedFactor = useMemo(
    () => factors.find((factor) => String(factor.status || '').toLowerCase() === 'verified') || null,
    [factors],
  );

  async function startEnrollment() {
    if (busy || enrollment) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { data, error: enrollError } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: 'MF Financeiro Admin',
      });
      if (enrollError) throw enrollError;
      setEnrollment({
        factorId: data.id,
        qr: data.totp.qr_code,
        secret: data.totp.secret,
      });
      setVerifyCode('');
    } catch (enrollError: any) {
      setError(enrollError?.message || 'Não foi possível iniciar a configuração MFA.');
    } finally {
      setBusy(false);
    }
  }

  async function cancelEnrollment() {
    const factorId = enrollment?.factorId;
    setEnrollment(null);
    setVerifyCode('');
    if (!factorId) return;
    try {
      await supabase.auth.mfa.unenroll({ factorId });
      await refreshSecurity();
    } catch {
      // An unverified factor can also expire/be replaced on a later enrollment attempt.
    }
  }

  async function challengeAndVerify(factorId: string) {
    const code = verifyCode.replace(/\D/g, '').slice(0, 8);
    if (!code) {
      setError('Digite o código do aplicativo autenticador.');
      return;
    }

    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const challenge = await supabase.auth.mfa.challenge({ factorId });
      if (challenge.error) throw challenge.error;

      const verify = await supabase.auth.mfa.verify({
        factorId,
        challengeId: challenge.data.id,
        code,
      });
      if (verify.error) throw verify.error;

      setEnrollment(null);
      setVerifyCode('');
      await refreshSecurity();
      setNotice('Segundo fator confirmado. Esta sessão administrativa está protegida com AAL2.');
    } catch (verifyError: any) {
      setError(verifyError?.message || 'Não foi possível confirmar o segundo fator. Confira o código e tente novamente.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <section className="glass-card flex items-center gap-3 p-5 text-sm text-white/50"><Loader2 className="animate-spin" size={18} />Verificando segurança administrativa...</section>;
  }

  const protectedSession = aal.currentLevel === 'aal2';
  const enrolled = Boolean(verifiedFactor) || aal.nextLevel === 'aal2';

  return (
    <section className="glass-card space-y-4 p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ${protectedSession ? 'bg-emerald-500/10 text-emerald-300' : 'bg-amber-500/10 text-amber-300'}`}>
            <ShieldCheck size={21} />
          </div>
          <div>
            <span className="text-[9px] font-black uppercase tracking-[0.18em] text-white/35">Segurança administrativa</span>
            <h2 className="mt-1 text-base font-black">Autenticação multifator</h2>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-white/45">
              Alterações globais e decisões de acesso devem usar uma sessão com segundo fator confirmado.
            </p>
          </div>
        </div>
        <span className={`rounded-full border px-2.5 py-1 text-[9px] font-black uppercase tracking-wider ${protectedSession ? 'border-emerald-400/20 bg-emerald-500/10 text-emerald-300' : 'border-amber-400/20 bg-amber-500/10 text-amber-300'}`}>
          {protectedSession ? 'AAL2 ativo' : enrolled ? 'Confirmação pendente' : 'MFA não configurado'}
        </span>
      </div>

      {protectedSession ? (
        <div className="flex items-start gap-3 rounded-2xl border border-emerald-400/20 bg-emerald-500/5 p-4">
          <CheckCircle2 className="mt-0.5 shrink-0 text-emerald-300" size={18} />
          <div><strong className="text-xs text-emerald-200">Sessão protegida</strong><p className="mt-1 text-xs text-white/45">O segundo fator foi confirmado nesta sessão. Operações administrativas protegidas podem prosseguir.</p></div>
        </div>
      ) : enrollment ? (
        <div className="grid gap-4 rounded-2xl border border-white/10 bg-black/20 p-4 md:grid-cols-[180px_minmax(0,1fr)]">
          <div className="rounded-2xl bg-white p-3">
            {enrollment.qr ? <img src={enrollment.qr} alt="QR Code para configurar o autenticador" className="h-auto w-full" /> : <div className="grid aspect-square place-items-center text-black"><QrCode size={52} /></div>}
          </div>
          <div className="min-w-0">
            <div className="flex items-start justify-between gap-3">
              <div><strong className="text-sm">Escaneie no seu autenticador</strong><p className="mt-1 text-xs leading-relaxed text-white/45">Depois digite o código temporário gerado pelo aplicativo para concluir a configuração.</p></div>
              <button type="button" onClick={() => void cancelEnrollment()} className="rounded-lg p-1.5 text-white/35 hover:bg-white/10 hover:text-white" aria-label="Cancelar configuração"><X size={16} /></button>
            </div>
            <details className="mt-3 rounded-xl border border-white/10 bg-white/[0.025] p-3">
              <summary className="cursor-pointer text-[10px] font-bold text-white/50">Não consigo ler o QR Code</summary>
              <code className="mt-2 block break-all text-[10px] text-white/60">{enrollment.secret}</code>
            </details>
            <div className="mt-3 flex gap-2">
              <input
                value={verifyCode}
                onChange={(event) => setVerifyCode(event.target.value.replace(/\D/g, '').slice(0, 8))}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="Código do autenticador"
                className="min-w-0 flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-brand-primary/50"
              />
              <button type="button" onClick={() => void challengeAndVerify(enrollment.factorId)} disabled={busy} className="flex items-center gap-2 rounded-xl bg-brand-primary px-4 py-2 text-xs font-black text-black disabled:opacity-50">
                {busy ? <Loader2 className="animate-spin" size={15} /> : <KeyRound size={15} />}Ativar
              </button>
            </div>
          </div>
        </div>
      ) : verifiedFactor ? (
        <div className="rounded-2xl border border-amber-400/20 bg-amber-500/5 p-4">
          <div className="flex items-start gap-3"><LockKeyhole className="mt-0.5 shrink-0 text-amber-300" size={18} /><div><strong className="text-xs text-amber-200">Confirme o segundo fator nesta sessão</strong><p className="mt-1 text-xs text-white/45">Abra seu aplicativo autenticador e informe o código atual antes de executar operações administrativas protegidas.</p></div></div>
          <div className="mt-3 flex gap-2">
            <input value={verifyCode} onChange={(event) => setVerifyCode(event.target.value.replace(/\D/g, '').slice(0, 8))} inputMode="numeric" autoComplete="one-time-code" placeholder="Código do autenticador" className="min-w-0 flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-brand-primary/50" />
            <button type="button" onClick={() => void challengeAndVerify(verifiedFactor.id)} disabled={busy} className="flex items-center gap-2 rounded-xl bg-amber-300 px-4 py-2 text-xs font-black text-black disabled:opacity-50">{busy ? <Loader2 className="animate-spin" size={15} /> : <KeyRound size={15} />}Confirmar</button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3 rounded-2xl border border-amber-400/20 bg-amber-500/5 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3"><LockKeyhole className="mt-0.5 shrink-0 text-amber-300" size={18} /><div><strong className="text-xs text-amber-200">Proteção adicional necessária</strong><p className="mt-1 text-xs text-white/45">Configure um aplicativo autenticador antes da publicação das políticas que exigem AAL2.</p></div></div>
          <button type="button" onClick={() => void startEnrollment()} disabled={busy} className="flex shrink-0 items-center justify-center gap-2 rounded-xl border border-amber-300/20 bg-amber-300/10 px-4 py-2 text-xs font-black text-amber-200 hover:bg-amber-300/15 disabled:opacity-50">{busy ? <Loader2 className="animate-spin" size={15} /> : <QrCode size={15} />}Configurar MFA</button>
        </div>
      )}

      {notice && <div className="rounded-xl bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">{notice}</div>}
      {error && <div className="rounded-xl bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>}
    </section>
  );
}
