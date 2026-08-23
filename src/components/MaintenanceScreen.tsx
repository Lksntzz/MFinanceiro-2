import { Clock3, Sparkles, Wrench } from 'lucide-react';
import { motion } from 'motion/react';

interface MaintenanceScreenProps {
  message?: string;
}

export default function MaintenanceScreen({
  message = 'Estamos realizando melhorias importantes. O MFinanceiro estará disponível novamente em breve.',
}: MaintenanceScreenProps) {
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden bg-[#050505] p-6">
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-[520px] w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-primary/10 blur-[130px]" />
      <div className="pointer-events-none absolute -left-24 top-16 h-72 w-72 rounded-full bg-brand-secondary/10 blur-[110px]" />

      <motion.main
        initial={{ opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
        className="relative z-10 w-full max-w-lg overflow-hidden rounded-[32px] border border-white/10 bg-white/[0.035] shadow-2xl backdrop-blur-2xl"
      >
        <div className="border-b border-white/10 px-7 py-5">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-brand-primary/20 bg-brand-primary/10 text-brand-primary">
                <Wrench size={21} />
              </div>
              <div>
                <span className="block text-[10px] font-black uppercase tracking-[0.22em] text-brand-primary">
                  MFinanceiro
                </span>
                <span className="text-xs text-white/40">
                  Ambiente temporariamente restrito
                </span>
              </div>
            </div>
            <span className="flex items-center gap-2 rounded-full border border-amber-400/20 bg-amber-500/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-amber-300">
              <span className="h-2 w-2 animate-pulse rounded-full bg-amber-400" />
              Manutenção
            </span>
          </div>
        </div>

        <div className="px-7 py-9 text-center">
          <motion.div
            animate={{ rotate: [0, 4, 0, -4, 0] }}
            transition={{ repeat: Infinity, duration: 5, ease: 'easeInOut' }}
            className="mx-auto mb-6 flex h-24 w-24 items-center justify-center rounded-[28px] border border-white/10 bg-gradient-to-br from-brand-primary/15 to-brand-secondary/10 shadow-[0_0_60px_rgba(0,242,255,0.08)]"
          >
            <Sparkles size={39} className="text-brand-primary" />
          </motion.div>

          <h1 className="text-3xl font-black tracking-tight text-white">
            Sistema em manutenção
          </h1>
          <p className="mx-auto mt-4 max-w-md text-sm leading-7 text-white/60">
            {message}
          </p>

          <div className="mx-auto mt-7 flex max-w-sm items-center justify-center gap-2 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-xs text-white/40">
            <Clock3 size={15} className="text-brand-primary" />
            Seus dados permanecem protegidos durante a atualização.
          </div>
        </div>

        <div className="border-t border-white/10 bg-black/20 px-7 py-5 text-center">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/25">
            O acesso será liberado automaticamente após a manutenção
          </p>
        </div>
      </motion.main>
    </div>
  );
}
