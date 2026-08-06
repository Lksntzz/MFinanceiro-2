const originalFetch = globalThis.fetch.bind(globalThis);

let installed = false;

function getRequestHeaders(input: RequestInfo | URL, init?: RequestInit) {
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  if (init?.headers) {
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  }
  return headers;
}

function readUserId(body: BodyInit | null | undefined): string | null {
  if (typeof body !== 'string') return null;

  try {
    const parsed = JSON.parse(body);
    const record = Array.isArray(parsed) ? parsed[0] : parsed;
    return typeof record?.user_id === 'string' ? record.user_id : null;
  } catch {
    return null;
  }
}

export function installSettingsConflictRecovery() {
  if (installed) return;
  installed = true;

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await originalFetch(input, init);
    const requestUrl = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
    const method = String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();

    if (
      response.status !== 409 ||
      method !== 'POST' ||
      !requestUrl.includes('/rest/v1/mf_user_settings')
    ) {
      return response;
    }

    const userId = readUserId(init?.body);
    if (!userId) return response;

    try {
      const recoveryUrl = new URL(requestUrl);
      recoveryUrl.searchParams.delete('columns');
      recoveryUrl.searchParams.set('select', '*');
      recoveryUrl.searchParams.set('user_id', `eq.${userId}`);

      const headers = getRequestHeaders(input, init);
      headers.set('Accept', 'application/vnd.pgrst.object+json');
      headers.delete('Prefer');
      headers.delete('Content-Type');

      const existing = await originalFetch(recoveryUrl.toString(), {
        method: 'GET',
        headers,
      });

      if (!existing.ok) return response;

      return new Response(await existing.text(), {
        status: 200,
        statusText: 'OK',
        headers: existing.headers,
      });
    } catch (error) {
      console.warn('Não foi possível recuperar a configuração existente:', error);
      return response;
    }
  };
}

installSettingsConflictRecovery();
