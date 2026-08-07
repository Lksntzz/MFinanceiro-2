import React, { useEffect, useMemo, useState } from 'react';
import { Bell, X, CheckCircle2, AlertCircle, Clock, Calendar, Wallet, Sparkles, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface NotificationItem {
  id: string;
  type: 'fixed' | 'installment' | 'card' | 'daily';
  title: string;
  amount: number;
  dueDate?: number;
  status?: 'pending' | 'due_today' | 'overdue';
  originalData: any;
}

interface NormalizedNotification extends NotificationItem {
  dueDate: number;
  status: 'pending' | 'due_today' | 'overdue';
  dueDateLabel: string;
  daysUntilDue: number;
}

interface NotificationCenterProps {
  notifications: NotificationItem[];
  onPay: (item: NotificationItem) => void | Promise<void>;
  onDismiss: (id: string) => void;
  onClose: () => void;
  isOpen: boolean;
}

const RELEASE_UPDATE = {
  id: '2026-08-07-mega-update',
  title: 'Novidades da atualização',
  dateLabel: '7 de agosto de 2026',
  summary: 'O MF Financeiro recebeu melhorias importantes de acesso, identidade e importação de extratos.',
  highlights: [
    'Nova identidade visual e logo oficial aplicada ao sistema.',
    'Entrada com e-mail e GitHub disponível na tela de acesso.',
    'Fluxo de aprovação, criação de senha e confirmação de e-mail refinado.',
    'Importação de extratos corrigida para salvar datas ISO corretamente e evitar falso sucesso.',
    'Navegação e área Minha conta organizadas para reduzir ações duplicadas.',
  ],
} as const;

const RELEASE_READ_KEY = `mf-release-read:${RELEASE_UPDATE.id}`;

function readReleaseState() {
  try {
    return window.localStorage.getItem(RELEASE_READ_KEY) === '1';
  } catch {
    return false;
  }
}

function clampDueDay(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(31, Math.max(1, Math.trunc(parsed)));
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function resolveDueDate(dueDay: number, reference = new Date()): Date {
  const lastDay = new Date(reference.getFullYear(), reference.getMonth() + 1, 0).getDate();
  return new Date(reference.getFullYear(), reference.getMonth(), Math.min(dueDay, lastDay));
}

function normalizeNotification(item: NotificationItem): NormalizedNotification {
  const dueDay = clampDueDay(item.dueDate ?? item.originalData?.due_day ?? item.originalData?.dueDate);
  const today = startOfLocalDay(new Date());
  const dueDate = startOfLocalDay(resolveDueDate(dueDay, today));
  const daysUntilDue = Math.round((dueDate.getTime() - today.getTime()) / 86_400_000);
  const status: NormalizedNotification['status'] =
    daysUntilDue < 0 ? 'overdue' : daysUntilDue === 0 ? 'due_today' : 'pending';

  return {
    ...item,
    dueDate: dueDay,
    status,
    daysUntilDue,
    dueDateLabel: dueDate.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
  };
}

export default function NotificationCenter({ notifications, onPay, onDismiss, onClose, isOpen }: NotificationCenterProps) {
  const [payingId, setPayingId] = useState<string | null>(null);
  const [releaseRead, setReleaseRead] = useState(readReleaseState);
  const [showReleaseToast, setShowReleaseToast] = useState(() => !readReleaseState());

  const normalizedNotifications = useMemo(
    () => notifications.map(normalizeNotification).sort((a, b) => a.daysUntilDue - b.daysUntilDue),
    [notifications],
  );

  const overdue = normalizedNotifications.filter((item) => item.status === 'overdue');
  const dueToday = normalizedNotifications.filter((item) => item.status === 'due_today');
  const upcoming = normalizedNotifications.filter((item) => item.status === 'pending');

  useEffect(() => {
    if (isOpen) setShowReleaseToast(false);
  }, [isOpen]);

  function markReleaseRead() {
    setReleaseRead(true);
    setShowReleaseToast(false);
    try {
      window.localStorage.setItem(RELEASE_READ_KEY, '1');
    } catch {
      // Reading the announcement still works when local storage is unavailable.
    }
  }

  async function handlePay(item: NormalizedNotification) {
    try {
      setPayingId(item.id);
      await onPay(item);
    } finally {
      setPayingId(null);
    }
  }

  return (
    <>
      <AnimatePresence>
        {showReleaseToast && !isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -14, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.98 }}
            transition={{ duration: 0.24 }}
            className="fixed right-4 top-4 z-[80] w-[min(390px,calc(100vw-32px))] rounded-2xl border border-violet-400/20 bg-[#0b0b10]/95 p-4 shadow-2xl backdrop-blur-xl"
            role="status"
            aria-label="Nova atualização do MF Financeiro"
          >
            <div className="flex items-start gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-500/15 text-violet-300">
                <Sparkles size={19} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-[0.22em] text-violet-300">Nova versão</p>
                    <h3 className="mt-1 text-sm font-bold text-white">{RELEASE_UPDATE.title}</h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowReleaseToast(false)}
                    className="rounded-lg p-1.5 text-white/30 transition-colors hover:bg-white/10 hover:text-white"
                    aria-label="Fechar comunicado"
                  >
                    <X size={16} />
                  </button>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-white/55">{RELEASE_UPDATE.summary}</p>
                <div className="mt-3 flex items-center justify-between gap-3">
                  <span className="text-[9px] font-bold uppercase tracking-wider text-white/25">{RELEASE_UPDATE.dateLabel}</span>
                  <button
                    type="button"
                    onClick={markReleaseRead}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-violet-400/20 bg-violet-500/10 px-3 py-1.5 text-[9px] font-black uppercase tracking-wider text-violet-200 transition-colors hover:bg-violet-500/20"
                  >
                    <Check size={12} /> Marcar como lido
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={onClose}
              className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[60]"
            />
            <motion.aside
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed top-0 right-0 h-full w-full max-w-sm bg-[#0a0a0a] border-l border-white/10 z-[70] shadow-2xl flex flex-col"
              aria-label="Central de notificações"
            >
              <div className="p-6 border-b border-white/10 flex items-center justify-between bg-white/5">
                <div className="flex items-center gap-3">
                  <Bell className="text-brand-primary" size={20} />
                  <div>
                    <h2 className="font-bold text-lg">Central de Notificações</h2>
                    <p className="text-[10px] text-white/40 uppercase tracking-wider">
                      Atualizações e {normalizedNotifications.length} compromisso{normalizedNotifications.length === 1 ? '' : 's'} financeiro{normalizedNotifications.length === 1 ? '' : 's'}
                    </p>
                  </div>
                </div>
                <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg transition-colors" aria-label="Fechar notificações">
                  <X size={20} className="text-white/40" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 no-scrollbar space-y-6">
                <ReleaseUpdateCard read={releaseRead} onMarkRead={markReleaseRead} />

                {normalizedNotifications.length === 0 ? (
                  <div className="rounded-2xl border border-white/8 bg-white/[0.025] p-6 text-center opacity-70">
                    <CheckCircle2 size={34} className="mx-auto mb-3 text-green-500" />
                    <p className="font-bold uppercase tracking-widest text-xs">Financeiro em dia</p>
                    <p className="text-xs mt-2 text-white/45">Nenhuma conta pendente cadastrada.</p>
                  </div>
                ) : (
                  <>
                    {overdue.length > 0 && (
                      <NotificationGroup title="Vencidas" icon={<AlertCircle size={12} />} className="text-red-400">
                        {overdue.map((item) => (
                          <NotificationCard key={item.id} item={item} onPay={handlePay} onDismiss={onDismiss} paying={payingId === item.id} />
                        ))}
                      </NotificationGroup>
                    )}

                    {dueToday.length > 0 && (
                      <NotificationGroup title="Vencem hoje" icon={<Clock size={12} />} className="text-brand-primary">
                        {dueToday.map((item) => (
                          <NotificationCard key={item.id} item={item} onPay={handlePay} onDismiss={onDismiss} paying={payingId === item.id} />
                        ))}
                      </NotificationGroup>
                    )}

                    {upcoming.length > 0 && (
                      <NotificationGroup title="Próximas" icon={<Calendar size={12} />} className="text-white/50">
                        {upcoming.map((item) => (
                          <NotificationCard key={item.id} item={item} onPay={handlePay} onDismiss={onDismiss} paying={payingId === item.id} />
                        ))}
                      </NotificationGroup>
                    )}
                  </>
                )}
              </div>

              <div className="p-4 border-t border-white/10 bg-white/5">
                <div className="p-3 rounded-xl bg-brand-primary/10 border border-brand-primary/20">
                  <h4 className="text-[10px] font-bold uppercase tracking-widest text-brand-primary mb-1">Como funciona</h4>
                  <p className="text-[10px] text-white/60 leading-relaxed">
                    As novidades do MF Financeiro ficam disponíveis aqui e os alertas financeiros usam o dia de vencimento das contas fixas cadastradas.
                  </p>
                </div>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

function ReleaseUpdateCard({ read, onMarkRead }: { read: boolean; onMarkRead: () => void }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-violet-400/20 bg-gradient-to-br from-violet-500/10 via-cyan-500/[0.045] to-transparent">
      <div className="border-b border-white/8 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-500/15 text-violet-300">
              <Sparkles size={19} />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[9px] font-black uppercase tracking-[0.2em] text-violet-300">Atualização do sistema</p>
                <span className={`rounded-full px-2 py-0.5 text-[8px] font-black uppercase tracking-wider ${read ? 'bg-white/8 text-white/35' : 'bg-violet-400/15 text-violet-200'}`}>
                  {read ? 'Lido' : 'Novo'}
                </span>
              </div>
              <h3 className="mt-1 text-sm font-bold text-white">{RELEASE_UPDATE.title}</h3>
              <p className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-white/30">{RELEASE_UPDATE.dateLabel}</p>
            </div>
          </div>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-white/55">{RELEASE_UPDATE.summary}</p>
      </div>

      <div className="space-y-2.5 p-4">
        {RELEASE_UPDATE.highlights.map((highlight) => (
          <div key={highlight} className="flex items-start gap-2.5 text-xs leading-relaxed text-white/60">
            <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-cyan-300" />
            <span>{highlight}</span>
          </div>
        ))}
      </div>

      {!read && (
        <div className="border-t border-white/8 p-3">
          <button
            type="button"
            onClick={onMarkRead}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-violet-400/20 bg-violet-500/10 py-2.5 text-[9px] font-black uppercase tracking-[0.16em] text-violet-200 transition-colors hover:bg-violet-500/20"
          >
            <Check size={13} /> Marcar atualização como lida
          </button>
        </div>
      )}
    </section>
  );
}

function NotificationGroup({
  title,
  icon,
  className,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  className: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h3 className={`text-[10px] font-bold uppercase tracking-widest px-2 flex items-center gap-2 ${className}`}>
        {icon} {title}
      </h3>
      {children}
    </section>
  );
}

function NotificationCard({
  item,
  onPay,
  onDismiss,
  paying,
}: {
  item: NormalizedNotification;
  onPay: (item: NormalizedNotification) => void;
  onDismiss: (id: string) => void;
  paying: boolean;
}) {
  const isOverdue = item.status === 'overdue';
  const isToday = item.status === 'due_today';

  return (
    <article className={`p-4 rounded-2xl border transition-all ${isOverdue ? 'bg-red-500/5 border-red-500/20' : isToday ? 'bg-brand-primary/5 border-brand-primary/20' : 'bg-white/5 border-white/10'}`}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className={`h-10 w-10 shrink-0 rounded-xl flex items-center justify-center ${
            item.type === 'card' ? 'bg-brand-secondary/10 text-brand-secondary' :
            item.type === 'installment' ? 'bg-brand-primary/10 text-brand-primary' :
            'bg-white/10 text-white/60'
          }`}>
            {item.type === 'card' ? <Wallet size={20} /> : item.type === 'installment' ? <Clock size={20} /> : <Calendar size={20} />}
          </div>
          <div className="min-w-0">
            <h4 className="font-bold text-sm truncate">{item.title || 'Compromisso financeiro'}</h4>
            <span className="text-[10px] text-white/40 uppercase font-bold">
              {item.type === 'fixed' ? 'Conta fixa' : item.type === 'installment' ? 'Parcelamento' : item.type === 'card' ? 'Cartão de crédito' : 'Gasto recorrente'}
            </span>
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-sm font-bold">R$ {Number(item.amount || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
          <div className={`text-[9px] font-bold uppercase ${isOverdue ? 'text-red-400' : isToday ? 'text-brand-primary' : 'text-white/40'}`}>
            {isOverdue ? `Venceu em ${item.dueDateLabel}` : isToday ? 'Vence hoje' : `Vence em ${item.dueDateLabel}`}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {item.type === 'fixed' && (
          <button
            onClick={() => onPay(item)}
            disabled={paying}
            className={`w-full py-2.5 rounded-xl text-xs font-bold uppercase tracking-widest transition-all flex items-center justify-center gap-2 disabled:opacity-50 ${
              isOverdue ? 'bg-red-500 text-white hover:bg-red-600' : 'bg-brand-primary text-black hover:bg-brand-primary/90'
            }`}
          >
            <CheckCircle2 size={14} /> {paying ? 'Registrando...' : 'Baixar pagamento'}
          </button>
        )}

        <button
          onClick={() => onDismiss(item.id)}
          className="w-full py-1 text-[9px] font-bold uppercase tracking-widest text-white/30 hover:text-white transition-colors"
        >
          Ocultar alerta
        </button>
      </div>
    </article>
  );
}
