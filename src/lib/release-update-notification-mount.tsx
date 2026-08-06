import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import {
  BellRing,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Sparkles,
} from 'lucide-react';
import { supabase } from './supabase';

const RELEASE_ID = 'mf-update-2026-08-06';

const UPDATE_ITEMS = [
  {
    title: 'Navegação mais simples',
    description: 'As ferramentas agora estão organizadas em Início, Movimentações, Contas, Cartões, Renda e Análises.',
  },
  {
    title: 'Central de lançamentos',
    description: 'Registre entradas e saídas com categoria, descrição, forma de pagamento, cartão, parcelas, vencimento e situação.',
  },
  {
    title: 'Contas fixas mensais',
    description: 'Contas recorrentes passam a gerar os próximos meses automaticamente, com valor e vencimento editáveis em cada mês.',
  },
  {
    title: 'Renda e holerites organizados',
    description: 'Holerites ficam separados por mês, com Proventos, Descontos e Benefícios em grupos fáceis de consultar e editar.',
  },
  {
    title: 'Ciclo quinzenal inteligente',
    description: 'As prioridades são organizadas automaticamente entre os ciclos dos dias 5 a 20 e 20 a 5 do mês seguinte.',
  },
  {
    title: 'Insights financeiros renovados',
    description: 'A análise agora abre diretamente e reúne projeção, prioridades do ciclo, comportamento de gastos e cenário até o próximo pagamento.',
  },
  {
    title: 'Perfil e tutorial inicial',
    description: 'Personalize nome e foto do espaço financeiro e acompanhe um guia rápido para configurar os primeiros registros.',
  },
  {
    title: 'Mais consistência nos dados',
    description: 'Exclusões, pagamentos, saldo, gastos do dia e últimos lançamentos agora permanecem sincronizados, sem registros órfãos.',
  },
] as const;

function readKey(userId: string | null) {
  return `${RELEASE_ID}:${userId || 'anonymous'}`;
}

function ReleaseUpdateNotice() {
  const [userId, setUserId] = useState<string | null>(null);
  const [isRead, setIsRead] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [bellButton, setBellButton] = useState<HTMLElement | null>(null);
  const [panelHost, setPanelHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    let active = true;

    supabase.auth.getUser().then(({ data }) => {
      if (active) setUserId(data.user?.id || null);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user?.id || null);
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const stored = window.localStorage.getItem(readKey(userId)) === 'read';
    setIsRead(stored);
    setExpanded(!stored);
  }, [userId]);

  useEffect(() => {
    const syncTargets = () => {
      const button = document.querySelector<HTMLElement>('button[title="Notificações"]');
      if (button) {
        button.style.position = 'relative';
        setBellButton(button);
      }

      const panel = document.querySelector<HTMLElement>('aside[aria-label="Central de alertas financeiros"]');
      if (!panel) {
        setPanelHost(null);
        return;
      }

      const scrollArea = panel.querySelector<HTMLElement>('.flex-1.overflow-y-auto');
      if (!scrollArea) return;

      let host = scrollArea.querySelector<HTMLElement>('#mf-release-update-notice-host');
      if (!host) {
        host = document.createElement('div');
        host.id = 'mf-release-update-notice-host';
        host.style.marginBottom = '20px';
        scrollArea.prepend(host);
      }
      setPanelHost(host);
    };

    syncTargets();
    const observer = new MutationObserver(syncTargets);
    observer.observe(document.body, { subtree: true, childList: true });
    const timer = window.setInterval(syncTargets, 500);

    return () => {
      observer.disconnect();
      window.clearInterval(timer);
    };
  }, []);

  const subtitle = useMemo(
    () => `${UPDATE_ITEMS.length} melhorias disponíveis nesta versão`,
    [],
  );

  function markAsRead() {
    window.localStorage.setItem(readKey(userId), 'read');
    setIsRead(true);
    setExpanded(false);
  }

  const badge = bellButton && !isRead
    ? createPortal(
        <span
          aria-label="Nova atualização disponível"
          title="Nova atualização disponível"
          style={{
            position: 'absolute',
            right: '-2px',
            bottom: '-2px',
            width: '10px',
            height: '10px',
            borderRadius: '999px',
            background: '#a855f7',
            border: '2px solid #080808',
            boxShadow: '0 0 12px rgba(168,85,247,.8)',
            pointerEvents: 'none',
            zIndex: 4,
          }}
        />,
        bellButton,
      )
    : null;

  const notice = panelHost
    ? createPortal(
        <section className="rounded-2xl border border-purple-400/25 bg-gradient-to-br from-purple-500/15 via-white/[0.04] to-brand-primary/10 overflow-hidden shadow-lg shadow-purple-950/20">
          <div className="p-4">
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 shrink-0 rounded-xl bg-purple-500/20 text-purple-300 flex items-center justify-center">
                <Sparkles size={20} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-black text-white">Novidades da atualização</h3>
                  {!isRead && (
                    <span className="rounded-full border border-purple-300/30 bg-purple-400/15 px-2 py-0.5 text-[8px] font-black uppercase tracking-wider text-purple-200">
                      Novo
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[10px] text-white/50">6 de agosto de 2026 · {subtitle}</p>
              </div>
              <button
                type="button"
                onClick={() => setExpanded((value) => !value)}
                className="rounded-lg p-2 text-white/50 transition-colors hover:bg-white/10 hover:text-white"
                aria-label={expanded ? 'Recolher novidades' : 'Abrir novidades'}
              >
                {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>
            </div>

            {expanded && (
              <div className="mt-4 space-y-3">
                <p className="text-xs leading-relaxed text-white/70">
                  O MF Financeiro ficou mais organizado, previsível e fácil de usar. Confira o que mudou:
                </p>

                <div className="space-y-2.5">
                  {UPDATE_ITEMS.map((item) => (
                    <div key={item.title} className="flex items-start gap-2.5 rounded-xl border border-white/[0.06] bg-black/15 p-3">
                      <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-brand-primary" />
                      <div>
                        <h4 className="text-[11px] font-bold text-white/90">{item.title}</h4>
                        <p className="mt-0.5 text-[10px] leading-relaxed text-white/50">{item.description}</p>
                      </div>
                    </div>
                  ))}
                </div>

                {!isRead ? (
                  <button
                    type="button"
                    onClick={markAsRead}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-purple-500 px-3 py-2.5 text-[10px] font-black uppercase tracking-wider text-white transition-colors hover:bg-purple-400"
                  >
                    <CheckCircle2 size={14} /> Entendi as novidades
                  </button>
                ) : (
                  <div className="flex items-center justify-center gap-2 rounded-xl border border-green-400/15 bg-green-400/[0.06] px-3 py-2 text-[10px] font-bold text-green-300">
                    <CheckCircle2 size={13} /> Atualização visualizada
                  </div>
                )}
              </div>
            )}

            {!expanded && (
              <button
                type="button"
                onClick={() => setExpanded(true)}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-[10px] font-bold text-white/60 hover:bg-white/[0.07] hover:text-white"
              >
                <BellRing size={13} /> Ver lista de novidades
              </button>
            )}
          </div>
        </section>,
        panelHost,
      )
    : null;

  return <>{badge}{notice}</>;
}

function mount() {
  if (document.getElementById('mf-release-update-notification-app')) return;
  const host = document.createElement('div');
  host.id = 'mf-release-update-notification-app';
  document.body.appendChild(host);
  createRoot(host).render(<ReleaseUpdateNotice />);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount, { once: true });
} else {
  mount();
}

export {};
