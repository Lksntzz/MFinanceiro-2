import { supabase } from './supabase';

export type AccessRequestResult = {
  accepted: true;
  message: string;
};

export async function requestAccess(name: string, email: string): Promise<AccessRequestResult> {
  const normalizedName = String(name || '').trim();
  const normalizedEmail = String(email || '').trim().toLowerCase();

  if (!normalizedName) throw new Error('Informe seu nome para solicitar acesso.');
  if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    throw new Error('Informe um e-mail válido para solicitar acesso.');
  }

  const { data, error } = await supabase.functions.invoke('access-request', {
    body: {
      action: 'request',
      name: normalizedName,
      email: normalizedEmail,
    },
  });

  if (error) {
    console.error('Error submitting access request:', error);
    throw new Error('Não foi possível enviar sua solicitação agora. Tente novamente em instantes.');
  }

  return {
    accepted: true,
    message: String(
      (data as { message?: unknown } | null)?.message
      || 'Se o endereço estiver apto, o MF enviará as próximas instruções por e-mail.',
    ),
  };
}

export function mapLoginErrorMessage(message: string): string {
  const msg = String(message || '').toLowerCase();
  if (msg.includes('invalid login credentials') || msg.includes('email not confirmed') || msg.includes('user not found')) {
    return 'E-mail ou senha incorretos, ou a conta ainda não está pronta para acesso.';
  }
  if (msg.includes('too many requests') || msg.includes('rate limit')) {
    return 'Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.';
  }
  return 'Não foi possível entrar agora. Tente novamente em instantes.';
}
