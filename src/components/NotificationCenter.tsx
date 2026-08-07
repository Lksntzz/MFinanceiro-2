import React, { useMemo, useState } from 'react';
import { Bell, X, CheckCircle2, AlertCircle, Clock, Calendar, Wallet } from 'lucide-react';
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

  const normalizedNotifications = useMemo(
    () => notifications.map(normalizeNotification).sort((a, b) => a.daysUntilDue - b.daysUntilDue),
    [notifications],
  );

  const overdue = normalizedNotifications.filter((item) => item.status === 'overdue');
  const dueToday = normalizedNotifications.filter((item) => item.status === 'due_today');
  const upcoming = normalizedNotifications.filter((item) => item.status === 'pending');

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
              aria-label="Central de alertas financeiros"
            >
              <div className="p-6 border-b border-white/10 flex items-center justify-between bg-white/5">
                <div className="flex items-center gap-3">
                  <Bell className="text-brand-primary" size={20} />
                  <div>
                    <h2 className="font-bold text-lg">Central de Alertas</h2>
                    <p className="text-[10px] text-white/40 uppercase tracking-wider">
                      {normalizedNotifications.length} compromisso{normalizedNotifications.length === 1 ? '' : 's'} pendente{normalizedNotifications.length === 1 ? '' : 's'}
                    </p>
                  </div>
                </div>
                <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg transition-colors" aria-label="Fechar alertas">
                  <X size={20} className="text-white/40" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 no-scrollbar space-y-6">
                {normalizedNotifications.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center p-8 opacity-50">
                    <CheckCircle2 size={48} className="mb-4 text-green-500" />
                    <p className="font-bold uppercase tracking-widest text-xs">Tudo em dia!</p>
                    <p className="text-xs mt-2">Nenhuma conta pendente cadastrada.</p>
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
                    Os alertas usam o dia de vencimento das contas fixas cadastradas. Ao baixar um pagamento, o lançamento é registrado e o saldo é atualizado.
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
