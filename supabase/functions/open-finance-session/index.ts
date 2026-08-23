import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from '@supabase/supabase-js';
import {
  createApiKey,
  createConnectToken,
  deleteItem,
  pluggyConfigured,
} from '../_shared/pluggy.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function readSupabaseKey(
  jsonName: string,
  directName: string,
  legacyName: string,
) {
  const direct = Deno.env.get(directName);
  if (direct) return direct;
  const encoded = Deno.env.get(jsonName);
  if (encoded) {
    try {
      const keys = JSON.parse(encoded) as Record<string, unknown>;
      if (typeof keys.default === 'string') return keys.default;
    } catch {
      // Fall through.
    }
  }
  return Deno.env.get(legacyName) || '';
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS')
    return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST')
    return json({ error: 'Método não permitido.' }, 405);

  const authorization = request.headers.get('Authorization');
  const token = authorization?.replace(/^Bearer\s+/i, '');
  if (!authorization || !token)
    return json({ error: 'Autenticação necessária.' }, 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const publishableKey = readSupabaseKey(
    'SUPABASE_PUBLISHABLE_KEYS',
    'SUPABASE_PUBLISHABLE_KEY',
    'SUPABASE_ANON_KEY',
  );
  const secretKey = readSupabaseKey(
    'SUPABASE_SECRET_KEYS',
    'SUPABASE_SECRET_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
  );
  if (!supabaseUrl || !publishableKey)
    return json({ error: 'Supabase não configurado na função.' }, 500);

  const supabase = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } =
    await supabase.auth.getUser(token);
  if (userError || !userData.user)
    return json({ error: 'Sessão inválida.' }, 401);

  try {
    const body = (await request.json().catch(() => ({}))) as {
      action?: 'connect' | 'token' | 'bind' | 'revoke';
      connectionId?: string;
      itemId?: string;
      institutionId?: string;
      institutionName?: string;
      displayName?: string;
      scopes?: string[];
    };
    const action = body.action || 'connect';

    if (!pluggyConfigured()) {
      return json(
        {
          configured: false,
          provider: 'pluggy',
          error:
            'Pluggy ainda não foi configurado. Defina PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET nos secrets do Supabase.',
        },
        503,
      );
    }

    if (action === 'token' || action === 'connect') {
      const apiKey = await createApiKey();
      const webhookBase = (
        Deno.env.get('OPEN_FINANCE_WEBHOOK_URL') ||
        `${supabaseUrl}/functions/v1/open-finance-webhook`
      ).trim();
      const webhookSecret = (
        Deno.env.get('OPEN_FINANCE_WEBHOOK_SECRET') || ''
      ).trim();
      const webhookUrl = webhookSecret
        ? `${webhookBase}${webhookBase.includes('?') ? '&' : '?'}token=${encodeURIComponent(webhookSecret)}`
        : webhookBase;
      const connectToken = await createConnectToken(
        apiKey,
        userData.user.id,
        webhookUrl,
        body.itemId || null,
      );
      return json({
        configured: true,
        provider: 'pluggy',
        connectToken,
        accessToken: connectToken,
        expiresInSeconds: 1800,
      });
    }

    if (action === 'bind') {
      const itemId = String(body.itemId || '').trim();
      if (!/^[0-9a-f-]{36}$/i.test(itemId))
        throw new Error('Item Pluggy inválido.');
      const institutionName = String(
        body.institutionName || body.displayName || 'Instituição conectada',
      ).trim();
      const scopes =
        Array.isArray(body.scopes) && body.scopes.length
          ? body.scopes
          : ['ACCOUNTS_READ', 'TRANSACTIONS_READ'];

      const { data: existing } = await supabase
        .from('mf_bank_connections')
        .select('id')
        .eq('user_id', userData.user.id)
        .eq('provider', 'pluggy')
        .eq('provider_connection_ref', itemId)
        .maybeSingle();

      if (existing?.id)
        return json({
          configured: true,
          provider: 'pluggy',
          connectionId: existing.id,
          itemId,
          status: 'active',
        });

      const { data: prepared, error: prepareError } = await supabase.rpc(
        'mf_prepare_bank_connection',
        {
          p_provider: 'pluggy',
          p_institution_id: String(body.institutionId || '').trim() || null,
          p_institution_name: institutionName,
          p_scopes: scopes,
        },
      );
      if (prepareError) throw prepareError;
      const connectionId = String(
        (prepared as Record<string, unknown>)?.connection_id || '',
      );
      if (!connectionId)
        throw new Error('Não foi possível registrar a conexão.');

      const { error: updateError } = await supabase
        .from('mf_bank_connections')
        .update({
          status: 'active',
          sync_status: 'idle',
          provider_connection_ref: itemId,
          display_name: body.displayName || institutionName,
          last_error: null,
          metadata: { provider: 'pluggy', bound_at: new Date().toISOString() },
        })
        .eq('id', connectionId)
        .eq('user_id', userData.user.id);
      if (updateError) throw updateError;

      return json({
        configured: true,
        provider: 'pluggy',
        connectionId,
        itemId,
        status: 'active',
      });
    }

    if (action === 'revoke') {
      const connectionId = String(body.connectionId || '').trim();
      if (!/^[0-9a-f-]{36}$/i.test(connectionId))
        throw new Error('Identificador da conexão inválido.');
      if (!secretKey)
        throw new Error('Chave administrativa do Supabase não configurada.');

      const { data: connection, error: connectionError } = await supabase
        .from('mf_bank_connections')
        .select('id,status,provider,provider_connection_ref')
        .eq('id', connectionId)
        .eq('user_id', userData.user.id)
        .single();
      if (connectionError || !connection)
        throw new Error('Conexão não encontrada.');
      if (connection.status === 'revoked')
        return json({ connectionId, status: 'revoked', alreadyRevoked: true });
      if (
        connection.provider !== 'pluggy' ||
        !connection.provider_connection_ref
      )
        throw new Error('Conexão sem referência Pluggy válida.');

      const apiKey = await createApiKey();
      await deleteItem(apiKey, connection.provider_connection_ref);

      const admin = createClient(supabaseUrl, secretKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { error: revokeError } = await admin
        .from('mf_bank_connections')
        .update({
          status: 'revoked',
          sync_status: 'idle',
          last_error: null,
          next_sync_at: null,
        })
        .eq('id', connectionId)
        .eq('user_id', userData.user.id);
      if (revokeError) throw revokeError;

      return json({ connectionId, status: 'revoked', alreadyRevoked: false });
    }

    throw new Error('Ação Open Finance inválida.');
  } catch (error) {
    return json(
      {
        error:
          error instanceof Error ? error.message : 'Falha no Open Finance.',
      },
      400,
    );
  }
});
