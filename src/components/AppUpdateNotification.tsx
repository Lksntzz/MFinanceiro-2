import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CheckCircle2, Info, Sparkles, Wrench, X } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { AppUpdateInfo } from '../lib/app-updates';

interface AppUpdateNotificationProps {
  isOpen: boolean;
  updateInfo: AppUpdateInfo | null;
  onClose: () => void;
  onAcknowledge: () => void;
}

export default function AppUpdateNotification({
  isOpen,
  updateInfo,
  onClose,
  onAcknowledge,
}: AppUpdateNotificationProps) {
  if (!updateInfo) return null;

  const publishedLabel = updateInfo.publishedAt
    ? format(new Date(updateInfo.publishedAt), 'dd/MM/yyyy', { locale: ptBR })
    : null;

  const showNewsSection = updateInfo.hasNewFeatures && updateInfo.newFeatures.length > 0;
  const fixes = updateInfo.fixes.length > 0
    ? updateInfo.fixes
    : ['Correções internas e melhorias de estabilidade.'];

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[90]"
          />
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="fixed inset-0 z-[95] flex items-center justify-center p-4"
          >
            <div className="w-full max-w-xl rounded-2xl border border-white/10 bg-[#0b0b0b] shadow-2xl overflow-hidden">
              <div className="px-5 py-4 border-b border-white/10 bg-white/5 flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="h-10 w-10 rounded-xl bg-brand-primary/15 text-brand-primary flex items-center justify-center shrink-0">
                    <Info size={18} />
                  </div>
                  <div>
                    <h2 className="text-base font-bold">Atualizacao do aplicativo</h2>
                    <p className="text-xs text-white/50">
                      {updateInfo.title} • v{updateInfo.version}
                      {publishedLabel ? ` • ${publishedLabel}` : ''}
                    </p>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="p-2 rounded-lg text-white/40 hover:text-white hover:bg-white/10 transition-colors"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="p-5 space-y-5 max-h-[70vh] overflow-y-auto no-scrollbar">
                {updateInfo.summary && (
                  <p className="text-sm text-white/80 leading-relaxed">{updateInfo.summary}</p>
                )}

                {showNewsSection && (
                  <section className="space-y-2">
                    <h3 className="text-[11px] uppercase tracking-widest font-bold text-brand-primary flex items-center gap-2">
                      <Sparkles size={12} />
                      Novidades
                    </h3>
                    <ul className="space-y-2">
                      {updateInfo.newFeatures.map((item, idx) => (
                        <li key={`news-${idx}`} className="text-sm text-white/80 bg-white/5 border border-white/10 rounded-xl px-3 py-2">
                          {item}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                <section className="space-y-2">
                  <h3 className="text-[11px] uppercase tracking-widest font-bold text-white/70 flex items-center gap-2">
                    <Wrench size={12} />
                    {showNewsSection ? 'Correções e melhorias' : 'Melhorias desta atualizacao'}
                  </h3>
                  <ul className="space-y-2">
                    {fixes.map((item, idx) => (
                      <li key={`fix-${idx}`} className="text-sm text-white/80 bg-white/5 border border-white/10 rounded-xl px-3 py-2">
                        {item}
                      </li>
                    ))}
                  </ul>
                </section>
              </div>

              <div className="px-5 py-4 border-t border-white/10 bg-white/5 flex items-center justify-end">
                <button
                  onClick={onAcknowledge}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-brand-primary text-black text-xs font-bold uppercase tracking-wider hover:opacity-90 transition-opacity"
                >
                  <CheckCircle2 size={14} />
                  Entendi
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
