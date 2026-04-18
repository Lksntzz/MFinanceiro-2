import React from 'react';
import { Bell, X, CheckCircle2, AlertCircle, Clock, Calendar, Wallet } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface NotificationItem {
  id: string;
  type: 'fixed' | 'installment' | 'card' | 'daily';
  title: string;
  amount: number;
  dueDate: number;
  status: 'pending' | 'due_today' | 'overdue';
  originalData: any;
}

interface NotificationCenterProps {
  notifications: NotificationItem[];
  onPay: (item: NotificationItem) => void;
  onClose: () => void;
  isOpen: boolean;
}

export default function NotificationCenter({ notifications, onPay, onClose, isOpen }: NotificationCenterProps) {
  const dueToday = notifications.filter(n => n.status === 'due_today');
  const overdue = notifications.filter(n => n.status === 'overdue');

  return (
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
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed top-0 right-0 h-full w-full max-w-sm bg-[#0a0a0a] border-l border-white/10 z-[70] shadow-2xl flex flex-col"
          >
            <div className="p-6 border-b border-white/10 flex items-center justify-between bg-white/5">
              <div className="flex items-center gap-3">
                <Bell className="text-brand-primary" size={20} />
                <h2 className="font-bold text-lg">Central de Alertas</h2>
              </div>
              <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg transition-colors">
                <X size={20} className="text-white/40" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 no-scrollbar space-y-6">
              {notifications.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-8 opacity-40">
                  <CheckCircle2 size={48} className="mb-4 text-green-500" />
                  <p className="font-bold uppercase tracking-widest text-xs">Tudo em dia!</p>
                  <p className="text-xs mt-2">Nenhuma conta pendente para hoje.</p>
                </div>
              ) : (
                <>
                  {overdue.length > 0 && (
                    <div className="space-y-3">
                      <h3 className="text-[10px] font-bold uppercase tracking-widest text-red-400 px-2 flex items-center gap-2">
                        <AlertCircle size={12} /> Vencidos
                      </h3>
                      {overdue.map(item => (
                        <NotificationCard key={item.id} item={item} onPay={onPay} />
                      ))}
                    </div>
                  )}

                  {dueToday.length > 0 && (
                    <div className="space-y-3">
                      <h3 className="text-[10px] font-bold uppercase tracking-widest text-brand-primary px-2 flex items-center gap-2">
                        <Clock size={12} /> Para Hoje
                      </h3>
                      {dueToday.map(item => (
                        <NotificationCard key={item.id} item={item} onPay={onPay} />
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="p-4 border-t border-white/10 bg-white/5">
              <p className="text-[9px] text-center text-white/30 uppercase font-bold tracking-tighter">
                Fique atento aos prazos para evitar juros e multas.
              </p>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

interface NotificationCardProps {
  item: NotificationItem;
  onPay: (item: NotificationItem) => void;
  key?: string | number;
}

function NotificationCard({ item, onPay }: NotificationCardProps) {
  const isOverdue = item.status === 'overdue';

  return (
    <div className={`p-4 rounded-2xl border transition-all hover:scale-[1.02] ${isOverdue ? 'bg-red-500/5 border-red-500/20' : 'bg-white/5 border-white/10'}`}>
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className={`h-10 w-10 rounded-xl flex items-center justify-center ${
            item.type === 'card' ? 'bg-brand-secondary/10 text-brand-secondary' :
            item.type === 'installment' ? 'bg-brand-primary/10 text-brand-primary' :
            'bg-white/10 text-white/60'
          }`}>
            {item.type === 'card' ? <Wallet size={20} /> : 
             item.type === 'installment' ? <Clock size={20} /> : 
             <Calendar size={20} />}
          </div>
          <div>
            <h4 className="font-bold text-sm truncate max-w-[150px]">{item.title}</h4>
            <div className="flex flex-col">
              <span className="text-[10px] text-white/40 uppercase font-bold">{
                item.type === 'fixed' ? 'Conta Fixa' :
                item.type === 'installment' ? 'Parcelamento' :
                item.type === 'card' ? 'Cartão de Crédito' : 'Boleto Diário'
              }</span>
              {(item as any).nextDueDateLabel && (
                <span className="text-[10px] text-brand-primary font-medium">
                  Próximo: {(item as any).nextDueDateLabel}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-sm font-bold">R$ {item.amount.toLocaleString('pt-BR')}</div>
          <div className={`text-[9px] font-bold uppercase ${isOverdue ? 'text-red-400' : 'text-white/40'}`}>
            Dia {item.dueDate}
          </div>
        </div>
      </div>

      <button
        onClick={() => onPay(item)}
        className={`w-full py-2.5 rounded-xl text-xs font-bold uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${
          isOverdue ? 'bg-red-500 text-white hover:bg-red-600' : 'bg-brand-primary text-black hover:bg-brand-primary/90'
        }`}
      >
        <CheckCircle2 size={14} /> Baixar Pagamento
      </button>
    </div>
  );
}
