import {
  AlertCircle,
  Bot,
  CheckCircle2,
  Clock3,
  Landmark,
  Loader2,
  Plus,
  RefreshCw,
  RotateCw,
  Save,
  ShieldCheck,
  Trash2,
  Unplug,
  WandSparkles,
  X,
} from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  createPluggyConnect,
  extractPluggyItem,
  type PluggyConnectError,
  type PluggyConnectEvent,
  type PluggyConnectInstance,
  type PluggyConnector,
} from '../lib/pluggy-connect';
import { supabase } from '../lib/supabase';
import type {
  BankConnection,
  BankSyncRun,
  CategorizationRule,
  FinancialAccount,
  TransactionCategory,
} from '../types';

interface AutomationCenterProps {
  userId: string;
  accounts: FinancialAccount[];
  categories: TransactionCategory[];
}

type RuleForm = {
  name: string;
  matchField: CategorizationRule['match_field'];
  matchOperator: CategorizationRule['match_operator'];
  matchValue: string;
  transactionType: '' | 'income' | 'expense';
  accountId: string;
  categoryId: string;
  priority: string;
};

type ProviderConnection = BankConnection & {
  provider_connection_ref?: string | null;
  metadata?: Record<string, unknown> | null;
};

const emptyRule = (categories: TransactionCategory[]): RuleForm => ({
  name: '',
  matchField: 'description',
  matchOperator: 'contains',
  matchValue: '',
  transactionType: '',
  accountId: '',
  categoryId: categories.find((item) => item.is_active)?.id || '',
  priority: '100',
});

const statusLabels: Record<BankConnection['status'], string> = {
  pending: 'Preparada',
  authorizing: 'Aguardando autorização',
  active: 'Ativa',
  expiring: 'Consentimento expirando',
  expired: 'Consentimento expirado',
  revocation_pending: 'Revogação solicitada',
  revoked: 'Revogada',
  error: 'Com erro',
};

const syncLabels: Record<BankConnection['sync_status'], string> = {
  idle: 'Em dia',
  queued: 'Na fila',
  syncing: 'Sincronizando',
  completed: 'Concluída',
  partial: 'Parcial',
  error: 'Com erro',
};

function formatDate(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('pt-BR');
}

function isAuthorizationPending(error: PluggyConnectError) {
  const status = String(error.data?.item?.executionStatus || '').toUpperCase();
  return (
    status === 'USER_AUTHORIZATION_PENDING' || status === 'WAITING_USER_INPUT'
  );
}

