import { AlertCircle, ExternalLink } from 'lucide-react';

export default function ConfigRequired() {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="glass-card w-full max-w-lg animate-fade-in p-8 text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-yellow-500/20 text-yellow-500">
          <AlertCircle size={32} />
        </div>
        <h1 className="mb-4 text-2xl font-bold">Configuração Necessária</h1>
        <p className="mb-8 text-white/60">
          Para usar o <strong>MFinanceiro</strong>, você precisa configurar as variáveis de ambiente do Supabase no arquivo <code>.env</code> ou no painel de segredos.
        </p>

        <div className="mb-8 space-y-4 rounded-xl border border-white/10 bg-white/5 p-6 text-left font-mono text-sm">
          <div className="text-white/40"># Adicione ao seu .env</div>
          <div>VITE_SUPABASE_URL="https://..."</div>
          <div>VITE_SUPABASE_ANON_KEY="..."</div>
        </div>

        <div className="flex flex-col gap-3">
          <a
            href="https://supabase.com"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 rounded-xl bg-white/10 py-3 transition-all hover:bg-white/20"
          >
            <span>Criar conta no Supabase</span>
            <ExternalLink size={16} />
          </a>
          <p className="text-xs text-white/40">
            Após configurar, reinicie o servidor de desenvolvimento.
          </p>
        </div>
      </div>
    </div>
  );
}
