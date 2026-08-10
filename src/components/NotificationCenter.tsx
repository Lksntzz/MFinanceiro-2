import React, { useMemo, useState } from 'react';
import { AlertCircle, Bell, Calendar, CheckCircle2, Clock, ExternalLink, Sparkles, Wallet, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

import { LATEST_WEB_UPDATE, releaseReadKey } from '../lib/release-updates';

export interface NotificationItem {
  id: string;
  type: 'fixed' | 'installment' | 'card' | 'daily' | 'quality';
  title: string;
  amount?: number;
  dueDate?: number;
  status?: 'pending' | 'due_today' | 'overdue' | 'attention';
  detail?: string;
  actionPath?: string;
  actionLabel?: string;
  originalData: any;
}

type DueNotification = NotificationItem & {
  dueDate: number;
  status: 'pending' | 'due_today' | 'overdue';
  dueDateLabel: string;
  daysUntilDue: number;
};

interface NotificationCenterProps {
  notifications: NotificationItem[];
  onPay: (item: NotificationItem) => void | Promise<void>;
  onDismiss: (id: string) => void;
  onClose: () => void;
  isOpen: boolean;
  showReleaseUpdate?: boolean;
  onNavigate?: (path: string) => void;
}

const RELEASE_DISMISSED_KEY = releaseReadKey(LATEST_WEB_UPDATE);
function readReleaseDismissed() { try { return window.localStorage.getItem(RELEASE_DISMISSED_KEY) === '1'; } catch { return false; } }
function clampDueDay(value: unknown): number { const parsed = Number(value); return Number.isFinite(parsed) ? Math.min(31, Math.max(1, Math.trunc(parsed))) : 1; }
function startOfLocalDay(date: Date): Date { return new Date(date.getFullYear(), date.getMonth(), date.getDate()); }
function resolveDueDate(dueDay: number, reference = new Date()): Date { const lastDay = new Date(reference.getFullYear(), reference.getMonth() + 1, 0).getDate(); return new Date(reference.getFullYear(), reference.getMonth(), Math.min(dueDay, lastDay)); }
function isAttention(item: NotificationItem) { return item.type === 'quality' || item.status === 'attention' || (item.type === 'card' && Boolean(item.detail)); }

function normalizeDueNotification(item: NotificationItem): DueNotification {
  const dueDay = clampDueDay(item.dueDate ?? item.originalData?.due_day ?? item.originalData?.dueDate);
  const today = startOfLocalDay(new Date());
  const dueDate = startOfLocalDay(resolveDueDate(dueDay, today));
  const daysUntilDue = Math.round((dueDate.getTime() - today.getTime()) / 86_400_000);
  const status: DueNotification['status'] = daysUntilDue < 0 ? 'overdue' : daysUntilDue === 0 ? 'due_today' : 'pending';
  return { ...item, dueDate: dueDay, status, daysUntilDue, dueDateLabel: dueDate.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) };
}