export default function AutomationCenter({
  userId,
  accounts,
  categories,
}: AutomationCenterProps) {
  const [activeTab, setActiveTab] = useState<'rules' | 'connections'>('rules');
  const [rules, setRules] = useState<CategorizationRule[]>([]);
  const [connections, setConnections] = useState<ProviderConnection[]>([]);
  const [syncRuns, setSyncRuns] = useState<BankSyncRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [ruleForm, setRuleForm] = useState<RuleForm>(() =>
    emptyRule(categories),
  );
  const [showRuleForm, setShowRuleForm] = useState(false);
  const [preparingConnection, setPreparingConnection] = useState(false);
  const [busyConnectionId, setBusyConnectionId] = useState<string | null>(null);
  const widgetRef = useRef<PluggyConnectInstance | null>(null);
  const selectedConnectorRef = useRef<PluggyConnector | null>(null);

  const categoryNames = useMemo(
    () => new Map(categories.map((category) => [category.id, category.name])),
    [categories],
  );
  const accountNames = useMemo(
    () => new Map(accounts.map((account) => [account.id, account.name])),
    [accounts],
  );
  const includeSandbox = useMemo(() => {
    if (typeof window === 'undefined') return false;
    const hostname = window.location.hostname;
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname.endsWith('.vercel.app')
    );
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const [rulesResult, connectionsResult, runsResult] = await Promise.all([
      supabase
        .from('mf_categorization_rules')
        .select('*')
        .eq('user_id', userId)
        .order('priority', { ascending: false })
        .order('created_at'),
      supabase
        .from('mf_bank_connections')
        .select('*')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false }),
      supabase
        .from('mf_bank_sync_runs')
        .select(
          'id,connection_id,status,trigger_source,received_count,imported_count,duplicate_count,error_message,started_at,finished_at,created_at',
        )
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(30),
    ]);
    const firstError =
      rulesResult.error || connectionsResult.error || runsResult.error;
    if (firstError) setError(firstError.message);
    else {
      setRules((rulesResult.data || []) as CategorizationRule[]);
      setConnections((connectionsResult.data || []) as ProviderConnection[]);
      setSyncRuns((runsResult.data || []) as BankSyncRun[]);
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    void load();
    const channel = supabase
      .channel(`financial-automation-${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'mf_categorization_rules',
          filter: `user_id=eq.${userId}`,
        },
        () => void load(),
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'mf_bank_connections',
          filter: `user_id=eq.${userId}`,
        },
        () => void load(),
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'mf_bank_sync_runs',
          filter: `user_id=eq.${userId}`,
        },
        () => void load(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [load, userId]);

  useEffect(() => {
    return () => {
      const widget = widgetRef.current;
      widgetRef.current = null;
      if (widget?.destroy) void widget.destroy().catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (ruleForm.categoryId || categories.length === 0) return;
    setRuleForm((current) => ({
      ...current,
      categoryId: categories.find((item) => item.is_active)?.id || '',
    }));
  }, [categories, ruleForm.categoryId]);

  async function saveRule(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      if (!ruleForm.categoryId)
        throw new Error('Selecione a categoria aplicada pela regra.');
      const payload = {
        user_id: userId,
        name: ruleForm.name.trim(),
        priority: Number(ruleForm.priority || 100),
        match_field: ruleForm.matchField,
        match_operator: ruleForm.matchOperator,
        match_value: ruleForm.matchValue.trim(),
        transaction_type: ruleForm.transactionType || null,
        account_id: ruleForm.accountId || null,
        category_id: ruleForm.categoryId,
      };
      const { error: insertError } = await supabase
        .from('mf_categorization_rules')
        .insert(payload);
      if (insertError) throw insertError;
      setRuleForm(emptyRule(categories));
      setShowRuleForm(false);
      setMessage(
        'Regra criada. Ela será aplicada conforme a prioridade configurada.',
      );
      await load();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : 'Não foi possível salvar a regra.',
      );
    } finally {
      setSaving(false);
    }
  }

  async function toggleRule(rule: CategorizationRule) {
    const { error: updateError } = await supabase
      .from('mf_categorization_rules')
      .update({ is_active: !rule.is_active })
      .eq('id', rule.id)
      .eq('user_id', userId);
    if (updateError) setError(updateError.message);
    else await load();
  }

  async function deleteRule(rule: CategorizationRule) {
    if (!window.confirm(`Excluir a regra “${rule.name}”?`)) return;
    const { error: deleteError } = await supabase
      .from('mf_categorization_rules')
      .delete()
      .eq('id', rule.id)
      .eq('user_id', userId);
    if (deleteError) setError(deleteError.message);
    else await load();
  }

  async function syncConnection(
    connectionId: string,
    source: 'initial' | 'manual' = 'manual',
  ) {
    setBusyConnectionId(connectionId);
    setError(null);
    try {
      const { data, error: syncError } = await supabase.functions.invoke(
        'open-finance-sync',
        {
          body: { connectionId, triggerSource: source },
        },
      );
      if (syncError) throw syncError;
      if (data?.error) throw new Error(String(data.error));
      if (data?.alreadySyncing) {
        setMessage(
          'Essa instituição já está sincronizando. O resultado aparecerá automaticamente.',
        );
      } else {
        const imported = Number(data?.importedCount || 0);
        const duplicates = Number(data?.duplicateCount || 0);
        setMessage(
          `Sincronização concluída: ${imported} novo(s) lançamento(s) e ${duplicates} já existente(s).`,
        );
      }
      await load();
    } catch (syncError) {
      setError(
        syncError instanceof Error
          ? syncError.message
          : 'Não foi possível sincronizar a instituição.',
      );
    } finally {
      setBusyConnectionId(null);
    }
  }

  async function bindAndSync(
    itemId: string,
    connector: PluggyConnector | null,
  ) {
    const institutionName = String(
      connector?.name || 'Instituição conectada',
    ).trim();
    const institutionId = connector?.id == null ? null : String(connector.id);
    const { data: bindData, error: bindError } =
      await supabase.functions.invoke('open-finance-session', {
        body: {
          action: 'bind',
          itemId,
          institutionId,
          institutionName,
          displayName: institutionName,
          scopes: ['ACCOUNTS_READ', 'TRANSACTIONS_READ'],
        },
      });
    if (bindError) throw bindError;
    if (bindData?.error) throw new Error(String(bindData.error));
    const connectionId = String(bindData?.connectionId || '');
    if (!connectionId)
      throw new Error('O MF Financeiro não recebeu a referência da conexão.');

    setMessage(
      `${institutionName} conectada. Importando contas e movimentações...`,
    );
    await load();
    await syncConnection(connectionId, 'initial');
  }

  async function launchOpenFinance(connection?: ProviderConnection) {
    if (preparingConnection || busyConnectionId) return;
    const itemId = String(connection?.provider_connection_ref || '').trim();
    if (connection && !itemId) {
      setError(
        'Essa conexão antiga não possui a referência necessária para renovar o acesso.',
      );
      return;
    }

    setPreparingConnection(true);
    setError(null);
    setMessage(null);
    selectedConnectorRef.current = null;

    try {
      const { data, error: tokenError } = await supabase.functions.invoke(
        'open-finance-session',
        {
          body: { action: 'token', itemId: itemId || undefined },
        },
      );
      if (tokenError) throw tokenError;
      if (data?.error) throw new Error(String(data.error));
      const connectToken = String(
        data?.connectToken || data?.accessToken || '',
      );
      if (!connectToken)
        throw new Error(
          'O servidor não retornou o token temporário do Open Finance.',
        );

      let instance: PluggyConnectInstance | null = null;
      instance = await createPluggyConnect({
        connectToken,
        includeSandbox,
        allowConnectInBackground: true,
        allowFullscreen: true,
        updateItem: itemId || undefined,
        language: 'pt',
        theme: 'dark',
        forceOauthInBrowser: true,
        onEvent: (payload: PluggyConnectEvent) => {
          if (
            String(payload.event || '').toUpperCase() ===
              'SELECTED_INSTITUTION' &&
            payload.connector
          ) {
            selectedConnectorRef.current = payload.connector;
          }
        },
        onSuccess: async (payload) => {
          const item = extractPluggyItem(payload);
          if (!item?.id) {
            setError(
              'A instituição concluiu o fluxo, mas não retornou um Item válido.',
            );
            return;
          }
          const connector = item.connector || selectedConnectorRef.current;
          try {
            await bindAndSync(item.id, connector || null);
          } catch (successError) {
            setError(
              successError instanceof Error
                ? successError.message
                : 'A conexão foi autorizada, mas não foi possível importar os dados.',
            );
            await load();
          }
        },
        onError: async (widgetError) => {
          const item = extractPluggyItem(widgetError);
          if (isAuthorizationPending(widgetError)) {
            const connector = item?.connector || selectedConnectorRef.current;
            setMessage(
              `A autorização ainda está pendente${connector?.name ? ` em ${connector.name}` : ''}. Você pode fechar esta tela; o webhook continuará acompanhando a conclusão.`,
            );
          } else {
            setError(
              widgetError.message ||
                'A instituição não concluiu a conexão Open Finance.',
            );
          }
          await load();
        },
        onClose: async () => {
          setPreparingConnection(false);
          selectedConnectorRef.current = null;
          if (widgetRef.current === instance) widgetRef.current = null;
          await load();
        },
      });
      widgetRef.current = instance;
      await instance.init();
    } catch (connectionError) {
      setPreparingConnection(false);
      setError(
        connectionError instanceof Error
          ? connectionError.message
          : 'Não foi possível abrir o Open Finance.',
      );
    }
  }

  async function requestRevocation(connection: ProviderConnection) {
    if (
      !window.confirm(
        `Revogar o acesso de ${connection.institution_name}? A instituição deixará de sincronizar novos dados.`,
      )
    )
      return;
    setBusyConnectionId(connection.id);
    setError(null);
    try {
      const { data, error: functionError } = await supabase.functions.invoke(
        'open-finance-session',
        {
          body: { action: 'revoke', connectionId: connection.id },
        },
      );
      if (functionError) throw functionError;
      if (data?.error) throw new Error(String(data.error));
      setMessage(
        'Acesso revogado no provedor. Os dados já importados permanecem no seu histórico financeiro.',
      );
      await load();
    } catch (revokeError) {
      setError(
        revokeError instanceof Error
          ? revokeError.message
          : 'Não foi possível revogar a conexão.',
      );
    } finally {
      setBusyConnectionId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-64 items-center justify-center gap-2 text-xs text-white/40">
        <Loader2 size={16} className="animate-spin" /> Carregando automações...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-black">
            <Bot size={19} className="text-brand-primary" /> Automação e
            conexões
          </h2>
          <p className="mt-1 text-[10px] text-white/35">
            Regras determinísticas, consentimentos Open Finance e sincronização
            auditável.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-xl border border-white/10 p-2 text-white/45"
          aria-label="Atualizar automações"
        >
          <RefreshCw size={15} />
        </button>
      </div>

      {(error || message) && (
        <div
          className={`flex items-start justify-between gap-3 rounded-xl border p-3 text-xs ${error ? 'border-red-500/25 bg-red-500/10 text-red-200' : 'border-green-500/25 bg-green-500/10 text-green-200'}`}
          role={error ? 'alert' : 'status'}
          aria-live="polite"
        >
          <span className="flex items-start gap-2">
            {error ? <AlertCircle size={15} /> : <CheckCircle2 size={15} />}
            {error || message}
          </span>
          <button
            type="button"
            onClick={() => {
              setError(null);
              setMessage(null);
            }}
            aria-label="Fechar mensagem"
          >
            <X size={14} />
          </button>
        </div>
      )}

      <div
        className="mf-subnav"
        role="tablist"
        aria-label="Automação e Open Finance"
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'rules'}
          className={activeTab === 'rules' ? 'active' : ''}
          onClick={() => setActiveTab('rules')}
        >
          Regras automáticas
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'connections'}
          className={activeTab === 'connections' ? 'active' : ''}
          onClick={() => setActiveTab('connections')}
        >
          Open Finance
        </button>
      </div>

      {activeTab === 'rules' ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(280px,.75fr)]">
          <section className="glass-card !p-0 overflow-hidden">
            <div className="flex items-center justify-between border-b border-white/10 p-4">
              <div>
                <h3 className="text-sm font-bold">Regras de categorização</h3>
                <p className="mt-1 text-[9px] text-white/35">
                  Maior prioridade vence; regras manuais têm precedência sobre
                  padrões aprendidos.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowRuleForm((value) => !value)}
                className="flex items-center gap-2 rounded-xl bg-brand-primary px-3 py-2 text-xs font-black text-black"
              >
                <Plus size={14} /> Nova regra
              </button>
            </div>
            <div className="divide-y divide-white/5">
              {rules.map((rule) => (
                <div
                  key={rule.id}
                  className="flex flex-wrap items-center justify-between gap-3 p-4"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <strong className="truncate text-xs">{rule.name}</strong>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[8px] font-bold ${rule.is_active ? 'bg-green-500/10 text-green-300' : 'bg-white/5 text-white/30'}`}
                      >
                        {rule.is_active ? 'ATIVA' : 'PAUSADA'}
                      </span>
                    </div>
                    <p className="mt-1 text-[10px] text-white/40">
                      {rule.match_field} {rule.match_operator} “
                      {rule.match_value}” →{' '}
                      {categoryNames.get(rule.category_id) || 'Categoria'}
                      {rule.account_id
                        ? ` · ${accountNames.get(rule.account_id) || 'Conta'}`
                        : ''}
                    </p>
                    <p className="mt-1 text-[9px] text-white/25">
                      Prioridade {rule.priority} · {rule.hit_count}{' '}
                      aplicação(ões)
                      {rule.last_matched_at
                        ? ` · última ${formatDate(rule.last_matched_at)}`
                        : ''}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => void toggleRule(rule)}
                      className="rounded-lg border border-white/10 px-3 py-2 text-[10px] text-white/55"
                    >
                      {rule.is_active ? 'Pausar' : 'Ativar'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteRule(rule)}
                      className="rounded-lg border border-red-500/15 p-2 text-red-300"
                      aria-label={`Excluir ${rule.name}`}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
              {rules.length === 0 && (
                <div className="py-14 text-center text-xs text-white/30">
                  Nenhuma regra criada.
                </div>
              )}
            </div>
          </section>

          <section className="glass-card">
            {showRuleForm ? (
              <form onSubmit={saveRule} className="space-y-3">
                <h3 className="flex items-center gap-2 text-sm font-bold">
                  <WandSparkles size={15} className="text-brand-primary" /> Nova
                  regra
                </h3>
                <label className="block text-[9px] font-bold uppercase text-white/35">
                  Nome
                  <input
                    required
                    maxLength={120}
                    value={ruleForm.name}
                    onChange={(event) =>
                      setRuleForm({ ...ruleForm, name: event.target.value })
                    }
                    className="mt-1 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-xs text-white"
                  />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block text-[9px] font-bold uppercase text-white/35">
                    Campo
                    <select
                      value={ruleForm.matchField}
                      onChange={(event) =>
                        setRuleForm({
                          ...ruleForm,
                          matchField: event.target
                            .value as RuleForm['matchField'],
                        })
                      }
                      className="mt-1 w-full rounded-xl border border-white/10 bg-[#121212] px-3 py-2 text-xs text-white"
                    >
                      <option value="description">Descrição</option>
                      <option value="source">Origem</option>
                      <option value="description_or_source">
                        Descrição ou origem
                      </option>
                    </select>
                  </label>
                  <label className="block text-[9px] font-bold uppercase text-white/35">
                    Condição
                    <select
                      value={ruleForm.matchOperator}
                      onChange={(event) =>
                        setRuleForm({
                          ...ruleForm,
                          matchOperator: event.target
                            .value as RuleForm['matchOperator'],
                        })
                      }
                      className="mt-1 w-full rounded-xl border border-white/10 bg-[#121212] px-3 py-2 text-xs text-white"
                    >
                      <option value="contains">Contém</option>
                      <option value="starts_with">Começa com</option>
                      <option value="exact">É igual a</option>
                    </select>
                  </label>
                </div>
                <label className="block text-[9px] font-bold uppercase text-white/35">
                  Texto procurado
                  <input
                    required
                    minLength={2}
                    maxLength={160}
                    value={ruleForm.matchValue}
                    onChange={(event) =>
                      setRuleForm({
                        ...ruleForm,
                        matchValue: event.target.value,
                      })
                    }
                    className="mt-1 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-xs text-white"
                  />
                </label>
                <label className="block text-[9px] font-bold uppercase text-white/35">
                  Categoria
                  <select
                    required
                    value={ruleForm.categoryId}
                    onChange={(event) =>
                      setRuleForm({
                        ...ruleForm,
                        categoryId: event.target.value,
                      })
                    }
                    className="mt-1 w-full rounded-xl border border-white/10 bg-[#121212] px-3 py-2 text-xs text-white"
                  >
                    <option value="">Selecione</option>
                    {categories
                      .filter((item) => item.is_active)
                      .map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="block text-[9px] font-bold uppercase text-white/35">
                  Conta opcional
                  <select
                    value={ruleForm.accountId}
                    onChange={(event) =>
                      setRuleForm({
                        ...ruleForm,
                        accountId: event.target.value,
                      })
                    }
                    className="mt-1 w-full rounded-xl border border-white/10 bg-[#121212] px-3 py-2 text-xs text-white"
                  >
                    <option value="">Todas as contas</option>
                    {accounts
                      .filter((item) => item.is_active)
                      .map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                  </select>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block text-[9px] font-bold uppercase text-white/35">
                    Tipo
                    <select
                      value={ruleForm.transactionType}
                      onChange={(event) =>
                        setRuleForm({
                          ...ruleForm,
                          transactionType: event.target
                            .value as RuleForm['transactionType'],
                        })
                      }
                      className="mt-1 w-full rounded-xl border border-white/10 bg-[#121212] px-3 py-2 text-xs text-white"
                    >
                      <option value="">Ambos</option>
                      <option value="expense">Saída</option>
                      <option value="income">Entrada</option>
                    </select>
                  </label>
                  <label className="block text-[9px] font-bold uppercase text-white/35">
                    Prioridade
                    <input
                      type="number"
                      min="0"
                      max="10000"
                      value={ruleForm.priority}
                      onChange={(event) =>
                        setRuleForm({
                          ...ruleForm,
                          priority: event.target.value,
                        })
                      }
                      className="mt-1 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-xs text-white"
                    />
                  </label>
                </div>
                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setShowRuleForm(false)}
                    className="flex-1 rounded-xl border border-white/10 px-3 py-2 text-xs"
                  >
                    Cancelar
                  </button>
                  <button
                    disabled={saving}
                    className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-brand-primary px-3 py-2 text-xs font-black text-black disabled:opacity-50"
                  >
                    <Save size={14} />
                    {saving ? 'Salvando...' : 'Salvar'}
                  </button>
                </div>
              </form>
            ) : (
              <div className="flex min-h-64 flex-col items-center justify-center text-center text-white/35">
                <WandSparkles size={28} />
                <p className="mt-3 text-xs">
                  Crie regras para descrições recorrentes como mercado, aluguel
                  ou salário.
                </p>
              </div>
            )}
          </section>
        </div>
      ) : (
        <div className="space-y-4">
          <section className="glass-card grid gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
            <div className="flex gap-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-brand-primary/10 text-brand-primary">
                <Landmark size={21} />
              </div>
              <div>
                <h3 className="text-sm font-bold">
                  Conectar instituição pelo Open Finance
                </h3>
                <p className="mt-1 max-w-2xl text-[10px] leading-relaxed text-white/45">
                  A seleção do banco, consentimento, OAuth e autenticação
                  acontecem dentro do Pluggy Connect. O MF Financeiro recebe
                  apenas o identificador da conexão e os dados autorizados; suas
                  credenciais bancárias não passam pelo nosso frontend.
                </p>
                <div className="mt-2 flex flex-wrap gap-2 text-[9px] text-white/35">
                  <span className="rounded-full bg-white/5 px-2 py-1">
                    Contas
                  </span>
                  <span className="rounded-full bg-white/5 px-2 py-1">
                    Movimentações
                  </span>
                  <span className="rounded-full bg-white/5 px-2 py-1">
                    Sincronização por webhook
                  </span>
                  {includeSandbox && (
                    <span className="rounded-full bg-yellow-500/10 px-2 py-1 text-yellow-200">
                      Sandbox habilitado no preview
                    </span>
                  )}
                </div>
              </div>
            </div>
            <button
              type="button"
              disabled={preparingConnection || Boolean(busyConnectionId)}
              onClick={() => void launchOpenFinance()}
              className="flex items-center justify-center gap-2 rounded-xl bg-brand-primary px-5 py-3 text-xs font-black text-black disabled:opacity-40"
            >
              {preparingConnection ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Plus size={15} />
              )}{' '}
              Conectar instituição
            </button>
          </section>

          <div className="rounded-xl border border-green-500/15 bg-green-500/[0.04] p-3 text-[10px] text-white/50">
            <ShieldCheck size={14} className="mr-2 inline text-green-300" />
            Connect Tokens são temporários e gerados no servidor. `CLIENT_ID` e
            `CLIENT_SECRET` permanecem exclusivamente nos secrets do Supabase.
          </div>

          <section className="glass-card !p-0 overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 p-4">
              <div>
                <h3 className="text-sm font-bold">Instituições conectadas</h3>
                <p className="mt-1 text-[9px] text-white/35">
                  Consentimento e sincronização são acompanhados separadamente.
                </p>
              </div>
              <span className="text-[10px] text-white/35">
                {connections.filter((item) => item.status === 'active').length}{' '}
                ativa(s)
              </span>
            </div>
            <div className="divide-y divide-white/5">
              {connections.map((connection) => {
                const lastRun = syncRuns.find(
                  (run) => run.connection_id === connection.id,
                );
                const itemId = String(connection.provider_connection_ref || '');
                const busy = busyConnectionId === connection.id;
                const canUpdate =
                  Boolean(itemId) &&
                  !['revoked', 'revocation_pending'].includes(
                    connection.status,
                  );
                const canSync =
                  connection.status === 'active' && Boolean(itemId);
                return (
                  <article key={connection.id} className="p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <strong className="text-xs">
                            {connection.display_name ||
                              connection.institution_name}
                          </strong>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[8px] font-bold ${connection.status === 'active' ? 'bg-green-500/10 text-green-300' : connection.status === 'error' ? 'bg-red-500/10 text-red-300' : 'bg-yellow-500/10 text-yellow-200'}`}
                          >
                            {statusLabels[connection.status]}
                          </span>
                        </div>
                        <p className="mt-1 text-[9px] text-white/35">
                          Provedor: {connection.provider} · última sincronização{' '}
                          {formatDate(connection.last_synced_at)}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {canSync && (
                          <button
                            type="button"
                            disabled={busy || preparingConnection}
                            onClick={() => void syncConnection(connection.id)}
                            className="flex items-center gap-1.5 rounded-lg border border-brand-primary/20 px-3 py-2 text-[9px] text-brand-primary disabled:opacity-40"
                          >
                            {busy ? (
                              <Loader2 size={12} className="animate-spin" />
                            ) : (
                              <RefreshCw size={12} />
                            )}{' '}
                            Sincronizar
                          </button>
                        )}
                        {canUpdate && (
                          <button
                            type="button"
                            disabled={busy || preparingConnection}
                            onClick={() => void launchOpenFinance(connection)}
                            className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-[9px] text-white/60 disabled:opacity-40"
                          >
                            <RotateCw size={12} /> Atualizar acesso
                          </button>
                        )}
                        {!['revoked', 'revocation_pending'].includes(
                          connection.status,
                        ) && (
                          <button
                            type="button"
                            disabled={busy || preparingConnection}
                            onClick={() => void requestRevocation(connection)}
                            className="flex items-center gap-1.5 rounded-lg border border-red-500/15 px-3 py-2 text-[9px] text-red-300 disabled:opacity-40"
                          >
                            <Unplug size={12} /> Revogar
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-[9px] sm:grid-cols-4">
                      <div className="rounded-lg bg-white/5 p-2">
                        <span className="text-white/30">Sincronização</span>
                        <strong className="mt-1 block">
                          {syncLabels[connection.sync_status]}
                        </strong>
                      </div>
                      <div className="rounded-lg bg-white/5 p-2">
                        <span className="text-white/30">Recebidos</span>
                        <strong className="mt-1 block">
                          {lastRun?.received_count || 0}
                        </strong>
                      </div>
                      <div className="rounded-lg bg-white/5 p-2">
                        <span className="text-white/30">Importados</span>
                        <strong className="mt-1 block">
                          {lastRun?.imported_count || 0}
                        </strong>
                      </div>
                      <div className="rounded-lg bg-white/5 p-2">
                        <span className="text-white/30">Já existentes</span>
                        <strong className="mt-1 block">
                          {lastRun?.duplicate_count || 0}
                        </strong>
                      </div>
                    </div>
                    {lastRun && (
                      <p className="mt-2 flex items-center gap-1 text-[9px] text-white/30">
                        <Clock3 size={11} /> Última execução: {lastRun.status} ·{' '}
                        {lastRun.trigger_source} ·{' '}
                        {formatDate(lastRun.finished_at || lastRun.created_at)}
                      </p>
                    )}
                    {(connection.last_error || lastRun?.error_message) && (
                      <p className="mt-2 rounded-lg bg-red-500/5 p-2 text-[9px] text-red-300">
                        {connection.last_error || lastRun?.error_message}
                      </p>
                    )}
                  </article>
                );
              })}
              {connections.length === 0 && (
                <div className="py-16 text-center text-xs text-white/30">
                  Nenhuma instituição conectada. Use “Conectar instituição” para
                  iniciar um consentimento.
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
