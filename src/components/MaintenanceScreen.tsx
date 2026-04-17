import React from 'react';
import { Wrench, ShieldAlert } from 'lucide-react';

interface MaintenanceScreenProps {
  message: string;
  isAdminBypass: boolean;
  adminLoginHref?: string;
  showAdminLoginButton?: boolean;
}

export default function MaintenanceScreen({
  message,
  isAdminBypass,
  adminLoginHref = '/auth/admin',
  showAdminLoginButton = false,
}: MaintenanceScreenProps) {
  return (
    <div className="flex h-dvh items-center justify-center overflow-hidden bg-[#050505] p-6 text-white">
      <div className="w-full max-w-xl rounded-2xl border border-yellow-500/30 bg-yellow-500/10 p-6 sm:p-8">
        <div className="mb-4 flex items-center gap-3">
          <div className="rounded-xl bg-yellow-500/20 p-2 text-yellow-300">
            <Wrench size={20} />
          </div>
          <h1 className="text-xl font-bold text-yellow-200">Modo de Manutenção</h1>
        </div>

        <p className="text-sm leading-relaxed text-white/80">{message}</p>

        {showAdminLoginButton && !isAdminBypass && (
          <div className="mt-5">
            <a
              href={adminLoginHref}
              className="inline-flex min-h-10 items-center justify-center rounded-lg border border-yellow-300/40 bg-yellow-300/15 px-4 py-2 text-sm font-bold text-yellow-100 transition-all hover:bg-yellow-300/25"
            >
              Acesso administrativo
            </a>
          </div>
        )}

        {isAdminBypass && (
          <div className="mt-5 flex items-start gap-2 rounded-xl border border-cyan-500/30 bg-cyan-500/10 p-3 text-cyan-200">
            <ShieldAlert size={16} className="mt-0.5 shrink-0" />
            <span className="text-xs">
              Acesso liberado para administrador. Você pode continuar usando o app
              para testes durante a manutenção.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

