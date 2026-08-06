import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { Camera, Check, ChevronRight, Save, Sparkles, X } from 'lucide-react';
import { format } from 'date-fns';
import { supabase } from './supabase';

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

const normalize = (value: string | null | undefined) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const money = (value: number) =>
  Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const currentMonthStart = () => `${format(new Date(), 'yyyy-MM')}-01`;

function findButton(labels: string[], includeHidden = true): HTMLButtonElement | null {
  const wanted = labels.map(normalize);
  return Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((button) => {
    if (!includeHidden && button.offsetParent === null) return false;
    const label = normalize(button.textContent);
    return wanted.some((item) => label === item || label.includes(item));
  }) || null;
}

function openPrimary(label: 'Início' | 'Movimentações' | 'Contas' | 'Renda') {
  const simple = Array.from(document.querySelectorAll<HTMLButtonElement>('#mf-simple-navigation-root button'))
    .find((button) => normalize(button.textContent) === normalize(label));
  if (simple) {
    simple.click();
    return;
  }

  if (label === 'Início') findButton(['Dashboard'])?.click();
  if (label === 'Movimentações') findButton(['Histórico'])?.click();
  if (label === 'Contas') findButton(['Contas'])?.click();
  if (label === 'Renda') findButton(['Renda e Folha', 'Preferências'])?.click();
}

