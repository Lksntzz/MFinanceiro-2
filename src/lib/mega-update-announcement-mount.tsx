import { Check, CheckCircle2, Sparkles, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { LATEST_WEB_UPDATE, releaseReadKey } from './release-updates';
import { supabase } from './supabase';
import {
  loadUserPreferences,
  subscribeUserPreferences,
} from './user-preferences';

const WEB_UPDATE = LATEST_WEB_UPDATE;
const READ_KEY = releaseReadKey(WEB_UPDATE);
const WEB_MEDIA_QUERY = '(min-width: 821px)';
function isRead() {
  try {
    return window.localStorage.getItem(READ_KEY) === '1';
  } catch {
    return false;
  }
}
function isWebExperience() {
  return (
    typeof window !== 'undefined' && window.matchMedia(WEB_MEDIA_QUERY).matches
  );
}

export default function WebUpdateAnnouncement() {
  const [visible, setVisible] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  useEffect(() => {
    let active = true;
    let unsubscribePreferences = () => undefined;
    const media = window.matchMedia(WEB_MEDIA_QUERY);

    const applyForUser = (userId?: string | null) => {
      unsubscribePreferences();
      unsubscribePreferences = () => undefined;
      if (!active || !media.matches || !userId) {
        setVisible(false);
        setDetailsOpen(false);
        return;
      }
      const refreshFromPreferences = () => {
        const enabled = loadUserPreferences(userId).notifications.release;
        setVisible(enabled && !isRead());
        if (!enabled) setDetailsOpen(false);
      };
      refreshFromPreferences();
      unsubscribePreferences = subscribeUserPreferences(
        userId,
        refreshFromPreferences,
      );
    };

    const refreshVisibility = async () => {
      if (!media.matches) {
        applyForUser(null);
        return;
      }
      try {
        const { data } = await supabase.auth.getUser();
        if (active) applyForUser(data.user?.id);
      } catch {
        if (active) applyForUser(null);
      }
    };

    void refreshVisibility();
    const handleMediaChange = () => void refreshVisibility();
    media.addEventListener('change', handleMediaChange);
    const { data: authListener } = supabase.auth.onAuthStateChange(
      (_event, session) => applyForUser(session?.user?.id),
    );
    return () => {
      active = false;
      unsubscribePreferences();
      media.removeEventListener('change', handleMediaChange);
      authListener.subscription.unsubscribe();
    };
  }, []);

  function markRead() {
    try {
      window.localStorage.setItem(READ_KEY, '1');
    } catch {
      /* optional */
    }
    setDetailsOpen(false);
    setVisible(false);
  }
  if (!visible || !isWebExperience()) return null;

  return (
    <>
      <aside
        className="fixed bottom-5 right-5 z-[95] w-[min(390px,calc(100vw-40px))] rounded-2xl border border-violet-400/20 bg-[#080c16]/96 p-4 shadow-2xl backdrop-blur-xl"
        role="status"
        aria-label="Atualização do MF Financeiro"
      >
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-500/15 text-violet-300">
            <Sparkles size={19} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[9px] font-black uppercase tracking-[0.2em] text-violet-300">
                  Atualização do MF
                </p>
                <h2 className="mt-1 text-sm font-black text-white">
                  {WEB_UPDATE.title}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setVisible(false)}
                className="rounded-lg p-1.5 text-white/35 transition hover:bg-white/10 hover:text-white"
                aria-label="Fechar comunicado"
              >
                <X size={16} />
              </button>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-white/55">
              {WEB_UPDATE.summary}
            </p>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <span className="text-[9px] font-bold uppercase tracking-wider text-white/30">
                {WEB_UPDATE.dateLabel}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setDetailsOpen(true)}
                  className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-[9px] font-black uppercase tracking-wider text-white/70 transition hover:bg-white/10"
                >
                  Ver melhorias
                </button>
                <button
                  type="button"
                  onClick={markRead}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-violet-400/20 bg-violet-500/10 px-3 py-1.5 text-[9px] font-black uppercase tracking-wider text-violet-200 transition hover:bg-violet-500/20"
                >
                  <Check size={12} /> Entendi
                </button>
              </div>
            </div>
          </div>
        </div>
      </aside>
      {detailsOpen && (
        <div
          className="fixed inset-0 z-[110] grid place-items-center bg-black/70 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="mf-web-update-title"
        >
          <section className="w-full max-w-lg overflow-hidden rounded-3xl border border-violet-400/20 bg-[#090d17] shadow-2xl">
            <header className="flex items-start justify-between gap-4 border-b border-white/10 p-5">
              <div>
                <p className="text-[9px] font-black uppercase tracking-[0.2em] text-violet-300">
                  Atualização do MF Financeiro
                </p>
                <h2
                  id="mf-web-update-title"
                  className="mt-1 text-xl font-black text-white"
                >
                  {WEB_UPDATE.title}
                </h2>
                <p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-white/30">
                  {WEB_UPDATE.dateLabel}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDetailsOpen(false)}
                className="rounded-xl p-2 text-white/40 hover:bg-white/10 hover:text-white"
                aria-label="Fechar melhorias"
              >
                <X size={18} />
              </button>
            </header>
            <div className="p-5">
              <p className="text-sm leading-relaxed text-white/60">
                {WEB_UPDATE.summary}
              </p>
              <div className="mt-5 space-y-3">
                {WEB_UPDATE.highlights.map((highlight) => (
                  <div
                    key={highlight}
                    className="flex items-start gap-3 rounded-xl border border-white/8 bg-white/[0.025] p-3 text-xs leading-relaxed text-white/65"
                  >
                    <CheckCircle2
                      size={15}
                      className="mt-0.5 shrink-0 text-cyan-300"
                    />
                    <span>{highlight}</span>
                  </div>
                ))}
              </div>
            </div>
            <footer className="border-t border-white/10 p-4">
              <button
                type="button"
                onClick={markRead}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-3 text-xs font-black uppercase tracking-wider text-white transition hover:bg-violet-500"
              >
                <Check size={14} /> Entendi a atualização
              </button>
            </footer>
          </section>
        </div>
      )}
    </>
  );
}