export default function NotificationCenter({ notifications, onPay, onDismiss, onClose, isOpen, showReleaseUpdate = true, onNavigate }: NotificationCenterProps) {
  const [payingId, setPayingId] = useState<string | null>(null);
  const [releaseDismissed, setReleaseDismissed] = useState(readReleaseDismissed);
  const attention = useMemo(() => notifications.filter(isAttention), [notifications]);
  const dueItems = useMemo(() => notifications.filter((item) => !isAttention(item)).map(normalizeDueNotification).sort((a, b) => a.daysUntilDue - b.daysUntilDue), [notifications]);
  const overdue = dueItems.filter((item) => item.status === 'overdue');
  const dueToday = dueItems.filter((item) => item.status === 'due_today');
  const upcoming = dueItems.filter((item) => item.status === 'pending');

  function dismissRelease() {
    setReleaseDismissed(true);
    try { window.localStorage.setItem(RELEASE_DISMISSED_KEY, '1'); } catch { /* optional */ }
  }
  async function handlePay(item: NotificationItem) { try { setPayingId(item.id); await onPay(item); } finally { setPayingId(null); } }

  return <AnimatePresence>{isOpen && <>
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm" />
    <motion.aside initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', damping: 25, stiffness: 200 }} className="fixed right-0 top-0 z-[70] flex h-full w-full max-w-sm flex-col border-l border-white/10 bg-[#0a0a0a] shadow-2xl" aria-label="Central de notificações">
      <div className="flex items-center justify-between border-b border-white/10 bg-white/5 p-6"><div className="flex items-center gap-3"><Bell className="text-brand-primary" size={20} /><div><h2 className="text-lg font-bold">Notificações</h2><p className="text-[10px] uppercase tracking-wider text-white/40">{notifications.length} atenção{notifications.length === 1 ? '' : 'ões'} financeira{notifications.length === 1 ? '' : 's'}</p></div></div><button onClick={onClose} className="rounded-lg p-2 transition-colors hover:bg-white/10" aria-label="Fechar notificações"><X size={20} className="text-white/40" /></button></div>
      <div className="no-scrollbar flex-1 space-y-6 overflow-y-auto p-4">
        {showReleaseUpdate && !releaseDismissed && <ReleaseUpdateCard onDismiss={dismissRelease} />}
        {attention.length > 0 && <NotificationGroup title="Atenção" icon={<AlertCircle size={12} />} className="text-amber-300">{attention.map((item) => <AttentionCard key={item.id} item={item} onDismiss={onDismiss} onNavigate={onNavigate} />)}</NotificationGroup>}
        {dueItems.length === 0 && attention.length === 0 ? <div className="rounded-2xl border border-white/8 bg-white/[0.025] p-6 text-center opacity-70"><CheckCircle2 size={34} className="mx-auto mb-3 text-green-500" /><p className="text-xs font-bold uppercase tracking-widest">Tudo em ordem</p><p className="mt-2 text-xs text-white/45">Nenhum alerta financeiro relevante agora.</p></div> : <>
          {overdue.length > 0 && <NotificationGroup title="Vencidas" icon={<AlertCircle size={12} />} className="text-red-400">{overdue.map((item) => <DueNotificationCard key={item.id} item={item} onPay={handlePay} onDismiss={onDismiss} paying={payingId === item.id} onNavigate={onNavigate} />)}</NotificationGroup>}
          {dueToday.length > 0 && <NotificationGroup title="Vencem hoje" icon={<Clock size={12} />} className="text-brand-primary">{dueToday.map((item) => <DueNotificationCard key={item.id} item={item} onPay={handlePay} onDismiss={onDismiss} paying={payingId === item.id} onNavigate={onNavigate} />)}</NotificationGroup>}
          {upcoming.length > 0 && <NotificationGroup title="Próximas" icon={<Calendar size={12} />} className="text-white/50">{upcoming.map((item) => <DueNotificationCard key={item.id} item={item} onPay={handlePay} onDismiss={onDismiss} paying={payingId === item.id} onNavigate={onNavigate} />)}</NotificationGroup>}
        </>}
      </div>
      <div className="border-t border-white/10 bg-white/5 p-4"><div className="rounded-xl border border-brand-primary/20 bg-brand-primary/10 p-3"><h4 className="mb-1 text-[10px] font-bold uppercase tracking-widest text-brand-primary">Menos ruído</h4><p className="text-[10px] leading-relaxed text-white/60">Use Preferências para escolher os alertas que o MF deve mostrar. Ao dispensar um alerta, ele não reaparece só porque você mudou de ferramenta.</p></div></div>
    </motion.aside>
  </>}</AnimatePresence>;
}

function ReleaseUpdateCard({ onDismiss }: { onDismiss: () => void }) {
  const update = LATEST_WEB_UPDATE;
  return <section className="overflow-hidden rounded-2xl border border-violet-400/20 bg-gradient-to-br from-violet-500/10 via-cyan-500/[0.045] to-transparent">
    <div className="border-b border-white/8 p-4"><div className="flex items-start gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-500/15 text-violet-300"><Sparkles size={19} /></div><div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-3"><div><p className="text-[9px] font-black uppercase tracking-[0.2em] text-violet-300">Atualização do sistema</p><h3 className="mt-1 text-sm font-bold text-white">{update.title}</h3><p className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-white/30">{update.dateLabel}</p></div><button type="button" onClick={onDismiss} className="rounded-lg p-1.5 text-white/30 transition hover:bg-white/10 hover:text-white/70" aria-label="Apagar atualização"><X size={14} /></button></div></div></div><p className="mt-3 text-xs leading-relaxed text-white/55">{update.summary}</p></div>
    <div className="space-y-2.5 p-4">{update.highlights.map((highlight) => <div key={highlight} className="flex items-start gap-2.5 text-xs leading-relaxed text-white/60"><CheckCircle2 size={14} className="mt-0.5 shrink-0 text-cyan-300" /><span>{highlight}</span></div>)}</div>
  </section>;
}

