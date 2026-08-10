export type HomeWidgetId = 'status' | 'alerts' | 'balance_chart' | 'rhythm_chart' | 'categories' | 'recent' | 'cards' | 'quality';

export type NotificationPreferenceKey = 'commitments' | 'cards' | 'quality' | 'release';

export interface UserPreferences {
  version: 2;
  homeWidgets: HomeWidgetId[];
  notifications: Record<NotificationPreferenceKey, boolean>;
  toursAutoStart: boolean;
  privacyDefault: boolean;
  reducedMotion: boolean;
  highContrast: boolean;
  compactHome: boolean;
}

type StoredUserPreferences = Omit<Partial<UserPreferences>, 'version'> & { version?: number };

export const MIN_HOME_WIDGETS = 3;
export const MAX_HOME_WIDGETS = 8;

export const HOME_WIDGET_OPTIONS: Array<{ id: HomeWidgetId; label: string; description: string }> = [
  { id: 'status', label: 'Situação atual', description: 'Saldo, limite diário, ciclo e gasto de hoje.' },
  { id: 'alerts', label: 'Atenção e leitura', description: 'Alertas do ciclo e leitura financeira.' },
  { id: 'quality', label: 'Qualidade dos dados', description: 'Pendências que podem reduzir a confiança das análises.' },
  { id: 'balance_chart', label: 'Evolução do saldo', description: 'Gráfico da evolução histórica do saldo.' },
  { id: 'rhythm_chart', label: 'Ritmo de gastos', description: 'Entradas e saídas por dia, semana ou mês.' },
  { id: 'categories', label: 'Categorias principais', description: 'Categorias com maior peso nas despesas.' },
  { id: 'recent', label: 'Últimos lançamentos', description: 'Movimentações mais recentes.' },
  { id: 'cards', label: 'Uso de cartões', description: 'Limite utilizado e restante disponível.' },
];

export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  version: 2,
  homeWidgets: ['status', 'alerts', 'quality', 'balance_chart', 'rhythm_chart', 'categories', 'recent', 'cards'],
  notifications: {
    commitments: true,
    cards: true,
    quality: true,
    release: true,
  },
  toursAutoStart: true,
  privacyDefault: false,
  reducedMotion: false,
  highContrast: false,
  compactHome: false,
};

const EVENT_NAME = 'mf:user-preferences-changed';

export function userPreferencesKey(userId: string) {
  return `mf-preferences:v1:${userId}`;
}

export function allToursSkipKey(userId: string) {
  return `mf-tour:all-skipped:${userId}`;
}

function sanitizeWidgets(value: unknown): HomeWidgetId[] {
  if (!Array.isArray(value)) return DEFAULT_USER_PREFERENCES.homeWidgets;
  const valid = new Set(HOME_WIDGET_OPTIONS.map((item) => item.id));
  const widgets = [...new Set(value.filter((item): item is HomeWidgetId => typeof item === 'string' && valid.has(item as HomeWidgetId)))].slice(0, MAX_HOME_WIDGETS);
  return widgets.length >= MIN_HOME_WIDGETS ? widgets : DEFAULT_USER_PREFERENCES.homeWidgets;
}

export function loadUserPreferences(userId: string): UserPreferences {
  if (typeof window === 'undefined' || !userId) return DEFAULT_USER_PREFERENCES;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(userPreferencesKey(userId)) || '{}') as StoredUserPreferences;
    const globalToursSkipped = window.localStorage.getItem(allToursSkipKey(userId)) === 'skipped';
    const homeWidgets = parsed.version === 2 ? sanitizeWidgets(parsed.homeWidgets) : DEFAULT_USER_PREFERENCES.homeWidgets;
    return {
      ...DEFAULT_USER_PREFERENCES,
      ...parsed,
      version: 2,
      homeWidgets,
      notifications: {
        ...DEFAULT_USER_PREFERENCES.notifications,
        ...(parsed.notifications || {}),
      },
      toursAutoStart: globalToursSkipped ? false : parsed.toursAutoStart ?? DEFAULT_USER_PREFERENCES.toursAutoStart,
    };
  } catch {
    return DEFAULT_USER_PREFERENCES;
  }
}

export function saveUserPreferences(userId: string, preferences: UserPreferences) {
  if (typeof window === 'undefined' || !userId) return;
  const normalized: UserPreferences = {
    ...DEFAULT_USER_PREFERENCES,
    ...preferences,
    version: 2,
    homeWidgets: sanitizeWidgets(preferences.homeWidgets),
    notifications: {
      ...DEFAULT_USER_PREFERENCES.notifications,
      ...preferences.notifications,
    },
  };
  try {
    window.localStorage.setItem(userPreferencesKey(userId), JSON.stringify(normalized));
    if (normalized.toursAutoStart) window.localStorage.removeItem(allToursSkipKey(userId));
    else window.localStorage.setItem(allToursSkipKey(userId), 'skipped');
  } catch {
    // Preferences must never block the financial experience.
  }
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { userId, preferences: normalized } }));
}

export function updateUserPreferences(userId: string, patch: Partial<UserPreferences>) {
  const current = loadUserPreferences(userId);
  saveUserPreferences(userId, {
    ...current,
    ...patch,
    notifications: patch.notifications ? { ...current.notifications, ...patch.notifications } : current.notifications,
  });
}

export function resetUserPreferences(userId: string) {
  saveUserPreferences(userId, DEFAULT_USER_PREFERENCES);
}

export function subscribeUserPreferences(userId: string, listener: (preferences: UserPreferences) => void) {
  if (typeof window === 'undefined') return () => undefined;
  const handle = (event: Event) => {
    const detail = (event as CustomEvent<{ userId?: string; preferences?: UserPreferences }>).detail;
    if (detail?.userId === userId && detail.preferences) listener(detail.preferences);
  };
  const storage = (event: StorageEvent) => {
    if (event.key === userPreferencesKey(userId) || event.key === allToursSkipKey(userId)) listener(loadUserPreferences(userId));
  };
  window.addEventListener(EVENT_NAME, handle);
  window.addEventListener('storage', storage);
  return () => {
    window.removeEventListener(EVENT_NAME, handle);
    window.removeEventListener('storage', storage);
  };
}
