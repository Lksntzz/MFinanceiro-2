const PLUGGY_CONNECT_SCRIPT_ID = 'mf-pluggy-connect-sdk';
const PLUGGY_CONNECT_SCRIPT_URL =
  'https://cdn.pluggy.ai/pluggy-connect/v2.13.0/pluggy-connect.js';

export type PluggyConnector = {
  id?: number | string | null;
  name?: string | null;
  primaryColor?: string | null;
};

export type PluggyItem = {
  id: string;
  connector?: PluggyConnector | null;
  executionStatus?: string | null;
  status?: string | null;
};

export type PluggyConnectEvent = {
  event?: string;
  timestamp?: number;
  connector?: PluggyConnector | null;
  item?: PluggyItem | null;
};

export type PluggyConnectError = {
  message?: string;
  data?: {
    item?: PluggyItem | null;
  } | null;
};

export type PluggyConnectSuccess =
  | {
      item?: PluggyItem | null;
    }
  | PluggyItem;

export type PluggyConnectOptions = {
  connectToken: string;
  includeSandbox?: boolean;
  allowConnectInBackground?: boolean;
  allowFullscreen?: boolean;
  updateItem?: string;
  language?: 'pt' | 'en' | 'es';
  theme?: 'light' | 'dark';
  forceOauthInBrowser?: boolean;
  onSuccess?: (data: PluggyConnectSuccess) => void | Promise<void>;
  onError?: (error: PluggyConnectError) => void | Promise<void>;
  onOpen?: () => void | Promise<void>;
  onClose?: () => void | Promise<void>;
  onEvent?: (payload: PluggyConnectEvent) => void | Promise<void>;
};

export type PluggyConnectInstance = {
  init: () => Promise<void>;
  show?: () => Promise<void>;
  hide?: () => Promise<void>;
  destroy?: () => Promise<void>;
};

type PluggyConnectConstructor = new (
  options: PluggyConnectOptions,
) => PluggyConnectInstance;

declare global {
  interface Window {
    PluggyConnect?: PluggyConnectConstructor;
  }
}

let loader: Promise<PluggyConnectConstructor> | null = null;

function resolveConstructor(): PluggyConnectConstructor | null {
  return typeof window !== 'undefined' &&
    typeof window.PluggyConnect === 'function'
    ? window.PluggyConnect
    : null;
}

export async function loadPluggyConnect(): Promise<PluggyConnectConstructor> {
  const ready = resolveConstructor();
  if (ready) return ready;
  if (loader) return loader;

  loader = new Promise<PluggyConnectConstructor>((resolve, reject) => {
    const existing = document.getElementById(
      PLUGGY_CONNECT_SCRIPT_ID,
    ) as HTMLScriptElement | null;

    const finish = () => {
      const Constructor = resolveConstructor();
      if (Constructor) resolve(Constructor);
      else
        reject(
          new Error(
            'O Pluggy Connect foi carregado, mas o SDK não ficou disponível.',
          ),
        );
    };

    if (existing) {
      if (existing.dataset.loaded === 'true') {
        finish();
        return;
      }
      existing.addEventListener('load', finish, { once: true });
      existing.addEventListener(
        'error',
        () => reject(new Error('Não foi possível carregar o Pluggy Connect.')),
        { once: true },
      );
      return;
    }

    const script = document.createElement('script');
    script.id = PLUGGY_CONNECT_SCRIPT_ID;
    script.src = PLUGGY_CONNECT_SCRIPT_URL;
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.addEventListener(
      'load',
      () => {
        script.dataset.loaded = 'true';
        finish();
      },
      { once: true },
    );
    script.addEventListener(
      'error',
      () => reject(new Error('Não foi possível carregar o Pluggy Connect.')),
      { once: true },
    );
    document.head.appendChild(script);
  }).catch((error) => {
    loader = null;
    throw error;
  });

  return loader;
}

export async function createPluggyConnect(
  options: PluggyConnectOptions,
): Promise<PluggyConnectInstance> {
  const Constructor = await loadPluggyConnect();
  return new Constructor(options);
}

export function extractPluggyItem(
  payload: PluggyConnectSuccess | PluggyConnectError | null | undefined,
): PluggyItem | null {
  if (!payload || typeof payload !== 'object') return null;
  const maybeSuccess = payload as { item?: PluggyItem | null; id?: string };
  if (maybeSuccess.item?.id) return maybeSuccess.item;
  if (typeof maybeSuccess.id === 'string') return maybeSuccess as PluggyItem;
  const maybeError = payload as PluggyConnectError;
  return maybeError.data?.item?.id ? maybeError.data.item : null;
}
