import { useEffect, useMemo, useState } from 'react';

import {
  loadUserPreferences,
  saveUserPreferences,
  subscribeUserPreferences,
  type UserPreferences,
} from '../lib/user-preferences';

export function useUserPreferences(userId: string) {
  const initial = useMemo(() => loadUserPreferences(userId), [userId]);
  const [preferences, setPreferencesState] = useState<UserPreferences>(initial);

  useEffect(() => {
    setPreferencesState(loadUserPreferences(userId));
    return subscribeUserPreferences(userId, setPreferencesState);
  }, [userId]);

  function setPreferences(next: UserPreferences | ((current: UserPreferences) => UserPreferences)) {
    setPreferencesState((current) => {
      const resolved = typeof next === 'function' ? next(current) : next;
      saveUserPreferences(userId, resolved);
      return resolved;
    });
  }

  return { preferences, setPreferences };
}
