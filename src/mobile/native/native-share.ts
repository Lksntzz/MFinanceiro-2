import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor, registerPlugin } from '@capacitor/core';

import { saveMobileSharedPayload, type MobileSharedFile } from '../lib/mobile-share-store';

type NativeSharePayload = {
  pending: boolean;
  id?: string;
  createdAt?: number;
  title?: string;
  text?: string;
  fileUri?: string;
  fileName?: string;
  mimeType?: string;
  size?: number;
  error?: string;
};

type NativeShareReceiverPlugin = {
  getPendingShare(): Promise<NativeSharePayload>;
  clearPendingShare(): Promise<void>;
};

const NativeShareReceiver = registerPlugin<NativeShareReceiverPlugin>('NativeShareReceiver');

let bridgeInstalled = false;
let processingShare = false;
let lastHandledId = '';

function navigateToShareRoute(path: string) {
  const current = `${window.location.pathname}${window.location.search}`;
  if (current === path) return;
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

async function sharedFileFromNativeUri(payload: NativeSharePayload): Promise<MobileSharedFile | null> {
  const fileUri = String(payload.fileUri || '').trim();
  if (!fileUri) return null;

  const localUrl = Capacitor.convertFileSrc(fileUri);
  const response = await fetch(localUrl, { cache: 'no-store' });
  if (!response.ok) throw new Error('O arquivo compartilhado não pôde ser aberto pelo app.');

  const blob = await response.blob();
  const name = String(payload.fileName || '').trim() || 'documento-compartilhado';
  const type = String(payload.mimeType || '').trim() || blob.type || 'application/octet-stream';
  return {
    name,
    type,
    size: blob.size,
    lastModified: Number(payload.createdAt || Date.now()),
    blob,
  };
}

function nativeErrorRoute(message: string) {
  return message.includes('20 MB') ? '/share?error=too-large' : '/share?error=native';
}

async function clearNativePayload() {
  try {
    await NativeShareReceiver.clearPendingShare();
  } catch (clearError) {
    console.warn('MF native share cleanup could not be completed:', clearError);
  }
}

async function checkPendingNativeShare() {
  if (processingShare || Capacitor.getPlatform() !== 'android') return;
  processingShare = true;

  try {
    const payload = await NativeShareReceiver.getPendingShare();
    const id = String(payload.id || '').trim();
    if (!payload.pending || !id || id === lastHandledId) return;

    const nativeError = String(payload.error || '').trim();
    if (nativeError) {
      lastHandledId = id;
      await clearNativePayload();
      navigateToShareRoute(nativeErrorRoute(nativeError));
      return;
    }

    const file = await sharedFileFromNativeUri(payload);
    const title = String(payload.title || '').trim();
    const text = String(payload.text || '').trim();
    if (!file && !title && !text) {
      lastHandledId = id;
      await clearNativePayload();
      navigateToShareRoute('/share?error=no-content');
      return;
    }

    await saveMobileSharedPayload({
      id,
      createdAt: Number(payload.createdAt || Date.now()),
      title,
      text,
      url: '',
      files: file ? [file] : [],
    });

    lastHandledId = id;
    await clearNativePayload();
    navigateToShareRoute(`/share?id=${encodeURIComponent(id)}`);
  } catch (shareError) {
    // Keep the native payload when hydration/storage fails so a later resume can retry it.
    console.warn('MF native share could not be resolved:', shareError);
  } finally {
    processingShare = false;
  }
}

export async function installNativeShareBridge() {
  if (bridgeInstalled || !Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return;
  bridgeInstalled = true;

  await checkPendingNativeShare();
  await CapacitorApp.addListener('resume', () => {
    void checkPendingNativeShare();
  });
}
