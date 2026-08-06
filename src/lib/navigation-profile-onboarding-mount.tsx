import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import {
  BarChart3,
  Camera,
  Check,
  ChevronRight,
  CircleDollarSign,
  ClipboardCheck,
  CreditCard,
  FileText,
  Landmark,
  LayoutDashboard,
  ListChecks,
  PiggyBank,
  Receipt,
  Save,
  Sparkles,
  Target,
  Upload,
  UserRound,
  WalletCards,
  X,
} from 'lucide-react';
import { format } from 'date-fns';
import { supabase } from './supabase';

type MainArea = 'overview' | 'movements' | 'commitments' | 'income' | 'planning' | 'analysis';

type ProfileSettings = {
  user_id: string;
  display_name?: string | null;
  workspace_name?: string | null;
  avatar_url?: string | null;
  current_balance?: number | null;
  gross_salary?: number | null;
  onboarding_seen?: boolean | null;
  onboarding_completed?: boolean | null;
  balance_confirmed?: boolean | null;
};

type Readiness = {
  profile: boolean;
  balance: boolean;
  income: boolean;
  commitment: boolean;
  movement: boolean;
};

const money = (value: number) =>
  Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const normalize = (value: string | null | undefined) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

const currentMonthStart = () => `${format(new Date(), 'yyyy-MM')}-01`;

function originalNavButtons(): HTMLButtonElement[] {
  const nav = document.querySelector<HTMLElement>('.mf-nav');
  if (!nav) return [];
  return Array.from(nav.querySelectorAll<HTMLButtonElement>('button')).filter(
    (button) => !button.closest('#mf-hierarchy-nav-host'),
  );
}

function findButtonByText(texts: string[], scope: ParentNode = document): HTMLButtonElement | null {
  const normalizedTexts = texts.map(normalize);
  return (
    Array.from(scope.querySelectorAll<HTMLButtonElement>('button')).find((button) => {
      if (button.closest('#mf-hierarchy-nav-host')) return false;
      const value = normalize(button.textContent);
      return normalizedTexts.some((text) => value === text || value.includes(text));
    }) || null
  );
}

function clickButton(texts: string[], scope: ParentNode = document): boolean {
  const button = findButtonByText(texts, scope);
  if (!button) return false;
  button.click();
  return true;
}

function clickAfter(texts: string[], delay = 100, scope: ParentNode = document) {
  window.setTimeout(() => clickButton(texts, scope), delay);
}

function navigateMain(area: MainArea) {
  if (area === 'overview') clickButton(['Dashboard']);
  if (area === 'movements') clickButton(['Histórico']);
  if (area === 'commitments') {
    clickButton(['Contas']);
    clickAfter(['Calendário'], 90);
  }
  if (area === 'income') clickButton(['Renda e Folha', 'Preferências']);
  if (area === 'planning') {
    clickButton(['Contas']);
    clickAfter(['Gestão de contas'], 90);
    clickAfter(['Orçamentos'], 190);
  }
  if (area === 'analysis') {
    clickButton(['Análises']);
    clickAfter(['Estatísticas'], 90);
  }
}

function navigateSubroute(route: string) {
  if (route === 'upcoming') {
    clickButton(['Contas']);
    clickAfter(['Calendário'], 90);
  }
  if (route === 'bills') {
    clickButton(['Contas']);
    clickAfter(['Gestão de contas'], 90);
    clickAfter(['Contas fixas'], 190);
  }
  if (route === 'subscriptions') {
    clickButton(['Contas']);
    clickAfter(['Assinaturas'], 90);
  }
  if (route === 'cards') clickButton(['Cartões']);
  if (route === 'budgets') {
    clickButton(['Contas']);
    clickAfter(['Gestão de contas'], 90);
    clickAfter(['Orçamentos'], 190);
  }
  if (route === 'goals') {
    clickButton(['Análises']);
    clickAfter(['Metas'], 90);
  }
  if (route === 'investments') {
    clickButton(['Contas']);
    clickAfter(['Investimentos'], 90);
  }
  if (route === 'stats') {
    clickButton(['Análises']);
    clickAfter(['Estatísticas'], 90);
  }
  if (route === 'insights') {
    clickButton(['Análises']);
    clickAfter(['Insights AI'], 90);
  }
  if (route === 'health') {
    clickButton(['Análises']);
    clickAfter(['Saúde financeira'], 90);
  }
}

