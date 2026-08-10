import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { User } from '@supabase/supabase-js';
import { Bell, Camera, ChevronRight, CircleHelp, Save, ShieldCheck, X } from 'lucide-react';
import { useNavigate } from 'react-router';

import { supabase } from '../lib/supabase';
import { FinancialAccount, UserSettings } from '../types';
import NotificationCenter from './NotificationCenter';

interface ProfileCenterProps {
  user: User;
  settings: UserSettings | null;
  accounts: FinancialAccount[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => Promise<void>;
}

type RoutedNotification = {
  id: string;
  type: 'fixed';
  title: string;
  amount: number;
  dueDate?: number;
  status?: 'pending' | 'due_today' | 'overdue';
  originalData: {
    id: string;
    name: string;
    amount: number;
    due_day?: number | null;
    category?: string | null;
    status?: string | null;
    active?: boolean | null;
  };
};

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
  const [showNotifications, setShowNotifications] = useState(false);
  const [routedNotifications, setRoutedNotifications] = useState<RoutedNotification[]>([]);
  const [dismissedNotifications, setDismissedNotifications] = useState<string[]>([]);

  const friendlyName = settings?.display_name?.trim() || String(user.user_metadata?.name || '').trim() || 'Perfil';
  const activeAccount = accounts.find((account) => account.is_default && account.is_active)
    || accounts.find((account) => account.is_active);
  const memberSince = user.created_at ? new Date(user.created_at).toLocaleDateString('pt-BR') : '—';
  const role = String(user.app_metadata?.role || '').toLowerCase();
  const isAdmin = role === 'admin' || role === 'owner';
  const currentPath = typeof window !== 'undefined' ? window.location.pathname.replace(/\/+$/, '') : '';
  const ownsNotificationButton = currentPath === '/app/lancar'
    || currentPath.startsWith('/app/investimentos')
    || currentPath.startsWith('/app/integracoes')
    || currentPath.startsWith('/app/agenda')
    || currentPath.startsWith('/app/planejamento');

  const visibleRoutedNotifications = useMemo(
    () => routedNotifications.filter((item) => !dismissedNotifications.includes(item.id)),
    [dismissedNotifications, routedNotifications],
  );

  const refreshRoutedNotifications = useCallback(async () => {
    if (!ownsNotificationButton) return;
    const { data, error: notificationError } = await supabase
      .from('mf_fixed_bills')
      .select('id,name,amount,due_day,category,status,active')
      .eq('user_id', user.id)
      .order('due_day');

    if (notificationError) {
      console.warn('Não foi possível carregar notificações da barra superior:', notificationError);
      return;
    }

    const items: RoutedNotification[] = (data || [])
      .filter((bill: any) => bill.active !== false && String(bill.status || 'pending') !== 'paid')
      .map((bill: any) => ({
        id: `fixed-${bill.id}`,
        type: 'fixed' as const,
        title: String(bill.name || 'Conta fixa'),
        amount: Math.abs(Number(bill.amount || 0)),
        dueDate: Number(bill.due_day || 1),
        status: 'pending' as const,
        originalData: {
          id: String(bill.id),
          name: String(bill.name || 'Conta fixa'),
          amount: Number(bill.amount || 0),
          due_day: bill.due_day == null ? null : Number(bill.due_day),
          category: bill.category || null,
          status: bill.status || null,
          active: bill.active,
        },
      }));

    setRoutedNotifications(items);
  }, [ownsNotificationButton, user.id]);

  useEffect(() => {
    if (!ownsNotificationButton) return;
    void refreshRoutedNotifications();
  }, [ownsNotificationButton, refreshRoutedNotifications]);

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

