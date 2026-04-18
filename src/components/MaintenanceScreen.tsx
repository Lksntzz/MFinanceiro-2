import React from 'react';
import { Hammer, CloudOff } from 'lucide-react';
import { motion } from 'motion/react';

interface MaintenanceScreenProps {
  message?: string;
}

export default function MaintenanceScreen({
  message = 'Estamos em manutenção para melhorias. Tente novamente em alguns minutos.',
}: MaintenanceScreenProps) {
  return (
    <div className="fixed inset-0 z-[9999] bg-[#050505] flex items-center justify-center p-6 overflow-hidden">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-brand-primary/10 rounded-full blur-[120px] pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-md w-full text-center relative z-10"
      >
        <div className="flex justify-center mb-8">
          <div className="relative">
            <div className="h-24 w-24 rounded-3xl bg-gradient-to-br from-brand-primary/20 to-brand-secondary/20 flex items-center justify-center border border-white/10">
              <CloudOff size={40} className="text-brand-primary" />
            </div>
            <motion.div
              animate={{ rotate: [0, 10, 0, -10, 0] }}
              transition={{ repeat: Infinity, duration: 4, ease: 'easeInOut' }}
              className="absolute -top-2 -right-2 h-10 w-10 rounded-xl bg-[#0a0a0a] border border-white/10 flex items-center justify-center shadow-xl"
            >
              <Hammer size={20} className="text-brand-secondary" />
            </motion.div>
          </div>
        </div>

        <h1 className="text-3xl font-bold tracking-tight mb-4">Sistema em manutenção</h1>
        <p className="text-white/60 leading-relaxed mb-10">{message}</p>

        <div className="h-px w-full bg-gradient-to-r from-transparent via-white/10 to-transparent mb-10" />

        <div className="flex flex-col gap-4 items-center">
          <div className="text-[10px] text-white/30 uppercase tracking-[0.2em] font-bold">
            Acesso Restrito
          </div>

          <p className="text-[10px] text-white/20 mt-4 italic">
            MFinanceiro v2.1.0 • Todos os backups salvos com sucesso
          </p>
        </div>
      </motion.div>
    </div>
  );
}
