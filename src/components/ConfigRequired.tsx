
import { AlertCircle, ExternalLink } from 'lucide-react';

export default function ConfigRequired() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="glass-card w-full max-w-lg p-8 text-center animate-fade-in">
        <div className="h-16 w-16 rounded-full bg-yellow-500/20 flex items-center justify-center text-yellow-500 mx-auto mb-6">
          <AlertCircle size={32} />
        </div>
        <h1 className="text-2xl font-bold mb-4">Configuração Necessária</h1>
        <p className="text-white/60 mb-8">
          Para usar o <strong>MFinanceiro</strong>, você precisa configurar as variáveis de ambiente do Supabase no arquivo <code>.env</code> ou no painel de segredos.
        </p>
        
        <div className="space-y-4 text-left bg-white/5 p-6 rounded-xl border border-white/10 font-mono text-sm mb-8">
          <div className="text-white/40"># Adicione ao seu .env</div>
          <div>VITE_SUPABASE_URL="https://..."</div>
          <div>VITE_SUPABASE_ANON_KEY="..."</div>
        </div>

        <div className="flex flex-col gap-3">
          <a 
            href="https://supabase.com" 
            target="_blank" 
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 bg-white/10 hover:bg-white/20 py-3 rounded-xl transition-all"
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
