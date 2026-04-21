import React from 'react';
import { X, Sparkles, CheckCircle, Info, ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
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
  onAcknowledge 
}: AppUpdateNotificationProps) {
  if (!updateInfo) return null;

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/80 backdrop-blur-md"
          />
          
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="glass-card w-full max-w-lg relative overflow-hidden flex flex-col max-h-[90vh]"
          >
            {/* Header com gradiente */}
            <div className="relative p-6 bg-gradient-to-br from-brand-primary/20 to-transparent border-b border-white/5">
              <button 
                onClick={onClose}
                className="absolute top-4 right-4 p-2 text-white/40 hover:text-white transition-colors"
                aria-label="Fecar"
              >
                <X size={20} />
              </button>

              <div className="flex items-center gap-4 mb-2">
                <div className="h-12 w-12 rounded-2xl bg-brand-primary/20 flex items-center justify-center">
                  <Sparkles className="text-brand-primary" size={24} />
                </div>
                <div>
                  <h2 className="text-xl font-bold tracking-tight">{updateInfo.title || 'Novidades Chegaram!'}</h2>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="px-2 py-0.5 rounded-full bg-brand-primary/10 text-brand-primary text-[10px] font-bold uppercase tracking-wider">
                      v{updateInfo.version}
                    </span>
                    {updateInfo.is_major && (
                      <span className="px-2 py-0.5 rounded-full bg-yellow-500/10 text-yellow-500 text-[10px] font-bold uppercase tracking-wider">
                        Grande Update
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-8 no-scrollbar">
              {/* Features - Novidades */}
              {updateInfo.features && updateInfo.features.length > 0 && (
                <section>
                  <div className="flex items-center gap-2 mb-4 text-brand-primary">
                    <Sparkles size={16} />
                    <h3 className="text-xs font-bold uppercase tracking-widest">O que há de novo</h3>
                  </div>
                  <div className="grid gap-3">
                    {updateInfo.features.map((feature, idx) => (
                      <div key={idx} className="flex gap-3 p-3 rounded-xl bg-white/5 border border-white/5 group hover:bg-white/10 transition-colors">
                        <div className="h-5 w-5 rounded-full bg-brand-primary/20 flex items-center justify-center shrink-0 mt-0.5">
                          <ChevronRight className="text-brand-primary" size={12} />
                        </div>
                        <p className="text-sm text-white/80 leading-relaxed font-medium">{feature}</p>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Fixes - Correções */}
              {updateInfo.fixes && updateInfo.fixes.length > 0 && (
                <section>
                  <div className="flex items-center gap-2 mb-4 text-white/40">
                    <CheckCircle size={16} />
                    <h3 className="text-xs font-bold uppercase tracking-widest">Correções e Melhorias</h3>
                  </div>
                  <ul className="space-y-3">
                    {updateInfo.fixes.map((fix, idx) => (
                      <li key={idx} className="flex gap-3 text-sm text-white/50 leading-relaxed">
                        <span className="text-brand-primary mt-1.5 h-1.5 w-1.5 rounded-full shrink-0" />
                        {fix}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>

            <div className="p-6 border-t border-white/5 bg-white/5">
              <button
                onClick={onAcknowledge}
                className="w-full py-4 rounded-2xl bg-brand-primary text-black font-bold text-sm tracking-wide hover:brightness-110 transition-all shadow-[0_4px_20px_rgba(0,242,255,0.2)] active:scale-[0.98]"
              >
                Entendi, vamos lá!
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
