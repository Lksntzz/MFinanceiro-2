import { useEffect, useState } from 'react';

import { MOBILE_BREAKPOINT_PX } from './routes';

const DESKTOP_OVERRIDE_KEY = 'mf-mobile-desktop-override';

function shouldForceDesktop() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('mobile') === '1') {
    window.sessionStorage.removeItem(DESKTOP_OVERRIDE_KEY);
    return false;
  }
  if (params.get('desktop') === '1') {
    window.sessionStorage.setItem(DESKTOP_OVERRIDE_KEY, '1');
    return true;
  }
  return window.sessionStorage.getItem(DESKTOP_OVERRIDE_KEY) === '1';
}

function computeMobileExperience() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  if (path === '/quick' || path === '/scan' || path === '/voice') return true;
  if (shouldForceDesktop()) return false;
  return window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX}px)`).matches;
}

export function useMobileExperience() {
  const [mobile, setMobile] = useState(computeMobileExperience);

  useEffect(() => {
    const media = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX}px)`);
    const refresh = () => setMobile(computeMobileExperience());

    media.addEventListener('change', refresh);
    window.addEventListener('popstate', refresh);

    return () => {
      media.removeEventListener('change', refresh);
      window.removeEventListener('popstate', refresh);
    };
  }, []);

  return mobile;
}

export function openDesktopExperience() {
  window.sessionStorage.setItem(DESKTOP_OVERRIDE_KEY, '1');
  window.location.assign('/app?desktop=1');
}
