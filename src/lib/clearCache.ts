export function clearLegacyCache() {
  if (typeof window === 'undefined') return;
  
  // Limpar sessão exceto Supabase
  try {
    const keysToKeep = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('sb-') && key.endsWith('-auth-token')) {
        keysToKeep.push({ key, value: localStorage.getItem(key) });
      }
    }
    
    // Clear everything
    localStorage.clear();
    sessionStorage.clear();
    
    // Restore Supabase keys
    keysToKeep.forEach(item => {
      if (item.value) {
        localStorage.setItem(item.key, item.value);
      }
    });

    console.log('[MFinanceiro] Cache legado limpo com sucesso.');
  } catch (err) {
    console.error('Falha ao limpar o cache:', err);
  }
}
