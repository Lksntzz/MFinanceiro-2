import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor, registerPlugin } from '@capacitor/core';

import { MOBILE_ROUTES } from '../routes';

export const NATIVE_SHARE_CAPTURE_EVENT = 'mf:native-share-capture';

export type NativeShareCapture = {
  id: string;
  title: string;
  text: string;
  file: File | null;
  error: string;
};

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

let pendingCapture: NativeShareCapture | null = null;
let bridgeInstalled = false;
let processingShare = false;
let lastHandledId = '';

function navigateToScan() {
  const current = `${window.location.pathname}${window.location.search}`;
  if (current === MOBILE_ROUTES.scan) return;
  window.history.pushState({}, '', MOBILE_ROUTES.scan);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

async function fileFromNativeUri(payload: NativeSharePayload) {
  const fileUri = String(payload.fileUri || '').trim();
  if (!fileUri) return null;

  const localUrl = Capacitor.convertFileSrc(fileUri);
  const response = await fetch(localUrl, { cache: 'no-store' });
  if (!response.ok) throw new Error('O arquivo compartilhado não pôde ser aberto pelo app.');

  const blob = await response.blob();
  const name = String(payload.fileName || '').trim() || 'documento-compartilhado';
  const type = String(payload.mimeType || '').trim() || blob.type || 'application/octet-stream';
  return new File([blob], name, {
    type,
    lastModified: Number(payload.createdAt || Date.now()),
  });
}

function publishCapture(capture: NativeShareCapture) {
  pendingCapture = capture;
  navigateToScan();
  window.dispatchEvent(new CustomEvent<NativeShareCapture>(NATIVE_SHARE_CAPTURE_EVENT, { detail: capture }));
}

async function checkPendingNativeShare() {
  if (processingShare || Capacitor.getPlatform() !== 'android') return;
  processingShare = true;

  try {
    const payload = await NativeShareReceiver.getPendingShare();
    const id = String(payload.id || '').trim();
    if (!payload.pending || !id || id === lastHandledId) return;

    let file: File | null = null;
    let error = String(payload.error || '').trim();
    if (!error && payload.fileUri) {
      try {
        file = await fileFromNativeUri(payload);
      } catch (fileError: any) {
        error = fileError?.message || 'Não foi possível abrir o arquivo compartilhado.';
      }
    }

    const capture: NativeShareCapture = {
      id,
      title: String(payload.title || '').trim(),
      text: String(payload.text || '').trim(),
      file,
      error,
    };

    lastHandledId = id;
    try {
      await NativeShareReceiver.clearPendingShare();
    } catch (clearError) {
      console.warn('MF native share cleanup could not be completed:', clearError);
    }

    publishCapture(capture);
  } catch (shareError) {
    console.warn('MF native share could not be resolved:', shareError);
  } finally {
    processingShare = false;
  }
}

export function getPendingNativeShareCapture() {
  return pendingCapture;
}

export function clearPendingNativeShareCapture(id?: string) {
  if (!pendingCapture) return;
  if (id && pendingCapture.id !== id) return;
  pendingCapture = null;
}

export async function installNativeShareBridge() {
  if (bridgeInstalled || !Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return;
  bridgeInstalled = true;

  await checkPendingNativeShare();
  await CapacitorApp.addListener('resume', () => {
    void checkPendingNativeShare();
  });
}
