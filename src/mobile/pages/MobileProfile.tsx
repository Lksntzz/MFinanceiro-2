import React, { useEffect, useMemo, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import {
  ArrowLeft,
  CheckCircle2,
  Loader2,
  LogOut,
  Monitor,
  Save,
  ShieldCheck,
  Smartphone,
  UserRound,
  Wrench,
} from 'lucide-react';
import { useNavigate } from 'react-router';

import { supabase } from '../../lib/supabase';
import {
  broadcastMaintenanceConfig,
  fetchMaintenanceConfig,
  type MaintenanceConfig,
  type MaintenanceScope,
} from '../../lib/maintenance';
import type { UserSettings } from '../../types';
import './mobile-profile.css';

const DEFAULT_MESSAGE = 'Estamos realizando melhorias importantes. O MF Financeiro estará disponível novamente em breve.';

type Props = {
  user: User;
  settings: UserSettings | null;
  onProfileSaved: () => Promise<void> | void;
};

type MfaState = {
  currentLevel: 'aal1' | 'aal2' | null;
  nextLevel: 'aal1' | 'aal2' | null;
};

function isAdminUser(user: User) {
  const role = String(user.app_metadata?.role || '').toLowerCase();
  return role === 'admin' || role === 'owner';
}

function initials(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'MF';
}

export default function MobileProfile({ user, settings, onProfileSaved }: Props) {
  const navigate = useNavigate();
  const admin = isAdminUser(user);
  const fallbackName = String(user.user_metadata?.full_name || user.email?.split('@')[0] || 'Usuário');
  const [displayName, setDisplayName] = useState(settings?.display_name || fallbackName);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileFeedback, setProfileFeedback] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);

  const [maintenance, setMaintenance] = useState<MaintenanceConfig | null>(null);
  const [scope, setScope] = useState<MaintenanceScope>('mobile');
  const [message, setMessage] = useState(DEFAULT_MESSAGE);
  const [maintenanceLoading, setMaintenanceLoading] = useState(admin);
  const [maintenanceSaving, setMaintenanceSaving] = useState(false);
  const [maintenanceFeedback, setMaintenanceFeedback] = useState<string | null>(null);
  const [maintenanceError, setMaintenanceError] = useState<string | null>(null);
  const [mfa, setMfa] = useState<MfaState>({ currentLevel: null, nextLevel: null });

  const avatar = String(settings?.avatar_url || user.user_metadata?.avatar_url || '').trim();
  const roleLabel = admin ? 'Administrador' : 'Usuário';

  const currentScopeMessage = useMemo(() => {
    if (!maintenance) return DEFAULT_MESSAGE;
    if (scope === 'mobile') return maintenance.mobile_message;
    if (scope === 'desktop') return maintenance.desktop_message;
    return maintenance.mobile_message === maintenance.desktop_message
      ? maintenance.mobile_message
      : DEFAULT_MESSAGE;
  }, [maintenance, scope]);

  useEffect(() => {
    if (!admin) return;
    let active = true;

    const load = async () => {
      setMaintenanceLoading(true);
      try {
        const [next, assurance] = await Promise.all([
          fetchMaintenanceConfig(supabase),
          supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
        ]);
        if (!active) return;
        setMaintenance(next);
        setMessage(next.mobile_message || DEFAULT_MESSAGE);
        if (!assurance.error) {
          setMfa({
            currentLevel: assurance.data.currentLevel ?? null,
            nextLevel: assurance.data.nextLevel ?? null,
          });
        }
      } catch (error: any) {
        if (active) setMaintenanceError(String(error?.message || 'Não foi possível carregar a manutenção.'));
      } finally {
        if (active) setMaintenanceLoading(false);
      }
    };

    void load();
    return () => { active = false; };
  }, [admin]);

  useEffect(() => {
    setMessage(currentScopeMessage || DEFAULT_MESSAGE);
  }, [currentScopeMessage]);

  async function saveProfile(event: React.FormEvent) {
    event.preventDefault();
    const normalized = displayName.trim();
    if (normalized.length < 2) {
      setProfileError('Informe um nome com pelo menos 2 caracteres.');
      return;
    }

    setSavingProfile(true);
    setProfileError(null);
    setProfileFeedback(null);
    try {
      const { error } = await supabase
        .from('mf_user_settings')
        .update({ display_name: normalized, updated_at: new Date().toISOString() })
        .eq('user_id', user.id);
      if (error) throw error;
      await onProfileSaved();
      setProfileFeedback('Perfil atualizado.');
    } catch (error: any) {
      setProfileError(String(error?.message || 'Não foi possível atualizar o perfil.'));
    } finally {
      setSavingProfile(false);
    }
  }

  function requireStrongSession() {
    if (mfa.nextLevel === 'aal2' && mfa.currentLevel !== 'aal2') {
      setMaintenanceError('Confirme o segundo fator da sessão administrativa antes de alterar a manutenção.');
      return false;
    }
    return true;
  }

  async function setMaintenanceMode(enabled: boolean) {
    if (!admin || maintenanceSaving || !requireStrongSession()) return;
    const normalizedMessage = message.trim() || DEFAULT_MESSAGE;
    if (enabled && normalizedMessage.length < 10) {
      setMaintenanceError('Digite uma mensagem com pelo menos 10 caracteres.');
      return;
    }

    setMaintenanceSaving(true);
    setMaintenanceError(null);
    setMaintenanceFeedback(null);
    try {
      const { error } = await supabase.rpc('mf_set_maintenance_scope', {
        p_scope: scope,
        p_enabled: enabled,
        p_message: normalizedMessage,
      });
      if (error) throw error;

      const next = await fetchMaintenanceConfig(supabase);
      setMaintenance(next);
      window.dispatchEvent(new CustomEvent('mf:maintenance-changed', { detail: next }));
      void broadcastMaintenanceConfig(supabase, next).catch(() => {});
      const scopeLabel = scope === 'both' ? 'mobile + desktop' : scope;
      setMaintenanceFeedback(enabled ? `Manutenção ativada: ${scopeLabel}.` : `Manutenção desativada: ${scopeLabel}.`);
    } catch (error: any) {
      const text = String(error?.message || 'Não foi possível alterar a manutenção.');
      setMaintenanceError(text.includes('mf_set_maintenance_scope')
        ? 'O backend de manutenção por escopo ainda não foi liberado. Esta branch continua fora de produção.'
        : text);
    } finally {
      setMaintenanceSaving(false);
    }
  }

  async function signOut() {
    await supabase.auth.signOut({ scope: 'local' });
    window.location.assign('/');
  }

  return (
    <div className="mf-mobile-profile">
      <header className="mf-mobile-profile__header">
        <button type="button" className="mf-mobile-profile__back" onClick={() => navigate(-1)} aria-label="Voltar"><ArrowLeft size={20} /></button>
        <div><span>MF Financeiro</span><h1>Perfil</h1></div>
      </header>

      <section className="mf-mobile-profile__identity">
        <div className="mf-mobile-profile__avatar">
          {avatar ? <img src={avatar} alt="" /> : <span>{initials(displayName)}</span>}
        </div>
        <div><strong>{displayName || fallbackName}</strong><span>{user.email}</span><small>{roleLabel}</small></div>
      </section>

      <form className="mf-mobile-profile__card" onSubmit={saveProfile}>
        <div className="mf-mobile-profile__section-title"><UserRound size={18} /><div><strong>Dados do perfil</strong><span>Informações usadas no MF Mobile</span></div></div>
        <label><span>Nome exibido</span><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={80} /></label>
        <label><span>E-mail</span><input value={user.email || ''} readOnly /></label>
        {profileFeedback ? <p className="mf-mobile-profile__feedback" data-tone="success">{profileFeedback}</p> : null}
        {profileError ? <p className="mf-mobile-profile__feedback" data-tone="danger">{profileError}</p> : null}
        <button className="mf-mobile-profile__primary" type="submit" disabled={savingProfile}>{savingProfile ? <Loader2 className="animate-spin" size={17} /> : <Save size={17} />} Salvar perfil</button>
      </form>

      {admin ? (
        <section className="mf-mobile-profile__card mf-mobile-profile__maintenance">
          <div className="mf-mobile-profile__section-title"><Wrench size={18} /><div><strong>Manutenção</strong><span>Escolha exatamente qual experiência será bloqueada</span></div></div>

          <div className="mf-mobile-profile__status-grid">
            <div data-active={maintenance?.mobile_mode ? 'true' : 'false'}><Smartphone size={17} /><span>Mobile</span><b>{maintenance?.mobile_mode ? 'Em manutenção' : 'Disponível'}</b></div>
            <div data-active={maintenance?.desktop_mode ? 'true' : 'false'}><Monitor size={17} /><span>Desktop</span><b>{maintenance?.desktop_mode ? 'Em manutenção' : 'Disponível'}</b></div>
          </div>

          <div className="mf-mobile-profile__scope" role="group" aria-label="Escopo da manutenção">
            <button type="button" data-active={scope === 'mobile'} onClick={() => setScope('mobile')}><Smartphone size={16} /> Só mobile</button>
            <button type="button" data-active={scope === 'desktop'} onClick={() => setScope('desktop')}><Monitor size={16} /> Só desktop</button>
            <button type="button" data-active={scope === 'both'} onClick={() => setScope('both')}><ShieldCheck size={16} /> Os dois</button>
          </div>

          <label><span>Mensagem de manutenção</span><textarea value={message} onChange={(event) => setMessage(event.target.value)} rows={4} maxLength={240} /></label>
          <p className="mf-mobile-profile__maintenance-note">“Só mobile” não bloqueia o PC. “Só desktop” não bloqueia celulares. “Os dois” bloqueia as duas experiências para usuários comuns; administradores mantêm acesso.</p>

          {maintenanceLoading ? <p className="mf-mobile-profile__loading"><Loader2 className="animate-spin" size={15} /> Carregando manutenção...</p> : null}
          {maintenanceFeedback ? <p className="mf-mobile-profile__feedback" data-tone="success">{maintenanceFeedback}</p> : null}
          {maintenanceError ? <p className="mf-mobile-profile__feedback" data-tone="danger">{maintenanceError}</p> : null}

          <div className="mf-mobile-profile__maintenance-actions">
            <button type="button" className="mf-mobile-profile__warning" disabled={maintenanceLoading || maintenanceSaving} onClick={() => void setMaintenanceMode(true)}>{maintenanceSaving ? <Loader2 className="animate-spin" size={17} /> : <Wrench size={17} />} Ativar manutenção</button>
            <button type="button" className="mf-mobile-profile__secondary" disabled={maintenanceLoading || maintenanceSaving} onClick={() => void setMaintenanceMode(false)}><CheckCircle2 size={17} /> Desativar no escopo</button>
          </div>
        </section>
      ) : null}

      <button type="button" className="mf-mobile-profile__logout" onClick={() => void signOut()}><LogOut size={18} /> Sair da conta</button>
    </div>
  );
}
