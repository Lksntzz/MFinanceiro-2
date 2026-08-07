import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Check, CheckCircle2, Sparkles, X } from 'lucide-react';
import { supabase } from './supabase';

const MEGA_UPDATE = {
  id: '2026-08-07-mega-update-production',
  title: 'Mega Update disponível',
  dateLabel: '7 de agosto de 2026',
  summary: 'Uma nova etapa do MF Financeiro chegou com Open Finance, análises mais completas e melhorias importantes em importação, investimentos e automações.',
  highlights: [
    'Open Finance integrado para conectar contas, sincronizar dados e receber atualizações com mais segurança.',
    'Análises, Insights e Saúde Financeira agora consolidam o histórico completo do ledger, sem depender apenas dos lançamentos recentes.',
    'Importação de extratos ganhou resultado detalhado de inseridos, duplicados, rejeitados e ignorados, além de melhorias no OCR e na revisão.',
    'Investimentos evoluíram para uma área mais isolada e organizada dentro do planejamento financeiro.',
    'Central de automações recebeu novos fluxos para reduzir tarefas manuais e organizar rotinas financeiras.',
    'Navegação e acessibilidade foram refinadas para melhorar foco, leitura, atalhos e uso em diferentes telas.',
    'A Central de lançamentos detalhada foi restaurada e continua disponível pelo botão Lançar.',
  ],
} as const;

const READ_KEY = `mf-release-read:${MEGA_UPDATE.id}`;

function isRead() {
  try {
    return window.localStorage.getItem(READ_KEY) === '1';
  } catch {
    return false;
  }
}

function MegaUpdateAnnouncement() {
  const [visible, setVisible] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  useEffect(() => {
    let active = true;

    void supabase.auth.getUser().then(({ data }) => {
      if (!active) return;
      setVisible(Boolean(data.user) && !isRead());
    }).catch(() => {});

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setVisible(Boolean(session?.user) && !isRead());
      if (!session?.user) setDetailsOpen(false);
    });

    return () => {
      active = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  function markRead() {
    try {
      window.localStorage.setItem(READ_KEY, '1');
    } catch {
      // The announcement can still be dismissed when storage is unavailable.
    }
    setDetailsOpen(false);
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <>
      <aside
        className="fixed bottom-4 right-4 z-[95] w-[min(410px,calc(100vw-32px))] rounded-2xl border border-violet-400/25 bg-[#080c16]/95 p-4 shadow-2xl backdrop-blur-xl"
        role="status"
        aria-label="Mega Update do MF Financeiro"
      >
        <div className="flex items-start gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-violet-500/15 text-violet-300">
            <Sparkles size={20} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[9px] font-black uppercase tracking-[0.22em] text-violet-300">Nova versão</p>
                <h2 className="mt-1 text-sm font-black text-white">{MEGA_UPDATE.title}</h2>
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
            <p className="mt-2 text-xs leading-relaxed text-white/55">{MEGA_UPDATE.summary}</p>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <span className="text-[9px] font-bold uppercase tracking-wider text-white/30">{MEGA_UPDATE.dateLabel}</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setDetailsOpen(true)}
                  className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-[9px] font-black uppercase tracking-wider text-white/70 transition hover:bg-white/10"
                >
                  Ver novidades
                </button>
                <button
                  type="button"
                  onClick={markRead}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-violet-400/25 bg-violet-500/10 px-3 py-1.5 text-[9px] font-black uppercase tracking-wider text-violet-200 transition hover:bg-violet-500/20"
                >
                  <Check size={12} /> Lido
                </button>
              </div>
            </div>
          </div>
        </div>
      </aside>

      {detailsOpen && (
        <div className="fixed inset-0 z-[110] grid place-items-center bg-black/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="mf-mega-update-title">
          <section className="max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-3xl border border-violet-400/20 bg-[#090d17] shadow-2xl">
            <header className="flex items-start justify-between gap-4 border-b border-white/10 p-5">
              <div>
                <p className="text-[9px] font-black uppercase tracking-[0.22em] text-violet-300">MF Financeiro · Mega Update</p>
                <h2 id="mf-mega-update-title" className="mt-1 text-xl font-black text-white">{MEGA_UPDATE.title}</h2>
                <p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-white/30">{MEGA_UPDATE.dateLabel}</p>
              </div>
              <button type="button" onClick={() => setDetailsOpen(false)} className="rounded-xl p-2 text-white/40 hover:bg-white/10 hover:text-white" aria-label="Fechar novidades">
                <X size={18} />
              </button>
            </header>

            <div className="p-5">
              <p className="text-sm leading-relaxed text-white/60">{MEGA_UPDATE.summary}</p>
              <div className="mt-5 space-y-3">
                {MEGA_UPDATE.highlights.map((highlight) => (
                  <div key={highlight} className="flex items-start gap-3 rounded-xl border border-white/8 bg-white/[0.025] p-3 text-xs leading-relaxed text-white/65">
                    <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-cyan-300" />
                    <span>{highlight}</span>
                  </div>
                ))}
              </div>
            </div>

            <footer className="border-t border-white/10 p-4">
              <button type="button" onClick={markRead} className="flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-3 text-xs font-black uppercase tracking-wider text-white transition hover:bg-violet-500">
                <Check size={14} /> Marcar atualização como lida
              </button>
            </footer>
          </section>
        </div>
      )}
    </>
  );
}

if (typeof document !== 'undefined' && !document.getElementById('mf-mega-update-announcement-root')) {
  const rootElement = document.createElement('div');
  rootElement.id = 'mf-mega-update-announcement-root';
  document.body.appendChild(rootElement);
  createRoot(rootElement).render(<MegaUpdateAnnouncement />);
}
