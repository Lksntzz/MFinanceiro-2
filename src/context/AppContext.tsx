import type React from 'react';
import { createContext, useContext, useEffect, useState } from 'react';

type Theme = 'dark' | 'light' | 'gold';

interface AppContextType {
  isPrivate: boolean;
  setIsPrivate: (val: boolean) => void;
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [isPrivate, setIsPrivate] = useState(
    () => localStorage.getItem('mfinanceiro-privacy') === 'true',
  );
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem('mfinanceiro-theme') as Theme) || 'dark',
  );

  useEffect(() => {
    localStorage.setItem('mfinanceiro-privacy', String(isPrivate));
    document.documentElement.setAttribute('data-mf-private', String(isPrivate));
  }, [isPrivate]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey && event.key.toLowerCase() === 'p') {
        event.preventDefault();
        setIsPrivate((current) => !current);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    localStorage.setItem('mfinanceiro-theme', theme);
    document.documentElement.setAttribute('data-theme', theme);
    if (theme === 'light') document.documentElement.classList.add('light');
    else document.documentElement.classList.remove('light');
  }, [theme]);

  return (
    <AppContext.Provider value={{ isPrivate, setIsPrivate, theme, setTheme }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (context === undefined)
    throw new Error('useApp must be used within an AppProvider');
  return context;
}