function NotificationGroup({ title, icon, className, children }: { title: string; icon: React.ReactNode; className: string; children: React.ReactNode }) { return <section className="space-y-3"><h3 className={`flex items-center gap-2 px-2 text-[10px] font-bold uppercase tracking-widest ${className}`}>{icon} {title}</h3>{children}</section>; }

function AttentionCard({ item, onDismiss, onNavigate }: { item: NotificationItem; onDismiss: (id: string) => void; onNavigate?: (path: string) => void }) {
  const actionPath = item.actionPath || (item.type === 'card' ? '/app/planejamento/cartoes' : undefined);
  const actionLabel = item.actionLabel || (item.type === 'card' ? 'Ver cartão' : 'Revisar');
  return <article className="rounded-2xl border border-amber-400/18 bg-amber-400/[0.045] p-4"><div className="mb-2 flex items-start justify-between gap-3"><div><strong className="text-xs text-white/85">{item.title}</strong><p className="mt-1 text-[10px] leading-relaxed text-white/45">{item.detail || 'Este ponto merece uma revisão rápida.'}</p></div><button type="button" onClick={() => onDismiss(item.id)} className="text-white/25 hover:text-white/60" aria-label="Dispensar alerta"><X size={14} /></button></div>{actionPath && <button type="button" onClick={() => onNavigate?.(actionPath)} className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-[9px] font-black uppercase tracking-wider text-amber-200">{actionLabel}<ExternalLink size={11} /></button>}</article>;
}

function DueNotificationCard({ item, onPay, onDismiss, paying, onNavigate }: { item: DueNotification; onPay: (item: NotificationItem) => void; onDismiss: (id: string) => void; paying: boolean; onNavigate?: (path: string) => void }) {
  const isOverdue = item.status === 'overdue';
  const isToday = item.status === 'due_today';
  const canPay = item.type === 'fixed';
  const detail = item.detail || (isOverdue ? `Venceu em ${item.dueDateLabel}` : isToday ? 'Vence hoje' : `Vence em ${item.dueDateLabel}`);
  return <article className={`rounded-2xl border p-4 ${isOverdue ? 'border-red-500/20 bg-red-500/5' : isToday ? 'border-brand-primary/20 bg-brand-primary/5' : 'border-white/10 bg-white/5'}`}><div className="mb-3 flex items-start justify-between gap-3"><div className="flex min-w-0 items-center gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-primary/10 text-brand-primary"><Wallet size={17} /></div><div className="min-w-0"><h4 className="truncate text-xs font-bold text-white/85">{item.title}</h4><p className="mt-1 text-[10px] text-white/40">{detail}</p>{Number(item.amount || 0) > 0 && <strong className="mt-1 block text-[11px] text-white/65">R$ {Number(item.amount || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong>}</div></div><button type="button" onClick={() => onDismiss(item.id)} className="text-white/25 hover:text-white/60" aria-label="Dispensar alerta"><X size={14} /></button></div><div className="flex gap-2">{canPay && <button type="button" onClick={() => onPay(item)} disabled={paying} className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-brand-primary px-3 py-2 text-[9px] font-black uppercase tracking-wider text-black disabled:opacity-50">{paying ? 'Registrando…' : 'Registrar pagamento'}</button>}{item.type === 'card' && <button type="button" onClick={() => onNavigate?.('/app/planejamento/cartoes')} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[9px] font-black uppercase tracking-wider text-white/60">Ver cartão<ExternalLink size={11} /></button>}</div></article>;
}