  async function payRoutedNotification(item: RoutedNotification) {
    const bill = item.originalData;
    const amount = Math.abs(Number(bill.amount || 0));
    if (!amount) return;

    const ledgerResult = await supabase.rpc('mf_create_finance_entry_v3', {
      p_type: 'expense',
      p_amount: amount,
      p_date: new Date().toISOString().slice(0, 10),
      p_description: `Pagamento: ${bill.name}`,
      p_account_id: activeAccount?.id || null,
      p_category_id: null,
      p_category: bill.category || 'Contas Fixas',
      p_payment_method: 'unspecified',
      p_status: 'paid',
      p_source: 'Notificação',
      p_card_id: null,
      p_due_date: null,
      p_notes: null,
    });
    if (ledgerResult.error) throw ledgerResult.error;

    const paidResult = await supabase
      .from('mf_fixed_bills')
      .update({ status: 'paid', last_paid_month: new Date().toISOString().slice(0, 7) })
      .eq('id', bill.id)
      .eq('user_id', user.id);
    if (paidResult.error) throw paidResult.error;

    await Promise.all([refreshRoutedNotifications(), onSaved()]);
  }

  function openAdministration() {
    onOpenChange(false);
    navigate('/app/admin');
  }

  function startTutorial() {
    window.dispatchEvent(new Event('mf:start-product-tour'));
  }

  const profileModal = open && typeof document !== 'undefined'
    ? createPortal(
        <div className="mf-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="mf-profile-title">
          <form className="mf-modal" onSubmit={saveProfile}>
            <div className="mf-modal-title"><div><h2 id="mf-profile-title">Seu perfil</h2><p className="mt-1 text-[10px] text-white/35">Foto, nome e informações essenciais da sua conta.</p></div><button type="button" onClick={() => onOpenChange(false)} aria-label="Fechar perfil"><X size={18} /></button></div>
            {error && <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-200">{error}</div>}

            <div className="flex items-center gap-3">
              <div className="grid h-20 w-20 place-items-center overflow-hidden rounded-2xl border border-brand-primary/20 bg-brand-primary/10 text-xl font-black text-brand-primary">{avatarPreview ? <img src={avatarPreview} alt="Prévia da foto" className="h-full w-full object-cover" /> : initials(friendlyName)}</div>
              <div><input ref={fileInputRef} hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => chooseAvatar(event.target.files?.[0])} /><button type="button" onClick={() => fileInputRef.current?.click()} className="flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-xs"><Camera size={14} /> Escolher foto</button><p className="mt-2 text-[9px] text-white/30">JPG, PNG ou WebP · até 3 MB</p></div>
            </div>

            <label>Nome<input required value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Como você quer ser chamado" /></label>

            <section className="grid grid-cols-2 gap-2">
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3"><p className="text-[8px] font-black uppercase tracking-[0.16em] text-white/30">Conta principal</p><strong className="mt-1 block truncate text-[11px] text-white/75">{activeAccount?.name || 'Não definida'}</strong></div>
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3"><p className="text-[8px] font-black uppercase tracking-[0.16em] text-white/30">No MF desde</p><strong className="mt-1 block text-[11px] text-white/75">{memberSince}</strong></div>
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
        <span className="max-w-24 truncate">{friendlyName === 'Perfil' ? 'Perfil' : friendlyName.split(/\s+/)[0]}</span>
      </button>
      <button type="button" onClick={startTutorial} title="Tutorial desta tela" aria-label="Abrir tutorial desta tela"><CircleHelp size={16} /></button>
      {ownsNotificationButton && (
        <button type="button" className="relative" onClick={() => setShowNotifications(true)} title="Notificações" aria-label="Abrir notificações">
          <Bell size={16} />
          {visibleRoutedNotifications.length > 0 && <span className="absolute -right-1.5 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[8px] font-black text-white">{visibleRoutedNotifications.length > 99 ? '99+' : visibleRoutedNotifications.length}</span>}
        </button>
      )}
      {showNotifications && (
        <NotificationCenter
          notifications={visibleRoutedNotifications}
          onPay={async (item: any) => payRoutedNotification(item as RoutedNotification)}
          onDismiss={(id) => setDismissedNotifications((current) => current.includes(id) ? current : [...current, id])}
          onClose={() => setShowNotifications(false)}
          isOpen
        />
      )}
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
