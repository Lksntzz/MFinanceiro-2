
import { APP_VERSION, STORAGE_PREFIX } from './constants';

export function clearLegacyCache() {
  if (typeof window === 'undefined') return;

  const currentVersion = localStorage.getItem(`${STORAGE_PREFIX}version`);
  
  if (currentVersion !== APP_VERSION) {
    console.log(`Version mismatch (Old: ${currentVersion}, New: ${APP_VERSION}). Clearing cache...`);
    
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      // Remove mfinanceiro keys AND legacy mf_ keys
      if (key && (
        key.startsWith('mf_') || 
        key.startsWith('mfinanceiro-') || 
        key.startsWith('mfinanceiro:')
      )) {
        keysToRemove.push(key);
      }
    }
    
    keysToRemove.forEach(key => localStorage.removeItem(key));
    localStorage.setItem(`${STORAGE_PREFIX}version`, APP_VERSION);
  }
}