function detectArea(): MainArea {
  const activeTop = originalNavButtons().find((button) => button.classList.contains('active'));
  const topLabel = normalize(activeTop?.textContent);
  const activeSub = Array.from(document.querySelectorAll<HTMLButtonElement>('.mf-content button.active'))
    .map((button) => normalize(button.textContent));

  if (topLabel.includes('historico')) return 'movements';
  if (topLabel.includes('renda e folha') || topLabel.includes('preferencias')) return 'income';
  if (topLabel.includes('cartoes')) return 'commitments';
  if (topLabel.includes('contas')) {
    if (activeSub.some((label) => label.includes('investimentos') || label.includes('orcamentos'))) return 'planning';
    return 'commitments';
  }
  if (topLabel.includes('analises')) {
    if (activeSub.some((label) => label.includes('metas'))) return 'planning';
    return 'analysis';
  }
  return 'overview';
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'MF';
  return `${parts[0]?.[0] || ''}${parts.length > 1 ? parts[parts.length - 1]?.[0] || '' : ''}`.toUpperCase();
}

function ShellEnhancer() {
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [navHost, setNavHost] = useState<HTMLElement | null>(null);
  const [profileHost, setProfileHost] = useState<HTMLElement | null>(null);
  const [overviewHost, setOverviewHost] = useState<HTMLElement | null>(null);
  const [activeArea, setActiveArea] = useState<MainArea>('overview');
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [profile, setProfile] = useState<ProfileSettings | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [currentBalance, setCurrentBalance] = useState('0');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [monthExpenses, setMonthExpenses] = useState(0);
  const [readiness, setReadiness] = useState<Readiness>({
    profile: false,
    balance: false,
    income: false,
    commitment: false,
    movement: false,
  });
  const [profileOpen, setProfileOpen] = useState(false);
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [tutorialStep, setTutorialStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getUser().then(({ data }) => {
      if (!mounted) return;
      setUserId(data.user?.id || null);
      setEmail(data.user?.email || '');
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user?.id || null);
      setEmail(session?.user?.email || '');
    });
    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const syncStructure = () => {
      const nav = document.querySelector<HTMLElement>('.mf-nav');
      if (nav) {
        originalNavButtons().forEach((button) => {
          button.dataset.mfHierarchyOriginal = 'true';
          button.style.display = 'none';
        });

        let host = nav.querySelector<HTMLElement>('#mf-hierarchy-nav-host');
        if (!host) {
          host = document.createElement('div');
          host.id = 'mf-hierarchy-nav-host';
          nav.appendChild(host);
        }
        setNavHost(host);
      }

      const topActions = document.querySelector<HTMLElement>('.mf-top-actions');
      if (topActions) {
        let host = topActions.querySelector<HTMLElement>('#mf-profile-action-host');
        if (!host) {
          host = document.createElement('div');
          host.id = 'mf-profile-action-host';
          topActions.insertBefore(host, topActions.firstChild);
        }
        setProfileHost(host);
      }

      const content = document.querySelector<HTMLElement>('.mf-content');
      if (content) {
        let host = content.querySelector<HTMLElement>('#mf-onboarding-card-host');
        if (!host) {
          host = document.createElement('div');
          host.id = 'mf-onboarding-card-host';
          content.insertBefore(host, content.firstChild);
        }
        setOverviewHost(host);
      }

      setActiveArea(detectArea());
    };

    syncStructure();
    const observer = new MutationObserver(syncStructure);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
    const interval = window.setInterval(syncStructure, 450);
    window.addEventListener('resize', syncStructure);

    return () => {
      observer.disconnect();
      window.clearInterval(interval);
      window.removeEventListener('resize', syncStructure);
      originalNavButtons().forEach((button) => {
        if (button.dataset.mfHierarchyOriginal === 'true') button.style.display = '';
      });
    };
  }, []);

  async function loadProfileData() {
    if (!userId) return;
    setLoading(true);
    setError(null);

    const [settingsResult, monthLedgerResult, ledgerCountResult, fixedCountResult, cardsCountResult, payrollCountResult] = await Promise.all([
      supabase
        .from('mf_user_settings')
        .select('user_id,display_name,workspace_name,avatar_url,current_balance,gross_salary,onboarding_seen,onboarding_completed,balance_confirmed')
        .eq('user_id', userId)
        .maybeSingle(),
      supabase
        .from('mf_finance_ledger_entries')
        .select('amount,type,date')
        .eq('user_id', userId)
        .gte('date', currentMonthStart()),
      supabase.from('mf_finance_ledger_entries').select('id', { count: 'exact', head: true }).eq('user_id', userId),
      supabase.from('mf_fixed_bills').select('id', { count: 'exact', head: true }).eq('user_id', userId),
      supabase.from('mf_credit_cards').select('id', { count: 'exact', head: true }).eq('user_id', userId),
      supabase.from('mf_payroll_statements').select('id', { count: 'exact', head: true }).eq('user_id', userId),
    ]);

    const firstError = settingsResult.error || monthLedgerResult.error || ledgerCountResult.error || fixedCountResult.error || cardsCountResult.error || payrollCountResult.error;
    if (firstError) setError(firstError.message);

    const nextProfile = settingsResult.data as ProfileSettings | null;
    setProfile(nextProfile);
    setDisplayName(nextProfile?.display_name || '');
    setWorkspaceName(nextProfile?.workspace_name || '');
    setCurrentBalance(String(Number(nextProfile?.current_balance || 0)));
    setAvatarPreview(nextProfile?.avatar_url || null);

    const expenses = (monthLedgerResult.data || []).reduce((sum, row: any) => {
      const amount = Number(row.amount || 0);
      const type = normalize(row.type);
      return type === 'expense' || type === 'saida' || amount < 0 ? sum + Math.abs(amount) : sum;
    }, 0);
    setMonthExpenses(expenses);

    const nextReadiness: Readiness = {
      profile: Boolean(nextProfile?.display_name?.trim()),
      balance: Boolean(nextProfile?.balance_confirmed),
      income: Number(nextProfile?.gross_salary || 0) > 0 || Number(payrollCountResult.count || 0) > 0,
      commitment: Number(fixedCountResult.count || 0) > 0 || Number(cardsCountResult.count || 0) > 0,
      movement: Number(ledgerCountResult.count || 0) > 0,
    };
    setReadiness(nextReadiness);

    const allReady = Object.values(nextReadiness).every(Boolean);
    if (allReady && nextProfile && !nextProfile.onboarding_completed) {
      await supabase
        .from('mf_user_settings')
        .update({ onboarding_completed: true, onboarding_seen: true })
        .eq('user_id', userId);
      nextProfile.onboarding_completed = true;
      nextProfile.onboarding_seen = true;
      setProfile({ ...nextProfile });
    }

    if (nextProfile && !nextProfile.onboarding_seen) {
      setTutorialStep(0);
      setTutorialOpen(true);
    }

    setLoading(false);
  }

  useEffect(() => {
    if (!userId) return;
    void loadProfileData();

    const channel = supabase
      .channel(`profile-onboarding-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mf_user_settings', filter: `user_id=eq.${userId}` }, loadProfileData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mf_finance_ledger_entries', filter: `user_id=eq.${userId}` }, loadProfileData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mf_fixed_bills', filter: `user_id=eq.${userId}` }, loadProfileData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mf_credit_cards', filter: `user_id=eq.${userId}` }, loadProfileData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mf_payroll_statements', filter: `user_id=eq.${userId}` }, loadProfileData)
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const friendlyName = displayName.trim() || profile?.display_name?.trim() || email.split('@')[0] || 'você';
  const finalWorkspaceName =
    workspaceName.trim() || profile?.workspace_name?.trim() || `MF Financeiro de ${friendlyName}`;

  useEffect(() => {
    const brand = document.querySelector<HTMLElement>('.mf-brand');
    const title = brand?.querySelector<HTMLElement>('h1');
    const subtitle = brand?.querySelector<HTMLElement>('span');
    if (title) title.textContent = finalWorkspaceName;
    if (subtitle) subtitle.textContent = `Olá, ${friendlyName.split(/\s+/)[0]}`;
  }, [finalWorkspaceName, friendlyName]);

  const completedSteps = Object.values(readiness).filter(Boolean).length;
  const progress = Math.round((completedSteps / 5) * 100);
  const isAdmin = Boolean(findButtonByText(['Admin']));

  async function saveProfile() {
    if (!userId) return;
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const name = displayName.trim();
      const workspace = workspaceName.trim() || (name ? `MF Financeiro de ${name}` : 'Meu MF Financeiro');
      const balance = Number(currentBalance);
      if (!name) throw new Error('Informe o nome que deve aparecer no aplicativo.');
      if (!Number.isFinite(balance)) throw new Error('Informe um saldo atual válido.');

      let avatarUrl = profile?.avatar_url || null;
      if (avatarFile) {
        if (avatarFile.size > 3 * 1024 * 1024) throw new Error('A foto deve ter no máximo 3 MB.');
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(avatarFile.type)) {
          throw new Error('Use uma foto JPG, PNG ou WebP.');
        }
        const extension = avatarFile.type === 'image/jpeg' ? 'jpg' : avatarFile.type.split('/')[1];
        const path = `${userId}/avatar-${Date.now()}.${extension}`;
        const { error: uploadError } = await supabase.storage
          .from('mf-avatars')
          .upload(path, avatarFile, { cacheControl: '3600', upsert: false, contentType: avatarFile.type });
        if (uploadError) throw uploadError;
        const { data } = supabase.storage.from('mf-avatars').getPublicUrl(path);
        avatarUrl = `${data.publicUrl}?v=${Date.now()}`;
      }

      const { error: updateError } = await supabase
        .from('mf_user_settings')
        .update({
          display_name: name,
          workspace_name: workspace,
          avatar_url: avatarUrl,
          current_balance: balance,
          balance_confirmed: true,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', userId);
      if (updateError) throw updateError;

      setAvatarFile(null);
      setWorkspaceName(workspace);
      setSuccess('Perfil e saldo inicial atualizados.');
      await loadProfileData();
    } catch (saveError: any) {
      setError(saveError?.message || 'Não foi possível salvar o perfil.');
    } finally {
      setSaving(false);
    }
  }

  async function closeTutorial(markSeen = true) {
    setTutorialOpen(false);
    if (!userId || !markSeen) return;
    await supabase.from('mf_user_settings').update({ onboarding_seen: true }).eq('user_id', userId);
    setProfile((current) => (current ? { ...current, onboarding_seen: true } : current));
  }

  function chooseAvatar(file?: File) {
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) {
      setError('A foto deve ter no máximo 3 MB.');
      return;
    }
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
  }

  const mainItems = [
    { id: 'overview' as const, label: 'Visão Geral', icon: LayoutDashboard },
    { id: 'movements' as const, label: 'Movimentações', icon: Receipt },
    { id: 'commitments' as const, label: 'Compromissos', icon: WalletCards },
    { id: 'income' as const, label: 'Renda', icon: FileText },
    { id: 'planning' as const, label: 'Planejamento', icon: Target },
    { id: 'analysis' as const, label: 'Análises', icon: BarChart3 },
  ];

  const subItems =
    activeArea === 'commitments'
      ? [
          { id: 'upcoming', label: 'Próximos', icon: ListChecks },
          { id: 'bills', label: 'Contas', icon: CircleDollarSign },
          { id: 'subscriptions', label: 'Assinaturas', icon: ClipboardCheck },
          { id: 'cards', label: 'Cartões e parcelas', icon: CreditCard },
        ]
      : activeArea === 'planning'
        ? [
            { id: 'budgets', label: 'Orçamentos', icon: PiggyBank },
            { id: 'goals', label: 'Metas', icon: Target },
            { id: 'investments', label: 'Investimentos', icon: Landmark },
          ]
        : activeArea === 'analysis'
          ? [
              { id: 'stats', label: 'Resumo', icon: BarChart3 },
              { id: 'insights', label: 'Insight financeiro', icon: Sparkles },
              { id: 'health', label: 'Saúde financeira', icon: ClipboardCheck },
            ]
          : [];

  return (
    <>
      <style>{`
        .mf-nav { overflow: visible !important; }
        #mf-hierarchy-nav-host { width: 100%; min-width: 0; }
        .mf-hierarchy-shell { display: flex; flex-direction: column; gap: 7px; width: 100%; min-width: 0; }
        .mf-hierarchy-main, .mf-hierarchy-sub { display: flex; align-items: center; gap: 6px; min-width: 0; overflow-x: auto; scrollbar-width: none; }
        .mf-hierarchy-main::-webkit-scrollbar, .mf-hierarchy-sub::-webkit-scrollbar { display: none; }
        .mf-hierarchy-button { display: inline-flex; align-items: center; gap: 7px; flex: 0 0 auto; border: 1px solid transparent; border-radius: 12px; padding: 8px 11px; font-size: 11px; font-weight: 800; color: rgba(255,255,255,.5); background: transparent; transition: .2s ease; }
        .mf-hierarchy-button:hover { color: #fff; background: rgba(255,255,255,.06); }
        .mf-hierarchy-button.active { color: #050505; background: var(--brand-primary, #00f2ff); box-shadow: 0 0 22px rgba(0,242,255,.13); }
        .mf-hierarchy-sub { padding-left: 2px; }
        .mf-hierarchy-sub .mf-hierarchy-button { padding: 6px 9px; font-size: 10px; background: rgba(255,255,255,.035); border-color: rgba(255,255,255,.06); }
        #mf-profile-action-host { display: flex; align-items: center; }
        .mf-profile-trigger { display: flex !important; align-items: center; gap: 8px; width: auto !important; padding: 4px 9px 4px 4px !important; border: 1px solid rgba(255,255,255,.1) !important; border-radius: 999px !important; background: rgba(255,255,255,.04) !important; }
        .mf-avatar { width: 30px; height: 30px; border-radius: 999px; overflow: hidden; display: grid; place-items: center; flex: 0 0 auto; background: rgba(0,242,255,.14); color: var(--brand-primary, #00f2ff); font-size: 10px; font-weight: 900; border: 1px solid rgba(0,242,255,.25); }
        .mf-avatar img { width: 100%; height: 100%; object-fit: cover; }
        .mf-onboarding-card { margin-bottom: 14px; border: 1px solid rgba(0,242,255,.2); border-radius: 18px; background: linear-gradient(135deg, rgba(0,242,255,.07), rgba(255,255,255,.025)); padding: 16px; }
        .mf-setup-grid { display: grid; grid-template-columns: repeat(5, minmax(0,1fr)); gap: 8px; margin-top: 13px; }
        .mf-setup-step { border: 1px solid rgba(255,255,255,.08); border-radius: 13px; padding: 10px; background: rgba(0,0,0,.2); text-align: left; color: rgba(255,255,255,.6); }
        .mf-setup-step.done { border-color: rgba(34,197,94,.25); color: #86efac; }
        .mf-dialog-backdrop { position: fixed; inset: 0; z-index: 120; background: rgba(0,0,0,.78); backdrop-filter: blur(9px); display: grid; place-items: center; padding: 16px; }
        .mf-dialog { width: min(620px,100%); max-height: min(820px,92vh); overflow-y: auto; border: 1px solid rgba(255,255,255,.11); border-radius: 22px; background: #080808; box-shadow: 0 28px 90px rgba(0,0,0,.65); }
        .mf-dialog-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 17px 18px; border-bottom: 1px solid rgba(255,255,255,.08); }
        .mf-dialog-body { padding: 18px; }
        .mf-dialog input { width: 100%; border: 1px solid rgba(255,255,255,.1); border-radius: 12px; background: rgba(255,255,255,.035); color: white; padding: 10px 12px; outline: none; }
        .mf-dialog input:focus { border-color: rgba(0,242,255,.45); }
        .mf-profile-grid { display: grid; grid-template-columns: 130px minmax(0,1fr); gap: 18px; }
        .mf-profile-photo { width: 118px; height: 118px; border-radius: 24px; overflow: hidden; display: grid; place-items: center; background: rgba(0,242,255,.1); color: var(--brand-primary, #00f2ff); font-size: 28px; font-weight: 900; border: 1px solid rgba(0,242,255,.22); }
        .mf-profile-photo img { width: 100%; height: 100%; object-fit: cover; }
        .mf-area-grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 9px; }
        .mf-area-card { border: 1px solid rgba(255,255,255,.08); border-radius: 14px; padding: 12px; background: rgba(255,255,255,.025); }
        @media (max-width: 980px) {
          .mf-hierarchy-button span { display: none; }
          .mf-hierarchy-button { padding: 9px; }
          .mf-hierarchy-sub .mf-hierarchy-button span { display: inline; }
          .mf-setup-grid { grid-template-columns: 1fr 1fr; }
        }
        @media (max-width: 620px) {
          .mf-brand h1 { max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          .mf-profile-trigger > span:last-child { display: none; }
          .mf-profile-grid { grid-template-columns: 1fr; }
          .mf-profile-photo { width: 92px; height: 92px; }
          .mf-area-grid { grid-template-columns: 1fr; }
          .mf-setup-grid { grid-template-columns: 1fr; }
        }
      `}</style>

      {navHost && createPortal(
        <div className="mf-hierarchy-shell">
          <div className="mf-hierarchy-main">
            {mainItems.map((item) => (
              <button
                key={item.id}
                type="button"
                title={item.label}
                className={`mf-hierarchy-button ${activeArea === item.id ? 'active' : ''}`}
                onClick={() => navigateMain(item.id)}
              >
                <item.icon size={15} /><span>{item.label}</span>
              </button>
            ))}
          </div>
          {subItems.length > 0 && (
            <div className="mf-hierarchy-sub">
              {subItems.map((item) => (
                <button key={item.id} type="button" className="mf-hierarchy-button" onClick={() => navigateSubroute(item.id)}>
                  <item.icon size={13} /><span>{item.label}</span><ChevronRight size={11} />
                </button>
              ))}
            </div>
          )}
        </div>,
        navHost,
      )}

      {profileHost && createPortal(
        <button type="button" className="mf-profile-trigger" title="Perfil" onClick={() => { setProfileOpen(true); setError(null); setSuccess(null); }}>
          <span className="mf-avatar">
            {avatarPreview || profile?.avatar_url ? <img src={avatarPreview || profile?.avatar_url || ''} alt="Foto do perfil" /> : initials(friendlyName)}
          </span>
          <span style={{ fontSize: 10, fontWeight: 800, color: 'rgba(255,255,255,.7)', maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{friendlyName.split(/\s+/)[0]}</span>
        </button>,
        profileHost,
      )}

      {overviewHost && activeArea === 'overview' && profile && !profile.onboarding_completed && createPortal(
        <section className="mf-onboarding-card">
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 900 }}><Sparkles size={16} /> Prepare sua Visão Geral</div>
              <p style={{ marginTop: 5, fontSize: 10, color: 'rgba(255,255,255,.4)' }}>Complete os registros essenciais para liberar projeções, alertas e insights confiáveis.</p>
            </div>
            <div style={{ minWidth: 130, textAlign: 'right' }}>
              <strong style={{ color: 'var(--brand-primary,#00f2ff)' }}>{progress}% concluído</strong>
              <div style={{ height: 5, marginTop: 7, borderRadius: 99, background: 'rgba(255,255,255,.08)', overflow: 'hidden' }}><div style={{ width: `${progress}%`, height: '100%', background: 'var(--brand-primary,#00f2ff)' }} /></div>
            </div>
          </div>
          <div className="mf-setup-grid">
            <SetupStep done={readiness.profile} label="Nome e perfil" onClick={() => setProfileOpen(true)} />
            <SetupStep done={readiness.balance} label="Saldo inicial" onClick={() => setProfileOpen(true)} />
            <SetupStep done={readiness.income} label="Renda ou holerite" onClick={() => navigateMain('income')} />
            <SetupStep done={readiness.commitment} label="Conta ou cartão" onClick={() => navigateMain('commitments')} />
            <SetupStep done={readiness.movement} label="Primeira movimentação" onClick={() => navigateMain('movements')} />
          </div>
        </section>,
        overviewHost,
      )}

      {profileOpen && (
        <div className="mf-dialog-backdrop" role="dialog" aria-modal="true">
          <div className="mf-dialog">
            <header className="mf-dialog-header">
              <div><strong style={{ display: 'block', fontSize: 15 }}>Seu espaço financeiro</strong><span style={{ fontSize: 10, color: 'rgba(255,255,255,.35)' }}>Personalize o nome, a foto e confirme o saldo usado nas análises.</span></div>
              <button type="button" onClick={() => setProfileOpen(false)}><X size={18} /></button>
            </header>
            <div className="mf-dialog-body">
              {(error || success) && <div style={{ marginBottom: 13, borderRadius: 12, padding: '10px 12px', fontSize: 11, color: error ? '#fca5a5' : '#86efac', background: error ? 'rgba(239,68,68,.1)' : 'rgba(34,197,94,.1)' }}>{error || success}</div>}
              <div className="mf-profile-grid">
                <div>
                  <div className="mf-profile-photo">{avatarPreview || profile?.avatar_url ? <img src={avatarPreview || profile?.avatar_url || ''} alt="Prévia da foto" /> : initials(friendlyName)}</div>
                  <input ref={avatarInputRef} hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => chooseAvatar(event.target.files?.[0])} />
                  <button type="button" onClick={() => avatarInputRef.current?.click()} style={{ width: 118, marginTop: 9, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 6, border: '1px solid rgba(255,255,255,.1)', borderRadius: 11, padding: 8, fontSize: 10, fontWeight: 800 }}><Camera size={13} /> Trocar foto</button>
                </div>
                <div style={{ display: 'grid', gap: 12 }}>
                  <label style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', color: 'rgba(255,255,255,.4)' }}>Seu nome<input value={displayName} maxLength={80} onChange={(event) => setDisplayName(event.target.value)} placeholder="Ex.: Lucas" style={{ marginTop: 6 }} /></label>
                  <label style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', color: 'rgba(255,255,255,.4)' }}>Nome do espaço<input value={workspaceName} maxLength={120} onChange={(event) => setWorkspaceName(event.target.value)} placeholder={displayName ? `MF Financeiro de ${displayName}` : 'Meu MF Financeiro'} style={{ marginTop: 6 }} /></label>
                  <label style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', color: 'rgba(255,255,255,.4)' }}>Saldo atual confirmado<input type="number" step="0.01" value={currentBalance} onChange={(event) => setCurrentBalance(event.target.value)} style={{ marginTop: 6 }} /></label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 }}>
                    <div style={{ border: '1px solid rgba(255,255,255,.08)', borderRadius: 13, padding: 11 }}><span style={{ display: 'block', fontSize: 9, color: 'rgba(255,255,255,.35)' }}>GASTOS DO MÊS</span><strong style={{ display: 'block', marginTop: 4, fontSize: 14 }}>{money(monthExpenses)}</strong></div>
                    <div style={{ border: '1px solid rgba(255,255,255,.08)', borderRadius: 13, padding: 11 }}><span style={{ display: 'block', fontSize: 9, color: 'rgba(255,255,255,.35)' }}>CONFIGURAÇÃO</span><strong style={{ display: 'block', marginTop: 4, fontSize: 14, color: 'var(--brand-primary,#00f2ff)' }}>{progress}%</strong></div>
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 9, marginTop: 18, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button type="button" onClick={() => { setProfileOpen(false); setTutorialStep(0); setTutorialOpen(true); }} style={{ border: '1px solid rgba(255,255,255,.1)', borderRadius: 11, padding: '9px 12px', fontSize: 10, fontWeight: 800 }}><Sparkles size={13} style={{ display: 'inline', marginRight: 6 }} />Ver tutorial</button>
                  {isAdmin && <button type="button" onClick={() => { setProfileOpen(false); clickButton(['Admin']); }} style={{ border: '1px solid rgba(255,255,255,.1)', borderRadius: 11, padding: '9px 12px', fontSize: 10, fontWeight: 800 }}>Admin</button>}
                </div>
                <button type="button" onClick={saveProfile} disabled={saving} style={{ display: 'flex', alignItems: 'center', gap: 7, borderRadius: 11, padding: '10px 15px', background: 'var(--brand-primary,#00f2ff)', color: '#050505', fontSize: 11, fontWeight: 900, opacity: saving ? .5 : 1 }}><Save size={14} />{saving ? 'Salvando...' : 'Salvar perfil'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {tutorialOpen && (
        <div className="mf-dialog-backdrop" role="dialog" aria-modal="true">
          <div className="mf-dialog">
            <header className="mf-dialog-header">
              <div><strong style={{ display: 'block', fontSize: 15 }}>Primeiros passos no MF Financeiro</strong><span style={{ fontSize: 10, color: 'rgba(255,255,255,.35)' }}>Etapa {tutorialStep + 1} de 3</span></div>
              <button type="button" onClick={() => void closeTutorial(true)}><X size={18} /></button>
            </header>
            <div className="mf-dialog-body">
              {tutorialStep === 0 && (
                <div style={{ textAlign: 'center', padding: '16px 4px 8px' }}>
                  <div style={{ width: 68, height: 68, margin: '0 auto', borderRadius: 22, display: 'grid', placeItems: 'center', color: 'var(--brand-primary,#00f2ff)', background: 'rgba(0,242,255,.1)', border: '1px solid rgba(0,242,255,.2)' }}><WalletCards size={30} /></div>
                  <h2 style={{ marginTop: 16, fontSize: 22, fontWeight: 900 }}>Bem-vindo ao seu espaço financeiro</h2>
                  <p style={{ maxWidth: 470, margin: '9px auto 0', fontSize: 12, lineHeight: 1.6, color: 'rgba(255,255,255,.5)' }}>O aplicativo organiza o que entrou e saiu, o que ainda precisa ser pago, sua renda, seus planos e o que os dados estão mostrando.</p>
                </div>
              )}
              {tutorialStep === 1 && (
                <div>
                  <h2 style={{ fontSize: 18, fontWeight: 900 }}>Seis áreas, cada uma com um objetivo</h2>
                  <div className="mf-area-grid" style={{ marginTop: 14 }}>
                    <TutorialArea icon={LayoutDashboard} title="Visão Geral" text="Saldo, limite diário, alertas e próximos eventos." />
                    <TutorialArea icon={Receipt} title="Movimentações" text="Entradas, saídas, lançamentos e importação de extratos." />
                    <TutorialArea icon={WalletCards} title="Compromissos" text="Contas, assinaturas, cartões, parcelas e calendário." />
                    <TutorialArea icon={FileText} title="Renda" text="Holerites, descontos, benefícios e divisão do recebimento." />
                    <TutorialArea icon={Target} title="Planejamento" text="Orçamentos, metas e investimentos." />
                    <TutorialArea icon={BarChart3} title="Análises" text="Resumo, Insight financeiro e saúde financeira." />
                  </div>
                </div>
              )}
              {tutorialStep === 2 && (
                <div>
                  <h2 style={{ fontSize: 18, fontWeight: 900 }}>O que registrar primeiro</h2>
                  <p style={{ marginTop: 6, fontSize: 11, lineHeight: 1.5, color: 'rgba(255,255,255,.45)' }}>A Visão Geral fica mais útil quando estes cinco pontos estão preenchidos.</p>
                  <div style={{ display: 'grid', gap: 8, marginTop: 14 }}>
                    <TutorialChecklist done={readiness.profile} text="Nome e foto do perfil" />
                    <TutorialChecklist done={readiness.balance} text="Saldo atual da conta" />
                    <TutorialChecklist done={readiness.income} text="Renda mensal ou primeiro holerite" />
                    <TutorialChecklist done={readiness.commitment} text="Uma conta fixa ou cartão" />
                    <TutorialChecklist done={readiness.movement} text="Uma movimentação ou extrato importado" />
                  </div>
                  <div style={{ marginTop: 14, borderRadius: 13, padding: 12, background: 'rgba(0,242,255,.07)', border: '1px solid rgba(0,242,255,.16)', fontSize: 10, color: 'rgba(255,255,255,.55)' }}>Um checklist continuará aparecendo na Visão Geral até que os registros essenciais estejam completos.</div>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 9, marginTop: 20 }}>
                <button type="button" onClick={() => void closeTutorial(true)} style={{ border: '1px solid rgba(255,255,255,.1)', borderRadius: 11, padding: '9px 12px', fontSize: 10, fontWeight: 800 }}>Agora não</button>
                <div style={{ display: 'flex', gap: 8 }}>
                  {tutorialStep > 0 && <button type="button" onClick={() => setTutorialStep((step) => step - 1)} style={{ border: '1px solid rgba(255,255,255,.1)', borderRadius: 11, padding: '9px 12px', fontSize: 10, fontWeight: 800 }}>Voltar</button>}
                  {tutorialStep < 2 ? (
                    <button type="button" onClick={() => setTutorialStep((step) => step + 1)} style={{ borderRadius: 11, padding: '10px 15px', background: 'var(--brand-primary,#00f2ff)', color: '#050505', fontSize: 11, fontWeight: 900 }}>Continuar</button>
                  ) : (
                    <button type="button" onClick={() => { void closeTutorial(true); navigateMain('overview'); }} style={{ borderRadius: 11, padding: '10px 15px', background: 'var(--brand-primary,#00f2ff)', color: '#050505', fontSize: 11, fontWeight: 900 }}>Ir para Visão Geral</button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {loading && !profile && <span style={{ display: 'none' }}>Carregando perfil</span>}
    </>
  );
}

function SetupStep({ done, label, onClick }: { done: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" className={`mf-setup-step ${done ? 'done' : ''}`} onClick={onClick}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 10, fontWeight: 800 }}>{done ? <Check size={13} /> : <ChevronRight size={13} />}{label}</span>
    </button>
  );
}

function TutorialArea({ icon: Icon, title, text }: { icon: React.ComponentType<{ size?: number }>; title: string; text: string }) {
  return <div className="mf-area-card"><div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, fontWeight: 900 }}><Icon size={15} />{title}</div><p style={{ marginTop: 6, fontSize: 10, lineHeight: 1.45, color: 'rgba(255,255,255,.4)' }}>{text}</p></div>;
}

function TutorialChecklist({ done, text }: { done: boolean; text: string }) {
  return <div style={{ display: 'flex', alignItems: 'center', gap: 9, borderRadius: 12, padding: '10px 11px', border: `1px solid ${done ? 'rgba(34,197,94,.22)' : 'rgba(255,255,255,.08)'}`, background: done ? 'rgba(34,197,94,.06)' : 'rgba(255,255,255,.02)', color: done ? '#86efac' : 'rgba(255,255,255,.55)', fontSize: 11 }}><span style={{ width: 20, height: 20, borderRadius: 99, display: 'grid', placeItems: 'center', background: done ? 'rgba(34,197,94,.15)' : 'rgba(255,255,255,.06)' }}>{done ? <Check size={12} /> : <ChevronRight size={12} />}</span>{text}</div>;
}

function mountShellEnhancer() {
  if (document.getElementById('mf-navigation-profile-onboarding-root')) return;
  const host = document.createElement('div');
  host.id = 'mf-navigation-profile-onboarding-root';
  document.body.appendChild(host);
  createRoot(host).render(<ShellEnhancer />);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mountShellEnhancer, { once: true });
} else {
  mountShellEnhancer();
}

export {};
