import React, { useEffect, useRef, useState } from 'react';
import { User } from '@supabase/supabase-js';
import { Camera, CheckCircle2, Save, UserRound, X } from 'lucide-react';

import { supabase } from '../lib/supabase';
import { FinancialAccount, UserSettings } from '../types';

interface ProfileCenterProps {
  user: User;
  settings: UserSettings | null;
  accounts: FinancialAccount[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => Promise<void>;
}

function initials(value: string) {
  return value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'MF';
}

export default function ProfileCenter({ user, settings, accounts, open, onOpenChange, onSaved }: ProfileCenterProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [displayName, setDisplayName] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [balance, setBalance] = useState('0');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const friendlyName = settings?.display_name?.trim() || user.user_metadata?.name || user.email?.split('@')[0] || 'Perfil';
  const activeAccount = accounts.find((account) => account.is_default && account.is_active)
    || accounts.find((account) => account.is_active);

  useEffect(() => {
    if (!open) return;
    setDisplayName(settings?.display_name || user.user_metadata?.name || '');
    setWorkspaceName(settings?.workspace_name || '');
    setBalance(String(activeAccount?.current_balance ?? settings?.current_balance ?? 0));
    setAvatarPreview(settings?.avatar_url || null);
    setAvatarFile(null);
    setError(null);
  }, [activeAccount?.current_balance, open, settings, user.user_metadata?.name]);

  useEffect(() => () => {
    if (avatarPreview?.startsWith('blob:')) URL.revokeObjectURL(avatarPreview);
  }, [avatarPreview]);

  function chooseAvatar(file?: File) {
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) {
      setError('A foto deve ter no máximo 3 MB.');
      return;
    }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('Use uma foto JPG, PNG ou WebP.');
      return;
    }
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
  }

  async function saveProfile(event: React.FormEvent) {
    event.preventDefault();
    if (!activeAccount) {
      setError('Crie uma conta financeira antes de confirmar o saldo.');
      return;
    }

    const numericBalance = Number(balance);
    if (!displayName.trim()) {
      setError('Informe o nome que deve aparecer no aplicativo.');
      return;
    }
    if (!Number.isFinite(numericBalance)) {
      setError('Informe um saldo válido.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      let avatarUrl = settings?.avatar_url || null;
      if (avatarFile) {
        const extension = avatarFile.type === 'image/jpeg' ? 'jpg' : avatarFile.type.split('/')[1];
        const path = `${user.id}/avatar-${crypto.randomUUID()}.${extension}`;
        const { error: uploadError } = await supabase.storage
          .from('mf-avatars')
          .upload(path, avatarFile, { contentType: avatarFile.type, cacheControl: '3600' });
        if (uploadError) throw uploadError;
        const { data } = supabase.storage.from('mf-avatars').getPublicUrl(path);
        avatarUrl = data.publicUrl;
      }

      const { error: settingsError } = await supabase
        .from('mf_user_settings')
        .update({
          display_name: displayName.trim(),
          workspace_name: workspaceName.trim() || `MF Financeiro de ${displayName.trim()}`,
          avatar_url: avatarUrl,
          balance_confirmed: true,
        })
        .eq('user_id', user.id);
      if (settingsError) throw settingsError;

      const { error: balanceError } = await supabase.rpc('mf_set_account_balance', {
        p_account_id: activeAccount.id,
        p_balance: numericBalance,
      });
      if (balanceError) throw balanceError;

      await onSaved();
      onOpenChange(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Não foi possível salvar o perfil.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button type="button" onClick={() => onOpenChange(true)} className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 p-1 pr-3 text-[10px] font-bold text-white/70" title="Perfil">
        <span className="grid h-7 w-7 place-items-center overflow-hidden rounded-full border border-brand-primary/25 bg-brand-primary/10 text-[9px] text-brand-primary">
          {settings?.avatar_url ? <img src={settings.avatar_url} alt="Foto do perfil" className="h-full w-full object-cover" /> : initials(friendlyName)}
        </span>
        <span className="max-w-24 truncate">{friendlyName.split(/\s+/)[0]}</span>
      </button>

      {open && (
        <div className="mf-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="mf-profile-title">
          <form className="mf-modal" onSubmit={saveProfile}>
            <div className="mf-modal-title"><div><h2 id="mf-profile-title">Seu espaço financeiro</h2><p className="mt-1 text-[10px] text-white/35">Perfil, identidade do espaço e saldo confirmado.</p></div><button type="button" onClick={() => onOpenChange(false)}><X size={18} /></button></div>
            {error && <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-200">{error}</div>}
            <div className="flex items-center gap-3">
              <div className="grid h-20 w-20 place-items-center overflow-hidden rounded-2xl border border-brand-primary/20 bg-brand-primary/10 text-xl font-black text-brand-primary">{avatarPreview ? <img src={avatarPreview} alt="Prévia da foto" className="h-full w-full object-cover" /> : initials(friendlyName)}</div>
              <div><input ref={fileInputRef} hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => chooseAvatar(event.target.files?.[0])} /><button type="button" onClick={() => fileInputRef.current?.click()} className="flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-xs"><Camera size={14} /> Escolher foto</button><p className="mt-2 text-[9px] text-white/30">JPG, PNG ou WebP · até 3 MB</p></div>
            </div>
            <label>Nome<input required value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label>
            <label>Nome do espaço<input value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} placeholder={`MF Financeiro de ${displayName || 'você'}`} /></label>
            <label>Saldo confirmado da conta principal<input type="number" step="0.01" value={balance} onChange={(event) => setBalance(event.target.value)} /></label>
            <div className="mf-modal-actions"><button type="button" onClick={() => onOpenChange(false)}>Cancelar</button><button className="primary" disabled={saving}><Save size={14} /> {saving ? 'Salvando...' : 'Salvar perfil'}</button></div>
          </form>
        </div>
      )}
    </>
  );
}

export function OnboardingChecklist({ settings, transactionCount, hasCommitment, onProfile, onNavigate }: {
  settings: UserSettings | null;
  transactionCount: number;
  hasCommitment: boolean;
  onProfile: () => void;
  onNavigate: (path: string) => void;
}) {
  const steps = [
    { label: 'Nome e perfil', done: Boolean(settings?.display_name), action: onProfile },
    { label: 'Saldo confirmado', done: settings?.balance_confirmed === true, action: onProfile },
    { label: 'Renda ou holerite', done: Number(settings?.gross_salary || 0) > 0, action: () => onNavigate('/app/planejamento/renda') },
    { label: 'Conta fixa ou cartão', done: hasCommitment, action: () => onNavigate('/app/planejamento/contas-fixas') },
    { label: 'Primeira movimentação', done: transactionCount > 0, action: () => onNavigate('/app/movimentacoes') },
  ];
  const completed = steps.filter((step) => step.done).length;
  if (settings?.onboarding_completed || completed === steps.length) return null;

  return (
    <section className="mb-4 rounded-2xl border border-brand-primary/20 bg-brand-primary/[0.06] p-4">
      <div className="flex items-start justify-between gap-3"><div><h2 className="flex items-center gap-2 text-sm font-black"><UserRound size={16} /> Prepare seu início</h2><p className="mt-1 text-[10px] text-white/40">Complete os registros essenciais para análises confiáveis.</p></div><strong className="text-xs text-brand-primary">{Math.round((completed / steps.length) * 100)}%</strong></div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">{steps.map((step) => <button type="button" key={step.label} onClick={step.action} className={`flex items-center gap-2 rounded-xl border p-3 text-left text-[10px] ${step.done ? 'border-green-500/20 text-green-300' : 'border-white/10 text-white/55'}`}><CheckCircle2 size={13} />{step.label}</button>)}</div>
    </section>
  );
}
