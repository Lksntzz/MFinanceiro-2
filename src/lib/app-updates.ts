import { SupabaseClient } from '@supabase/supabase-js';

export interface AppUpdateInfo {
  version: string;
  title: string;
  features: string[];
  fixes: string[];
  released_at: string;
  is_major?: boolean;
}

export async function fetchLatestAppUpdate(supabase: SupabaseClient): Promise<AppUpdateInfo | null> {
  try {
    // Tenta buscar ordenando por released_at (preferencial)
    let { data, error } = await supabase
      .from('mf_app_updates')
      .select('*')
      .order('released_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // Se falhar por coluna inexistente, tenta buscar sem ordenação específica ou por created_at
    if (error && error.code === '42703') {
      const { data: altData, error: altError } = await supabase
        .from('mf_app_updates')
        .select('*')
        .limit(5); // Pega os últimos 5 e ordena no JS
      
      if (altError) throw altError;
      if (!altData || altData.length === 0) return null;
      
      // Ordena decrescente por versão ou id (heurística simples)
      const sorted = altData.sort((a, b) => b.version?.localeCompare(a.version));
      data = sorted[0];
    } else if (error) {
      throw error;
    }
    
    if (!data) return null;

    return {
      version: data.version,
      title: data.title,
      features: Array.isArray(data.features) ? data.features : [],
      fixes: Array.isArray(data.fixes) ? data.fixes : [],
      released_at: data.released_at || data.created_at || new Date().toISOString(),
      is_major: data.is_major
    };
  } catch (err) {
    // Silent fail para não poluir o console do usuário se a tabela não existir
    return null;
  }
}
