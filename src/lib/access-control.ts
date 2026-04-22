import { supabase } from "./supabase";

export type AccessRequestStatus = 'pending' | 'approved' | 'denied' | 'none';

export async function fetchAccessStatus(email: string): Promise<AccessRequestStatus> {
  if (!supabase) return 'none';
  
  try {
    const { data, error } = await supabase
      .from('mf_access_requests')
      .select('status')
      .ilike('email', email.trim())
      .limit(1);

    if (error) throw error;
    if (!data || data.length === 0) return 'none';

    const status = String(data[0].status).toLowerCase();
    if (status === 'approved' || status === 'aprovado') return 'approved';
    if (status === 'denied' || status === 'negado' || status === 'rejected') return 'denied';
    return 'pending';
  } catch (err) {
    console.error('Error fetching access status:', err);
    return 'none';
  }
}

export function getAccessStatusMessage(status: AccessRequestStatus): string {
  switch (status) {
    case 'approved':
      return 'Seu acesso foi aprovado! Agora você pode finalizar seu cadastro.';
    case 'pending':
      return 'Sua solicitação está em análise. Você receberá um e-mail quando for aprovada.';
    case 'denied':
      return 'Infelizmente sua solicitação de acesso foi negada. Entre em contato com o suporte.';
    default:
      return 'Você ainda não possui uma solicitação de acesso vinculada a este e-mail.';
  }
}

export async function requestAccess(name: string, email: string, password?: string) {
  if (!supabase) throw new Error('Supabase not configured');
  
  try {
    // Tenta salvar no Supabase diretamente
    const { data, error } = await supabase
      .from('mf_access_requests')
      .insert([
        { 
          nome: name.trim(), 
          email: email.trim().toLowerCase(), 
          senha: password, // Salvando senha temporariamente para finalização automática
          status: 'pendente' 
        }
      ])
      .select('status')
      .single();

    if (error) {
      if (error.code === '23505') throw new Error('Já existe uma solicitação para este e-mail.');
      
      // Fallback para nomes em ingles caso as colunas em portugues falhem
      const { data: dataEn, error: errorEn } = await supabase
        .from('mf_access_requests')
        .insert([
          { 
            name: name.trim(), 
            email: email.trim().toLowerCase(), 
            password: password, 
            status: 'pending' 
          }
        ])
        .select('status')
        .single();
        
      if (errorEn) throw errorEn;
      return dataEn;
    }

    return data;
  } catch (err: any) {
    console.error('Request access error:', err);
    throw err;
  }
}

export function mapSignupErrorMessage(message: string): string {
  const msg = message.toLowerCase();
  if (msg.includes('user already registered')) return 'Este e-mail já está cadastrado.';
  if (msg.includes('email not confirmed')) return 'E-mail ainda não confirmado. Verifique sua caixa de entrada.';
  if (msg.includes('invalid login credentials')) return 'E-mail ou senha incorretos.';
  return message;
}
