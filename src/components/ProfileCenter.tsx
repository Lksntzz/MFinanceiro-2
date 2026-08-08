import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { User } from '@supabase/supabase-js';
import { Banknote, Camera, ChevronRight, CircleHelp, Save, ShieldCheck, WalletCards, X } from 'lucide-react';
import { useNavigate } from 'react-router';

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
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [displayName, setDisplayName] = useState('');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const friendlyName = settings?.display_name?.trim() || user.user_metadata?.name || user.email?.split('@')[0] || 'Perfil';
  const activeAccount = accounts.find((account) => account.is_default && account.is_active)
    || accounts.find((account) => account.is_active);
  const activeAccountsCount = accounts.filter((account) => account.is_active).length;
  const memberSince = user.created_at ? new Date(user.created_at).toLocaleDateString('pt-BR') : '—';
  const role = String(user.app_metadata?.role || '').toLowerCase();
  const isAdmin = role === 'admin' || role === 'owner';

  useEffect(() => {
    if (!open) return;
    setDisplayName(settings?.display_name || user.user_metadata?.name || '');
    setAvatarPreview(settings?.avatar_url || null);
    setAvatarFile(null);
    setError(null);
  }, [open, settings, user.user_metadata?.name]);

  useEffect(() => () => {
    if (avatarPreview?.startsWith('blob:')) URL.revokeObjectURL(avatarPreview);
  }, [avatarPreview]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) onOpenChange(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onOpenChange, saving]);

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
    if (!displayName.trim()) {
      setError('Informe o nome que deve aparecer no aplicativo.');
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
          workspace_name: 'MF Financeiro',
          avatar_url: avatarUrl,
        })
        .eq('user_id', user.id);
      if (settingsError) throw settingsError;

      const { error: authUpdateError } = await supabase.auth.updateUser({ data: { name: displayName.trim() } });
      if (authUpdateError) console.warn('Não foi possível sincronizar o nome no metadata de autenticação:', authUpdateError);

      await onSaved();
      onOpenChange(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Não foi possível salvar o perfil.');
    } finally {
      setSaving(false);
    }
  }

  function openAdministration() {
    onOpenChange(false);
    navigate('/app/admin');
  }

  function openIncome() {
    onOpenChange(false);
    navigate('/app/agenda/receitas');
  }

  function openAccounts() {
    onOpenChange(false);
    navigate('/app/planejamento/contas');
  }

  function startTutorial() {
    window.dispatchEvent(new Event('mf:start-product-tour'));
  }

  const profileModal = open && typeof document !== 'undefined'
    ? createPortal(
        <div className="mf-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="mf-profile-title">
          <form className="mf-modal" onSubmit={saveProfile}>
            <div className="mf-modal-title"><div><h2 id="mf-profile-title">Seu perfil</h2><p className="mt-1 text-[10px] text-white/35">Foto, nome e informações úteis da sua conta.</p></div><button type="button" onClick={() => onOpenChange(false)} aria-label="Fechar perfil"><X size={18} /></button></div>
            {error && <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-200">{error}</div>}

            <div className="flex items-center gap-3">
              <div className="grid h-20 w-20 place-items-center overflow-hidden rounded-2xl border border-brand-primary/20 bg-brand-primary/10 text-xl font-black text-brand-primary">{avatarPreview ? <img src={avatarPreview} alt="Prévia da foto" className="h-full w-full object-cover" /> : initials(friendlyName)}</div>
              <div><input ref={fileInputRef} hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => chooseAvatar(event.target.files?.[0])} /><button type="button" onClick={() => fileInputRef.current?.click()} className="flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-xs"><Camera size={14} /> Escolher foto</button><p className="mt-2 text-[9px] text-white/30">JPG, PNG ou WebP · até 3 MB</p></div>
            </div>

            <label>Nome<input required value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Como você quer ser chamado" /></label>

            <section className="grid grid-cols-2 gap-2">
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3"><p className="text-[8px] font-black uppercase tracking-[0.16em] text-white/30">E-mail</p><strong className="mt-1 block truncate text-[11px] text-white/75">{user.email || 'Não informado'}</strong></div>
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3"><p className="text-[8px] font-black uppercase tracking-[0.16em] text-white/30">Conta principal</p><strong className="mt-1 block truncate text-[11px] text-white/75">{activeAccount?.name || 'Não definida'}</strong></div>
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3"><p className="text-[8px] font-black uppercase tracking-[0.16em] text-white/30">Contas ativas</p><strong className="mt-1 block text-sm text-white/75">{activeAccountsCount}</strong></div>
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3"><p className="text-[8px] font-black uppercase tracking-[0.16em] text-white/30">No MF desde</p><strong className="mt-1 block text-[11px] text-white/75">{memberSince}</strong></div>
            </section>

            <section className="rounded-2xl border border-white/10 bg-white/[0.025] p-3">
              <p className="mb-2 text-[9px] font-black uppercase tracking-[0.18em] text-white/35">Atalhos da conta</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <button type="button" onClick={openIncome} className="flex items-center justify-between rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-left transition hover:border-brand-primary/25 hover:bg-brand-primary/[0.05]"><span className="flex items-center gap-2"><Banknote size={15} className="text-brand-primary" /><span><strong className="block text-xs text-white">Renda e Folha</strong><small className="text-[9px] text-white/35">Holerite, salário e ciclo</small></span></span><ChevronRight size={14} className="text-white/25" /></button>
                <button type="button" onClick={openAccounts} className="flex items-center justify-between rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-left transition hover:border-brand-primary/25 hover:bg-brand-primary/[0.05]"><span className="flex items-center gap-2"><WalletCards size={15} className="text-brand-primary" /><span><strong className="block text-xs text-white">Contas financeiras</strong><small className="text-[9px] text-white/35">Saldos e conta principal</small></span></span><ChevronRight size={14} className="text-white/25" /></button>
              </div>
            </section>

            {isAdmin && (
              <section className="rounded-2xl border border-amber-400/20 bg-amber-400/[0.06] p-3">
                <p className="mb-2 text-[9px] font-black uppercase tracking-[0.18em] text-amber-300/80">Administração</p>
                <button
                  type="button"
                  onClick={openAdministration}
                  className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-left transition hover:border-amber-300/30 hover:bg-amber-400/[0.06]"
                >
                  <span className="flex items-center gap-3">
                    <span className="grid h-9 w-9 place-items-center rounded-xl bg-amber-400/10 text-amber-300"><ShieldCheck size={17} /></span>
                    <span>
                      <strong className="block text-xs text-white">Painel administrativo</strong>
                      <small className="mt-0.5 block text-[9px] text-white/35">Solicitações de acesso e controle de manutenção</small>
                    </span>
                  </span>
                  <ChevronRight size={16} className="text-white/30" />
                </button>
              </section>
            )}

            <div className="mf-modal-actions"><button type="button" onClick={() => onOpenChange(false)}>Cancelar</button><button className="primary" disabled={saving}><Save size={14} /> {saving ? 'Salvando...' : 'Salvar perfil'}</button></div>
          </form>
        </div>,
        document.body,
      )
    : null;

  return (
    <>
      <button type="button" onClick={() => onOpenChange(true)} className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 p-1 pr-3 text-[10px] font-bold text-white/70" title="Perfil">
        <span className="grid h-7 w-7 place-items-center overflow-hidden rounded-full border border-brand-primary/25 bg-brand-primary/10 text-[9px] text-brand-primary">
          {settings?.avatar_url ? <img src={settings.avatar_url} alt="Foto do perfil" className="h-full w-full object-cover" /> : initials(friendlyName)}
        </span>
        <span className="max-w-24 truncate">{friendlyName.split(/\s+/)[0]}</span>
      </button>
      <button type="button" onClick={startTutorial} title="Tutorial desta tela" aria-label="Abrir tutorial desta tela"><CircleHelp size={16} /></button>
      {profileModal}
    </>
  );
}

export function OnboardingChecklist({
  settings: _settings,
  transactionCount: _transactionCount,
  hasCommitment: _hasCommitment,
  onProfile: _onProfile,
  onNavigate: _onNavigate,
}: {
  settings: UserSettings | null;
  transactionCount: number;
  hasCommitment: boolean;
  onProfile: () => void;
  onNavigate: (path: string) => void;
}) {
  return null;
}
