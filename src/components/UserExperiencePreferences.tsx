import { useEffect, useRef } from 'react';

import { useApp } from '../context/AppContext';
import { useUserPreferences } from '../hooks/useUserPreferences';

export default function UserExperiencePreferences({ userId }: { userId: string }) {
  const { preferences } = useUserPreferences(userId);
  const { setIsPrivate } = useApp();
  const initializedUserRef = useRef('');

  useEffect(() => {
    document.documentElement.classList.toggle('mf-user-reduced-motion', preferences.reducedMotion);
    document.documentElement.classList.toggle('mf-user-high-contrast', preferences.highContrast);
    document.documentElement.classList.toggle('mf-compact-home', preferences.compactHome);
  }, [preferences.compactHome, preferences.highContrast, preferences.reducedMotion]);

  useEffect(() => {
    if (initializedUserRef.current === userId) return;
    initializedUserRef.current = userId;
    if (preferences.privacyDefault) setIsPrivate(true);
  }, [preferences.privacyDefault, setIsPrivate, userId]);

  return null;
}
