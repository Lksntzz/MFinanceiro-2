const PLUGGY_CONNECT_SCRIPT_ID = 'mf-pluggy-connect-sdk';
const PLUGGY_CONNECT_SCRIPT_URL = 'https://cdn.pluggy.ai/pluggy-connect/v2.7.0/pluggy-connect.js';

export type PluggyConnectItem = {
  id: string;
  executionStatus?: string;
  [key: string]: unknown;
};

type PluggySuccessPayload = { item?: PluggyConnectItem } | PluggyConnectItem;
type PluggyErrorPayload = { message?: string; data?: { item?: PluggyConnectItem } };

type PluggyConnectConfig = {
  connectToken: string;
  includeSandbox?: boolean;
  allowConnectInBackground?: boolean;
  updateItem?: string;
  connectorIds?: number[];
  countries?: string[];
  language?: string;
  theme?: 'light' | 'dark';
  products?: string[];
  onSuccess?: (payload: PluggySuccessPayload) => void | Promise<void>;
  onError?: (payload: PluggyErrorPayload) => void | Promise<void>;
  onClose?: () => void | Promise<void>;
};

declare global {
  interface Window {
    PluggyConnect?: new (config: PluggyConnectConfig) => { init(): void };
  }
}

let loadingPromise: Promise<void> | null = null;

export function extractPluggyItem(payload: PluggySuccessPayload | undefined | null): PluggyConnectItem | null {
  if (!payload || typeof payload !== 'object') return null;
  const item = 'item' in payload ? payload.item : payload;
  return item && typeof item.id === 'string' ? item : null;
}

export function loadPluggyConnect() {
  if (window.PluggyConnect) return Promise.resolve();
  if (loadingPromise) return loadingPromise;

  loadingPromise = new Promise<void>((resolve, reject) => {
    const existing = document.getElementById(PLUGGY_CONNECT_SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Não foi possível carregar o conector Open Finance.')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.id = PLUGGY_CONNECT_SCRIPT_ID;
    script.src = PLUGGY_CONNECT_SCRIPT_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Não foi possível carregar o conector Open Finance.'));
    document.head.appendChild(script);
  }).finally(() => {
    if (!window.PluggyConnect) loadingPromise = null;
  });

  return loadingPromise;
}

export async function openPluggyConnect(config: {
  connectToken: string;
  updateItem?: string | null;
  connectorIds?: number[];
  onSuccess: (item: PluggyConnectItem) => void | Promise<void>;
  onError?: (message: string, item?: PluggyConnectItem) => void | Promise<void>;
  onClose?: () => void | Promise<void>;
}) {
  await loadPluggyConnect();
  if (!window.PluggyConnect) throw new Error('Pluggy Connect indisponível.');

  const widget = new window.PluggyConnect({
    connectToken: config.connectToken,
    includeSandbox: false,
    allowConnectInBackground: true,
    updateItem: config.updateItem || undefined,
    connectorIds: config.connectorIds?.length ? config.connectorIds : undefined,
    countries: ['BR'],
    language: 'pt',
    theme: 'dark',
    products: ['ACCOUNTS', 'CREDIT_CARDS', 'TRANSACTIONS'],
    onSuccess: async (payload) => {
      const item = extractPluggyItem(payload);
      if (!item) {
        await config.onError?.('A Pluggy concluiu a conexão sem retornar o identificador da instituição.');
        return;
      }
      await config.onSuccess(item);
    },
    onError: async (error) => {
      const item = error?.data?.item;
      await config.onError?.(error?.message || 'A conexão Open Finance não foi concluída.', item);
    },
    onClose: config.onClose,
  });

  widget.init();
}
