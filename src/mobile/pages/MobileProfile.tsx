import type { User } from '@supabase/supabase-js';
import { ArrowLeft, Loader2, LogOut, Save, UserRound } from 'lucide-react';
import type React from 'react';
import { useState } from 'react';
import { useNavigate } from 'react-router';

import { supabase } from '../../lib/supabase';
import type { UserSettings } from '../../types';
import './mobile-profile.css';

type Props = {
  user: User;
  settings: UserSettings | null;
  onProfileSaved: () => Promise<void> | void;
};

function isAdminUser(user: User) {
  const role = String(user.app_metadata?.role || '').toLowerCase();
  return role === 'admin' || role === 'owner';
}

function initials(value: string) {
  return (
    value
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || 'MF'
  );
}

export default function MobileProfile({
  user,
  settings,
  onProfileSaved,
}: Props) {
  const navigate = useNavigate();
  const admin = isAdminUser(user);
  const fallbackName = String(
    user.user_metadata?.full_name || user.email?.split('@')[0] || 'Usuário',
  );
  const [displayName, setDisplayName] = useState(
    settings?.display_name || fallbackName,
  );
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileFeedback, setProfileFeedback] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);

  const avatar = String(
    settings?.avatar_url || user.user_metadata?.avatar_url || '',
  ).trim();
  const roleLabel = admin ? 'Administrador' : 'Usuário';

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
        .update({
          display_name: normalized,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', user.id);
      if (error) throw error;
      await onProfileSaved();
      setProfileFeedback('Perfil atualizado.');
    } catch (error: any) {
      setProfileError(
        String(error?.message || 'Não foi possível atualizar o perfil.'),
      );
    } finally {
      setSavingProfile(false);
    }
  }

  async function signOut() {
    await supabase.auth.signOut({ scope: 'local' });
    window.location.assign('/');
  }

  return (
    <div className="mf-mobile-profile">
      <header className="mf-mobile-profile__header">
        <button
          type="button"
          className="mf-mobile-profile__back"
          onClick={() => navigate(-1)}
          aria-label="Voltar"
        >
          <ArrowLeft size={20} />
        </button>
        <div>
          <span>MF Financeiro</span>
          <h1>Perfil</h1>
        </div>
      </header>

      <section className="mf-mobile-profile__identity">
        <div className="mf-mobile-profile__avatar">
          {avatar ? (
            <img src={avatar} alt="" />
          ) : (
            <span>{initials(displayName)}</span>
          )}
        </div>
        <div>
          <strong>{displayName || fallbackName}</strong>
          <span>{user.email}</span>
          <small>{roleLabel}</small>
        </div>
      </section>

      <form className="mf-mobile-profile__card" onSubmit={saveProfile}>
        <div className="mf-mobile-profile__section-title">
          <UserRound size={18} />
          <div>
            <strong>Dados do perfil</strong>
            <span>Informações usadas no MF Mobile</span>
          </div>
        </div>
        <label>
          <span>Nome exibido</span>
          <input
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            maxLength={80}
          />
        </label>
        <label>
          <span>E-mail</span>
          <input value={user.email || ''} readOnly />
        </label>
        {profileFeedback ? (
          <p className="mf-mobile-profile__feedback" data-tone="success">
            {profileFeedback}
          </p>
        ) : null}
        {profileError ? (
          <p className="mf-mobile-profile__feedback" data-tone="danger">
            {profileError}
          </p>
        ) : null}
        <button
          className="mf-mobile-profile__primary"
          type="submit"
          disabled={savingProfile}
        >
          {savingProfile ? (
            <Loader2 className="animate-spin" size={17} />
          ) : (
            <Save size={17} />
          )}{' '}
          Salvar perfil
        </button>
      </form>

      <button
        type="button"
        className="mf-mobile-profile__logout"
        onClick={() => void signOut()}
      >
        <LogOut size={18} /> Sair da conta
      </button>
    </div>
  );
}
