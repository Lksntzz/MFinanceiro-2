import { App as CapacitorApp, type URLOpenListenerEvent } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';

import { MOBILE_ROUTES } from '../routes';

const PRODUCTION_HOSTS = new Set(['mfinanceiro.com.br', 'www.mfinanceiro.com.br']);

const NATIVE_DESTINATIONS: Record<string, string> = {
  '': MOBILE_ROUTES.home,
  home: MOBILE_ROUTES.home,
  inicio: MOBILE_ROUTES.home,
  quick: MOBILE_ROUTES.quick,
  lancar: MOBILE_ROUTES.quick,
  scan: MOBILE_ROUTES.scan,
  voice: MOBILE_ROUTES.voice,
  pulse: MOBILE_ROUTES.pulse,
  inbox: MOBILE_ROUTES.documentInbox,
  documentos: MOBILE_ROUTES.documentInbox,
  cartoes: MOBILE_ROUTES.cards,
};

function normalizeNativeDestination(value: string) {
  return value
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .toLocaleLowerCase('pt-BR');
}

export function nativeUrlToPath(rawUrl: string): string | null {
  if (!rawUrl?.trim()) return null;

  try {
    const url = new URL(rawUrl);

    if (url.protocol === 'mfinanceiro:') {
      const destination = normalizeNativeDestination(`${url.hostname}${url.pathname}`);
      const mapped = NATIVE_DESTINATIONS[destination];
      return mapped ? `${mapped}${url.search}` : null;
    }

    if ((url.protocol === 'https:' || url.protocol === 'http:') && PRODUCTION_HOSTS.has(url.hostname.toLocaleLowerCase('pt-BR'))) {
      const pathname = url.pathname || '/';
      if (pathname === '/' || pathname === '/app') return `${MOBILE_ROUTES.home}${url.search}`;
      if (pathname === '/quick') return `${MOBILE_ROUTES.quick}${url.search}`;
      if (pathname === '/scan') return `${MOBILE_ROUTES.scan}${url.search}`;
      if (pathname === '/voice') return `${MOBILE_ROUTES.voice}${url.search}`;
      if (pathname === MOBILE_ROUTES.pulse) return `${MOBILE_ROUTES.pulse}${url.search}`;
      if (pathname === MOBILE_ROUTES.documentInbox) return `${MOBILE_ROUTES.documentInbox}${url.search}`;
      if (pathname.startsWith(MOBILE_ROUTES.cards)) return `${pathname}${url.search}`;
      return null;
    }
  } catch {
    return null;
  }

  return null;
}

function navigateNativeUrl(rawUrl: string) {
  const nextPath = nativeUrlToPath(rawUrl);
  if (!nextPath) return;
  const current = `${window.location.pathname}${window.location.search}`;
  if (current === nextPath) return;
  window.history.pushState({}, '', nextPath);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

let bridgeInstalled = false;

export async function installNativeDeepLinkBridge() {
  if (bridgeInstalled || !Capacitor.isNativePlatform()) return;
  bridgeInstalled = true;

  try {
    const launch = await CapacitorApp.getLaunchUrl();
    if (launch?.url) navigateNativeUrl(launch.url);
  } catch (error) {
    console.warn('MF native launch URL could not be resolved:', error);
  }

  await CapacitorApp.addListener('appUrlOpen', (event: URLOpenListenerEvent) => {
    navigateNativeUrl(event.url);
  });
}
