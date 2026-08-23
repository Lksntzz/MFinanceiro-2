import { useEffect, useState } from 'react';

import { MOBILE_BREAKPOINT_PX } from './routes';

const DESKTOP_OVERRIDE_KEY = 'mf-mobile-desktop-override';
const DIRECT_MOBILE_PATHS = new Set([
  '/quick',
  '/scan',
  '/voice',
  '/recurrences',
]);

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

export function isCurrentMobileExperience() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  if (DIRECT_MOBILE_PATHS.has(path)) return true;
  if (shouldForceDesktop()) return false;

  const narrowViewport = window.matchMedia(
    `(max-width: ${MOBILE_BREAKPOINT_PX}px)`,
  ).matches;
  if (narrowViewport) return true;

  const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
  const compactPhysicalViewport =
    Math.min(window.innerWidth, window.innerHeight) <= MOBILE_BREAKPOINT_PX;
  return coarsePointer && compactPhysicalViewport;
}

export function useMobileExperience() {
  const [mobile, setMobile] = useState(isCurrentMobileExperience);

  useEffect(() => {
    const media = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX}px)`);
    const pointer = window.matchMedia('(pointer: coarse)');
    const refresh = () => setMobile(isCurrentMobileExperience());

    media.addEventListener('change', refresh);
    pointer.addEventListener('change', refresh);
    window.addEventListener('resize', refresh);
    window.addEventListener('popstate', refresh);

    return () => {
      media.removeEventListener('change', refresh);
      pointer.removeEventListener('change', refresh);
      window.removeEventListener('resize', refresh);
      window.removeEventListener('popstate', refresh);
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.mfMobile = mobile ? 'true' : 'false';
    return () => {
      delete document.documentElement.dataset.mfMobile;
    };
  }, [mobile]);

  return mobile;
}

export function openDesktopExperience() {
  window.sessionStorage.setItem(DESKTOP_OVERRIDE_KEY, '1');
  window.location.assign('/app?desktop=1');
}