function ProfileOnboarding() {
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const loadSequenceRef = useRef(0);
  const [profileHost, setProfileHost] = useState<HTMLElement | null>(null);
  const [overviewHost, setOverviewHost] = useState<HTMLElement | null>(null);
  const [activePrimary, setActivePrimary] = useState('inicio');
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [profile, setProfile] = useState<ProfileSettings | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [currentBalance, setCurrentBalance] = useState('0');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [monthExpenses, setMonthExpenses] = useState(0);
  const [readiness, setReadiness] = useState<Readiness>({ profile: false, balance: false, income: false, commitment: false, movement: false });
  const [profileOpen, setProfileOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getUser().then(({ data }) => {
      if (!mounted) return;
      setUserId(data.user?.id || null);
      setEmail(data.user?.email || '');
    }).catch(() => undefined);

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

      const active = document.querySelector<HTMLButtonElement>('#mf-simple-navigation-root .mf-simple-button.active');
      if (active) setActivePrimary(normalize(active.textContent));
    };

    syncStructure();
    const observer = new MutationObserver(syncStructure);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
    const interval = window.setInterval(syncStructure, 700);

    return () => {
      observer.disconnect();
      window.clearInterval(interval);
    };
  }, []);

  async function loadProfileData() {
    if (!userId) return;
    const sequence = ++loadSequenceRef.current;

    const [settingsResult, monthLedgerResult, ledgerCountResult, fixedCountResult, cardsCountResult, payrollCountResult] = await Promise.all([
      supabase
        .from('mf_user_settings')
        .select('user_id,display_name,workspace_name,avatar_url,current_balance,gross_salary,onboarding_seen,onboarding_completed,balance_confirmed')
        .eq('user_id', userId)
        .maybeSingle(),
      supabase.from('mf_finance_ledger_entries').select('amount,type,date').eq('user_id', userId).gte('date', currentMonthStart()),
      supabase.from('mf_finance_ledger_entries').select('id', { count: 'exact', head: true }).eq('user_id', userId),
      supabase.from('mf_fixed_bills').select('id', { count: 'exact', head: true }).eq('user_id', userId),
      supabase.from('mf_credit_cards').select('id', { count: 'exact', head: true }).eq('user_id', userId),
      supabase.from('mf_payroll_statements').select('id', { count: 'exact', head: true }).eq('user_id', userId),
    ]);

    if (sequence !== loadSequenceRef.current) return;

    const firstError = settingsResult.error || monthLedgerResult.error || ledgerCountResult.error || fixedCountResult.error || cardsCountResult.error || payrollCountResult.error;
    if (firstError) {
      setError(firstError.message);
      return;
    }

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
      const { error: completionError } = await supabase
        .from('mf_user_settings')
        .update({ onboarding_completed: true })
        .eq('user_id', userId);
      if (!completionError && sequence === loadSequenceRef.current) {
        setProfile((current) => current ? { ...current, onboarding_completed: true } : current);
      }
    }
  }

  useEffect(() => {
    if (!userId) return;
    void loadProfileData();

    const channel = supabase
      .channel(`profile-readiness-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mf_user_settings', filter: `user_id=eq.${userId}` }, () => void loadProfileData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mf_finance_ledger_entries', filter: `user_id=eq.${userId}` }, () => void loadProfileData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mf_fixed_bills', filter: `user_id=eq.${userId}` }, () => void loadProfileData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mf_credit_cards', filter: `user_id=eq.${userId}` }, () => void loadProfileData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mf_payroll_statements', filter: `user_id=eq.${userId}` }, () => void loadProfileData())
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const friendlyName = displayName.trim() || profile?.display_name?.trim() || email.split('@')[0] || 'você';
  const finalWorkspaceName = workspaceName.trim() || profile?.workspace_name?.trim() || `MF Financeiro de ${friendlyName}`;
  const completedSteps = Object.values(readiness).filter(Boolean).length;
  const progress = Math.round((completedSteps / 5) * 100);
  const isAdmin = Boolean(findButton(['Admin']));

  useEffect(() => {
    const brand = document.querySelector<HTMLElement>('.mf-brand');
    const title = brand?.querySelector<HTMLElement>('h1');
    const subtitle = brand?.querySelector<HTMLElement>('span');
    if (title) title.textContent = finalWorkspaceName;
    if (subtitle) subtitle.textContent = `Olá, ${friendlyName.split(/\s+/)[0]}`;
  }, [finalWorkspaceName, friendlyName]);

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
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(avatarFile.type)) throw new Error('Use uma foto JPG, PNG ou WebP.');
        const extension = avatarFile.type === 'image/jpeg' ? 'jpg' : avatarFile.type.split('/')[1];
        const path = `${userId}/avatar-${Date.now()}.${extension}`;
        const { error: uploadError } = await supabase.storage.from('mf-avatars').upload(path, avatarFile, { cacheControl: '3600', upsert: false, contentType: avatarFile.type });
        if (uploadError) throw uploadError;
        const { data } = supabase.storage.from('mf-avatars').getPublicUrl(path);
        avatarUrl = `${data.publicUrl}?v=${Date.now()}`;
      }

      const { error: updateError } = await supabase
        .from('mf_user_settings')
        .update({ display_name: name, workspace_name: workspace, avatar_url: avatarUrl, current_balance: balance, balance_confirmed: true, updated_at: new Date().toISOString() })
        .eq('user_id', userId);
      if (updateError) throw updateError;

      setAvatarFile(null);
      setWorkspaceName(workspace);
      setSuccess('Perfil e saldo atualizados.');
      await loadProfileData();
    } catch (saveError: any) {
      setError(saveError?.message || 'Não foi possível salvar o perfil.');
    } finally {
      setSaving(false);
    }
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

  function openTutorial() {
    setProfileOpen(false);
    window.setTimeout(() => window.dispatchEvent(new CustomEvent('mf:open-tutorial')), 0);
  }

  return (
    <>
      <style>{`
        #mf-profile-action-host { display:flex; align-items:center; }
        .mf-profile-trigger { display:flex !important; align-items:center; gap:8px; width:auto !important; padding:4px 9px 4px 4px !important; border:1px solid rgba(255,255,255,.1) !important; border-radius:999px !important; background:rgba(255,255,255,.04) !important; }
        .mf-avatar { width:30px; height:30px; border-radius:999px; overflow:hidden; display:grid; place-items:center; flex:0 0 auto; background:rgba(0,242,255,.14); color:var(--brand-primary,#00f2ff); font-size:10px; font-weight:900; border:1px solid rgba(0,242,255,.25); }
        .mf-avatar img,.mf-profile-photo img { width:100%; height:100%; object-fit:cover; }
        .mf-onboarding-card { margin-bottom:14px; border:1px solid rgba(0,242,255,.2); border-radius:18px; background:linear-gradient(135deg,rgba(0,242,255,.07),rgba(255,255,255,.025)); padding:16px; }
        .mf-setup-grid { display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); gap:8px; margin-top:13px; }
        .mf-setup-step { border:1px solid rgba(255,255,255,.08); border-radius:13px; padding:10px; background:rgba(0,0,0,.2); text-align:left; color:rgba(255,255,255,.6); }
        .mf-setup-step.done { border-color:rgba(34,197,94,.25); color:#86efac; }
        .mf-profile-backdrop { position:fixed; inset:0; z-index:2147482000; background:rgba(0,0,0,.78); backdrop-filter:blur(9px); display:grid; place-items:center; padding:16px; }
        .mf-profile-dialog { width:min(620px,100%); max-height:min(820px,92vh); overflow-y:auto; border:1px solid rgba(255,255,255,.11); border-radius:22px; background:#080808; box-shadow:0 28px 90px rgba(0,0,0,.65); }
        .mf-profile-header { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:17px 18px; border-bottom:1px solid rgba(255,255,255,.08); }
        .mf-profile-body { padding:18px; }
        .mf-profile-dialog input { width:100%; border:1px solid rgba(255,255,255,.1); border-radius:12px; background:rgba(255,255,255,.035); color:white; padding:10px 12px; outline:none; }
        .mf-profile-dialog input:focus { border-color:rgba(0,242,255,.45); }
        .mf-profile-grid { display:grid; grid-template-columns:130px minmax(0,1fr); gap:18px; }
        .mf-profile-photo { width:118px; height:118px; border-radius:24px; overflow:hidden; display:grid; place-items:center; background:rgba(0,242,255,.1); color:var(--brand-primary,#00f2ff); font-size:28px; font-weight:900; border:1px solid rgba(0,242,255,.22); }
        @media(max-width:980px){ .mf-setup-grid{grid-template-columns:1fr 1fr;} }
        @media(max-width:620px){ .mf-profile-trigger>span:last-child{display:none;} .mf-profile-grid{grid-template-columns:1fr;} .mf-profile-photo{width:92px;height:92px;} .mf-setup-grid{grid-template-columns:1fr;} }
      `}</style>

      {profileHost && createPortal(
        <button type="button" className="mf-profile-trigger" title="Perfil" onClick={() => { setProfileOpen(true); setError(null); setSuccess(null); }}>
          <span className="mf-avatar">
            {avatarPreview || profile?.avatar_url ? <img src={avatarPreview || profile?.avatar_url || ''} alt="Foto do perfil" /> : initials(friendlyName)}
          </span>
          <span style={{ fontSize:10, fontWeight:800, color:'rgba(255,255,255,.7)', maxWidth:100, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{friendlyName.split(/\s+/)[0]}</span>
        </button>,
        profileHost,
      )}

      {overviewHost && activePrimary === 'inicio' && profile && !profile.onboarding_completed && createPortal(
        <section className="mf-onboarding-card">
          <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:14, flexWrap:'wrap' }}>
            <div>
              <div style={{ display:'flex', alignItems:'center', gap:8, fontSize:13, fontWeight:900 }}><Sparkles size={16}/> Prepare seu Início</div>
              <p style={{ marginTop:5, fontSize:10, color:'rgba(255,255,255,.4)' }}>Complete os registros essenciais para liberar projeções, alertas e insights confiáveis.</p>
            </div>
            <div style={{ minWidth:130, textAlign:'right' }}>
              <strong style={{ color:'var(--brand-primary,#00f2ff)' }}>{progress}% concluído</strong>
              <div style={{ height:5, marginTop:7, borderRadius:99, background:'rgba(255,255,255,.08)', overflow:'hidden' }}><div style={{ width:`${progress}%`, height:'100%', background:'var(--brand-primary,#00f2ff)' }}/></div>
            </div>
          </div>
          <div className="mf-setup-grid">
            <SetupStep done={readiness.profile} label="Nome e perfil" onClick={() => setProfileOpen(true)} />
            <SetupStep done={readiness.balance} label="Saldo atual" onClick={() => setProfileOpen(true)} />
            <SetupStep done={readiness.income} label="Renda ou holerite" onClick={() => openPrimary('Renda')} />
            <SetupStep done={readiness.commitment} label="Conta ou cartão" onClick={() => openPrimary('Contas')} />
            <SetupStep done={readiness.movement} label="Primeira movimentação" onClick={() => openPrimary('Movimentações')} />
          </div>
        </section>,
        overviewHost,
      )}

      {profileOpen && (
        <div className="mf-profile-backdrop" role="dialog" aria-modal="true" onMouseDown={(event) => { if (event.target === event.currentTarget) setProfileOpen(false); }}>
          <div className="mf-profile-dialog">
            <header className="mf-profile-header">
              <div><strong style={{ display:'block', fontSize:15 }}>Seu espaço financeiro</strong><span style={{ fontSize:10, color:'rgba(255,255,255,.35)' }}>Personalize o nome, a foto e confirme o saldo usado nas análises.</span></div>
              <button type="button" onClick={() => setProfileOpen(false)}><X size={18}/></button>
            </header>
            <div className="mf-profile-body">
              {(error || success) && <div style={{ marginBottom:13, borderRadius:12, padding:'10px 12px', fontSize:11, color:error ? '#fca5a5' : '#86efac', background:error ? 'rgba(239,68,68,.1)' : 'rgba(34,197,94,.1)' }}>{error || success}</div>}
              <div className="mf-profile-grid">
                <div>
                  <div className="mf-profile-photo">{avatarPreview || profile?.avatar_url ? <img src={avatarPreview || profile?.avatar_url || ''} alt="Prévia da foto"/> : initials(friendlyName)}</div>
                  <input ref={avatarInputRef} hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => chooseAvatar(event.target.files?.[0])}/>
                  <button type="button" onClick={() => avatarInputRef.current?.click()} style={{ width:118, marginTop:9, display:'flex', justifyContent:'center', alignItems:'center', gap:6, border:'1px solid rgba(255,255,255,.1)', borderRadius:11, padding:8, fontSize:10, fontWeight:800 }}><Camera size={13}/> Trocar foto</button>
                </div>
                <div style={{ display:'grid', gap:12 }}>
                  <label style={{ fontSize:9, fontWeight:800, textTransform:'uppercase', color:'rgba(255,255,255,.4)' }}>Seu nome<input value={displayName} maxLength={80} onChange={(event) => setDisplayName(event.target.value)} placeholder="Ex.: Lucas" style={{ marginTop:6 }}/></label>
                  <label style={{ fontSize:9, fontWeight:800, textTransform:'uppercase', color:'rgba(255,255,255,.4)' }}>Nome do espaço<input value={workspaceName} maxLength={120} onChange={(event) => setWorkspaceName(event.target.value)} placeholder={displayName ? `MF Financeiro de ${displayName}` : 'Meu MF Financeiro'} style={{ marginTop:6 }}/></label>
                  <label style={{ fontSize:9, fontWeight:800, textTransform:'uppercase', color:'rgba(255,255,255,.4)' }}>Saldo atual confirmado<input type="number" step="0.01" value={currentBalance} onChange={(event) => setCurrentBalance(event.target.value)} style={{ marginTop:6 }}/></label>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:9 }}>
                    <div style={{ border:'1px solid rgba(255,255,255,.08)', borderRadius:13, padding:11 }}><span style={{ display:'block', fontSize:9, color:'rgba(255,255,255,.35)' }}>GASTOS DO MÊS</span><strong style={{ display:'block', marginTop:4, fontSize:14 }}>{money(monthExpenses)}</strong></div>
                    <div style={{ border:'1px solid rgba(255,255,255,.08)', borderRadius:13, padding:11 }}><span style={{ display:'block', fontSize:9, color:'rgba(255,255,255,.35)' }}>CONFIGURAÇÃO</span><strong style={{ display:'block', marginTop:4, fontSize:14, color:'var(--brand-primary,#00f2ff)' }}>{progress}%</strong></div>
                  </div>
                </div>
              </div>
              <div style={{ display:'flex', justifyContent:'space-between', gap:9, marginTop:18, flexWrap:'wrap' }}>
                <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                  <button type="button" onClick={openTutorial} style={{ border:'1px solid rgba(255,255,255,.1)', borderRadius:11, padding:'9px 12px', fontSize:10, fontWeight:800 }}><Sparkles size={13} style={{ display:'inline', marginRight:6 }}/>Ver tutorial</button>
                  {isAdmin && <button type="button" onClick={() => { setProfileOpen(false); findButton(['Admin'])?.click(); }} style={{ border:'1px solid rgba(255,255,255,.1)', borderRadius:11, padding:'9px 12px', fontSize:10, fontWeight:800 }}>Admin</button>}
                </div>
                <button type="button" onClick={saveProfile} disabled={saving} style={{ display:'flex', alignItems:'center', gap:7, borderRadius:11, padding:'10px 15px', background:'var(--brand-primary,#00f2ff)', color:'#050505', fontSize:11, fontWeight:900, opacity:saving ? .5 : 1 }}><Save size={14}/>{saving ? 'Salvando...' : 'Salvar perfil'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'MF';
  return `${parts[0]?.[0] || ''}${parts.length > 1 ? parts[parts.length - 1]?.[0] || '' : ''}`.toUpperCase();
}

function SetupStep({ done, label, onClick }: { done: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" className={`mf-setup-step ${done ? 'done' : ''}`} onClick={onClick}>
      <span style={{ display:'flex', alignItems:'center', gap:7, fontSize:10, fontWeight:800 }}>{done ? <Check size={13}/> : <ChevronRight size={13}/>} {label}</span>
    </button>
  );
}

function mount() {
  if (document.getElementById('mf-profile-onboarding-root')) return;
  const host = document.createElement('div');
  host.id = 'mf-profile-onboarding-root';
  document.body.appendChild(host);
  createRoot(host).render(<ProfileOnboarding/>);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once:true });
else mount();

export {};
