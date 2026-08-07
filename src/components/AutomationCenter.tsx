import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  Clock3,
  Landmark,
  Link2,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
  Unplug,
  WandSparkles,
  X,
} from 'lucide-react';

import { openPluggyConnect, type PluggyConnectItem } from '../lib/pluggy-connect';
import { supabase } from '../lib/supabase';
import {
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

type OpenFinanceConnection = BankConnection & {
  provider_connection_ref?: string | null;
  metadata?: Record<string, unknown> | null;
};

type OpenFinanceSyncRun = BankSyncRun & {
  updated_count?: number;
  mapping_required_count?: number;
};

type BankAccountLink = {
  id: string;
  user_id: string;
  connection_id: string;
  provider_account_ref: string;
  provider_account_type: 'BANK' | 'CREDIT';
  provider_account_subtype?: string | null;
  account_name: string;
  masked_number?: string | null;
  currency: string;
  provider_balance?: number | null;
  provider_credit_limit?: number | null;
  provider_available_credit_limit?: number | null;
  financial_account_id?: string | null;
  card_id?: string | null;
  mapping_source?: 'manual' | 'created' | 'automatic' | null;
  status: 'discovered' | 'mapped' | 'active' | 'error' | 'disconnected';
  last_synced_at?: string | null;
  local_balance_at_sync?: number | null;
  balance_delta?: number | null;
  metadata?: Record<string, unknown>;
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

function formatDate(value?: string | null) {
  return value ? new Date(value).toLocaleString('pt-BR') : '—';
}

function money(value?: number | null, currency = 'BRL') {
  return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: currency || 'BRL' });
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export default function AutomationCenter({ userId, accounts, categories }: AutomationCenterProps) {
  const [activeTab, setActiveTab] = useState<'rules' | 'connections'>('rules');
  const [rules, setRules] = useState<CategorizationRule[]>([]);
  const [connections, setConnections] = useState<OpenFinanceConnection[]>([]);
  const [syncRuns, setSyncRuns] = useState<OpenFinanceSyncRun[]>([]);
  const [accountLinks, setAccountLinks] = useState<BankAccountLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [openingPluggy, setOpeningPluggy] = useState(false);
  const [syncingConnectionId, setSyncingConnectionId] = useState<string | null>(null);
  const [mappingLinkId, setMappingLinkId] = useState<string | null>(null);
  const [mappingTargets, setMappingTargets] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [ruleForm, setRuleForm] = useState<RuleForm>(() => emptyRule(categories));
  const [showRuleForm, setShowRuleForm] = useState(false);

  const categoryNames = useMemo(
    () => new Map(categories.map((category) => [category.id, category.name])),
    [categories],
  );
  const accountNames = useMemo(
    () => new Map(accounts.map((account) => [account.id, account.name])),
    [accounts],
  );

  const load = useCallback(async () => {
    setLoading(true);
    const [rulesResult, connectionsResult, runsResult, linksResult] = await Promise.all([
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
        .select('id,connection_id,status,trigger_source,received_count,imported_count,duplicate_count,updated_count,mapping_required_count,error_message,started_at,finished_at,created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(30),
      supabase
        .from('mf_bank_account_links')
        .select('*')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false }),
    ]);
    const firstError = rulesResult.error || connectionsResult.error || runsResult.error || linksResult.error;
    if (firstError) {
      setError(firstError.message);
    } else {
      setRules((rulesResult.data || []) as CategorizationRule[]);
      setConnections((connectionsResult.data || []) as OpenFinanceConnection[]);
      setSyncRuns((runsResult.data || []) as OpenFinanceSyncRun[]);
      setAccountLinks((linksResult.data || []) as BankAccountLink[]);
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    void load();
    const channel = supabase
      .channel(`financial-automation-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mf_categorization_rules', filter: `user_id=eq.${userId}` }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mf_bank_connections', filter: `user_id=eq.${userId}` }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mf_bank_sync_runs', filter: `user_id=eq.${userId}` }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mf_bank_account_links', filter: `user_id=eq.${userId}` }, () => void load())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [load, userId]);

  useEffect(() => {
    if (ruleForm.categoryId || categories.length === 0) return;
    setRuleForm((current) => ({ ...current, categoryId: categories.find((item) => item.is_active)?.id || '' }));
  }, [categories, ruleForm.categoryId]);

  async function saveRule(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      if (!ruleForm.categoryId) throw new Error('Selecione a categoria aplicada pela regra.');
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
      const { error: insertError } = await supabase.from('mf_categorization_rules').insert(payload);
      if (insertError) throw insertError;
      setRuleForm(emptyRule(categories));
      setShowRuleForm(false);
      setMessage('Regra criada. Ela será sugerida na revisão e aplicada a lançamentos não categorizados.');
      await load();
    } catch (saveError) {
      setError(errorMessage(saveError, 'Não foi possível salvar a regra.'));
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

  async function syncConnection(connectionId: string, quiet = false) {
    setSyncingConnectionId(connectionId);
    setError(null);
    if (!quiet) setMessage(null);
    try {
      const { data, error: functionError } = await supabase.functions.invoke('open-finance-sync', {
        body: { connectionId },
      });
      if (functionError || data?.error) throw new Error(functionError?.message || String(data?.error));
      const mappingRequired = Number(data?.mappingRequired || 0);
      const imported = Number(data?.imported || 0);
      const updated = Number(data?.updated || 0);
      if (!quiet) {
        setMessage(
          mappingRequired > 0
            ? `${mappingRequired} conta(s) encontrada(s). Escolha onde cada uma deve entrar no MF Financeiro para concluir a sincronização.`
            : `Open Finance sincronizado: ${imported} novo(s) e ${updated} atualizado(s).`,
        );
      }
      window.dispatchEvent(new CustomEvent('mf:finance-data-changed'));
      await load();
      return data;
    } catch (syncError) {
      setError(errorMessage(syncError, 'Não foi possível sincronizar o Open Finance.'));
      return null;
    } finally {
      setSyncingConnectionId(null);
    }
  }

  async function completePluggyConnection(connectionId: string, item: PluggyConnectItem) {
    const { data, error: completeError } = await supabase.functions.invoke('open-finance-session', {
      body: { action: 'complete', connectionId, itemId: item.id },
    });
    if (completeError || data?.error) throw new Error(completeError?.message || String(data?.error));
    setMessage(`Instituição ${data?.institution || 'Open Finance'} conectada. Sincronizando contas...`);
    await load();
    await syncConnection(connectionId, true);
  }

  async function openOpenFinance(connection?: OpenFinanceConnection) {
    if (openingPluggy) return;
    setOpeningPluggy(true);
    setError(null);
    setMessage(null);
    try {
      const { data, error: functionError } = await supabase.functions.invoke('open-finance-session', {
        body: { action: 'connect', connectionId: connection?.id || undefined },
      });
      if (functionError || data?.error) throw new Error(functionError?.message || String(data?.error));
      const connectionId = String(data?.connectionId || '');
      const connectToken = String(data?.connectToken || '');
      if (!connectionId || !connectToken) throw new Error('O servidor não retornou os dados para abrir o Open Finance.');

      await openPluggyConnect({
        connectToken,
        updateItem: data?.updateItem ? String(data.updateItem) : null,
        connectorIds: Array.isArray(data?.connectorIds) ? data.connectorIds.map(Number).filter(Number.isFinite) : [],
        onSuccess: async (item) => {
          setOpeningPluggy(false);
          try {
            await completePluggyConnection(connectionId, item);
          } catch (connectError) {
            setError(errorMessage(connectError, 'A instituição conectou, mas a sincronização não foi concluída.'));
          }
        },
        onError: async (widgetMessage) => {
          setError(widgetMessage);
          await load();
        },
        onClose: async () => {
          setOpeningPluggy(false);
          await load();
        },
      });
    } catch (connectionError) {
      setError(errorMessage(connectionError, 'Não foi possível abrir o Open Finance.'));
      setOpeningPluggy(false);
    }
  }

  async function mapAccount(link: BankAccountLink, createNew: boolean) {
    const targetAccountId = mappingTargets[link.id] || '';
    if (!createNew && !targetAccountId) {
      setError('Selecione a conta financeira que corresponde à conta do banco.');
      return;
    }
    setMappingLinkId(link.id);
    setError(null);
    setMessage(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('mf_map_open_finance_account', {
        p_link_id: link.id,
        p_financial_account_id: createNew ? null : targetAccountId,
        p_create_new: createNew,
      });
      if (rpcError) throw rpcError;
      setMessage(createNew ? 'Conta criada e vinculada. Sincronizando movimentações...' : 'Conta vinculada. Sincronizando movimentações...');
      setMappingTargets((current) => ({ ...current, [link.id]: '' }));
      await load();
      await syncConnection(link.connection_id, true);
      if (data) window.dispatchEvent(new CustomEvent('mf:finance-data-changed'));
    } catch (mappingError) {
      setError(errorMessage(mappingError, 'Não foi possível vincular a conta.'));
    } finally {
      setMappingLinkId(null);
    }
  }

  async function requestRevocation(connection: OpenFinanceConnection) {
    if (!window.confirm(`Revogar o consentimento Open Finance de ${connection.institution_name}? A conexão com a instituição será encerrada.`)) return;
    setError(null);
    setMessage(null);
    try {
      const { data, error: functionError } = await supabase.functions.invoke('open-finance-session', {
        body: { action: 'revoke', connectionId: connection.id },
      });
      if (functionError || data?.error) throw new Error(functionError?.message || String(data?.error));
      setMessage('Consentimento revogado na instituição. O histórico já importado foi preservado no MF Financeiro.');
      await load();
    } catch (revokeError) {
      setError(errorMessage(revokeError, 'Não foi possível revogar o consentimento.'));
    }
  }

  if (loading) {
    return <div className="flex min-h-64 items-center justify-center gap-2 text-xs text-white/40"><Loader2 size={16} className="animate-spin" /> Carregando automações...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-black"><Bot size={19} className="text-brand-primary" /> Automação e conexões</h2>
          <p className="mt-1 text-[10px] text-white/35">Regras determinísticas, Open Finance regulado e histórico de sincronização auditável.</p>
        </div>
        <button type="button" onClick={() => void load()} className="rounded-xl border border-white/10 p-2 text-white/45" aria-label="Atualizar automações"><RefreshCw size={15} /></button>
      </div>

      {(error || message) && (
        <div className={`flex items-start justify-between gap-3 rounded-xl border p-3 text-xs ${error ? 'border-red-500/25 bg-red-500/10 text-red-200' : 'border-green-500/25 bg-green-500/10 text-green-200'}`} role={error ? 'alert' : 'status'}>
          <span className="flex items-start gap-2">{error ? <AlertCircle size={15} /> : <CheckCircle2 size={15} />}{error || message}</span>
          <button type="button" onClick={() => { setError(null); setMessage(null); }} aria-label="Fechar mensagem"><X size={14} /></button>
        </div>
      )}

      <div className="mf-subnav">
        <button type="button" className={activeTab === 'rules' ? 'active' : ''} onClick={() => setActiveTab('rules')}>Regras automáticas</button>
        <button type="button" className={activeTab === 'connections' ? 'active' : ''} onClick={() => setActiveTab('connections')}>Open Finance e sincronização</button>
      </div>

      {activeTab === 'rules' ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(280px,.75fr)]">
          <section className="glass-card !p-0 overflow-hidden">
            <div className="flex items-center justify-between border-b border-white/10 p-4">
              <div><h3 className="text-sm font-bold">Regras de categorização</h3><p className="mt-1 text-[9px] text-white/35">Maior prioridade vence. Regras exatas geram confiança de 100%.</p></div>
              <button type="button" onClick={() => setShowRuleForm((value) => !value)} className="flex items-center gap-2 rounded-xl bg-brand-primary px-3 py-2 text-xs font-black text-black"><Plus size={14} /> Nova regra</button>
            </div>
            <div className="divide-y divide-white/5">
              {rules.map((rule) => (
                <div key={rule.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2"><strong className="truncate text-xs">{rule.name}</strong><span className={`rounded-full px-2 py-0.5 text-[8px] font-bold ${rule.is_active ? 'bg-green-500/10 text-green-300' : 'bg-white/5 text-white/30'}`}>{rule.is_active ? 'ATIVA' : 'PAUSADA'}</span></div>
                    <p className="mt-1 text-[10px] text-white/40">{rule.match_field} {rule.match_operator} “{rule.match_value}” → {categoryNames.get(rule.category_id) || 'Categoria'}{rule.account_id ? ` · ${accountNames.get(rule.account_id) || 'Conta'}` : ''}</p>
                    <p className="mt-1 text-[9px] text-white/25">Prioridade {rule.priority} · {rule.hit_count} aplicação(ões){rule.last_matched_at ? ` · última ${formatDate(rule.last_matched_at)}` : ''}</p>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => void toggleRule(rule)} className="rounded-lg border border-white/10 px-3 py-2 text-[10px] text-white/55">{rule.is_active ? 'Pausar' : 'Ativar'}</button>
                    <button type="button" onClick={() => void deleteRule(rule)} className="rounded-lg border border-red-500/15 p-2 text-red-300" aria-label={`Excluir ${rule.name}`}><Trash2 size={14} /></button>
                  </div>
                </div>
              ))}
              {rules.length === 0 && <div className="py-14 text-center text-xs text-white/30">Nenhuma regra criada.</div>}
            </div>
          </section>

          <section className="glass-card">
            {showRuleForm ? (
              <form onSubmit={saveRule} className="space-y-3">
                <h3 className="flex items-center gap-2 text-sm font-bold"><WandSparkles size={15} className="text-brand-primary" /> Nova regra</h3>
                <label className="block text-[9px] font-bold uppercase text-white/35">Nome<input required maxLength={120} value={ruleForm.name} onChange={(event) => setRuleForm({ ...ruleForm, name: event.target.value })} className="mt-1 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-xs text-white" /></label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block text-[9px] font-bold uppercase text-white/35">Campo<select value={ruleForm.matchField} onChange={(event) => setRuleForm({ ...ruleForm, matchField: event.target.value as RuleForm['matchField'] })} className="mt-1 w-full rounded-xl border border-white/10 bg-[#121212] px-3 py-2 text-xs text-white"><option value="description">Descrição</option><option value="source">Origem</option><option value="description_or_source">Descrição ou origem</option></select></label>
                  <label className="block text-[9px] font-bold uppercase text-white/35">Condição<select value={ruleForm.matchOperator} onChange={(event) => setRuleForm({ ...ruleForm, matchOperator: event.target.value as RuleForm['matchOperator'] })} className="mt-1 w-full rounded-xl border border-white/10 bg-[#121212] px-3 py-2 text-xs text-white"><option value="contains">Contém</option><option value="starts_with">Começa com</option><option value="exact">É igual a</option></select></label>
                </div>
                <label className="block text-[9px] font-bold uppercase text-white/35">Texto procurado<input required minLength={2} maxLength={160} value={ruleForm.matchValue} onChange={(event) => setRuleForm({ ...ruleForm, matchValue: event.target.value })} className="mt-1 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-xs text-white" /></label>
                <label className="block text-[9px] font-bold uppercase text-white/35">Categoria<select required value={ruleForm.categoryId} onChange={(event) => setRuleForm({ ...ruleForm, categoryId: event.target.value })} className="mt-1 w-full rounded-xl border border-white/10 bg-[#121212] px-3 py-2 text-xs text-white"><option value="">Selecione</option>{categories.filter((item) => item.is_active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
                <label className="block text-[9px] font-bold uppercase text-white/35">Conta opcional<select value={ruleForm.accountId} onChange={(event) => setRuleForm({ ...ruleForm, accountId: event.target.value })} className="mt-1 w-full rounded-xl border border-white/10 bg-[#121212] px-3 py-2 text-xs text-white"><option value="">Todas as contas</option>{accounts.filter((item) => item.is_active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block text-[9px] font-bold uppercase text-white/35">Tipo<select value={ruleForm.transactionType} onChange={(event) => setRuleForm({ ...ruleForm, transactionType: event.target.value as RuleForm['transactionType'] })} className="mt-1 w-full rounded-xl border border-white/10 bg-[#121212] px-3 py-2 text-xs text-white"><option value="">Ambos</option><option value="expense">Saída</option><option value="income">Entrada</option></select></label>
                  <label className="block text-[9px] font-bold uppercase text-white/35">Prioridade<input type="number" min="0" max="10000" value={ruleForm.priority} onChange={(event) => setRuleForm({ ...ruleForm, priority: event.target.value })} className="mt-1 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-xs text-white" /></label>
                </div>
                <div className="flex gap-2 pt-1"><button type="button" onClick={() => setShowRuleForm(false)} className="flex-1 rounded-xl border border-white/10 px-3 py-2 text-xs">Cancelar</button><button disabled={saving} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-brand-primary px-3 py-2 text-xs font-black text-black disabled:opacity-50"><Save size={14} />{saving ? 'Salvando...' : 'Salvar'}</button></div>
              </form>
            ) : (
              <div className="flex min-h-64 flex-col items-center justify-center text-center text-white/35"><WandSparkles size={28} /><p className="mt-3 text-xs">Crie regras para descrições recorrentes como mercado, aluguel ou salário.</p></div>
            )}
          </section>
        </div>
      ) : (
        <div className="space-y-4">
          <section className="glass-card grid gap-4 md:grid-cols-[1fr_auto] md:items-center">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-bold"><Landmark size={16} className="text-brand-primary" /> Open Finance regulado</h3>
              <p className="mt-1 max-w-2xl text-[10px] leading-relaxed text-white/40">Conecte a instituição pelo ambiente seguro do provedor. O MF Financeiro recebe somente os dados autorizados; senha bancária e credenciais da instituição não passam pelo aplicativo.</p>
              <div className="mt-3 flex flex-wrap gap-2 text-[9px] text-white/40">
                <span className="rounded-full border border-white/10 px-2.5 py-1">Contas</span>
                <span className="rounded-full border border-white/10 px-2.5 py-1">Cartões</span>
                <span className="rounded-full border border-white/10 px-2.5 py-1">Transações</span>
                <span className="rounded-full border border-green-500/20 bg-green-500/5 px-2.5 py-1 text-green-300"><ShieldCheck size={10} className="mr-1 inline" /> Consentimento revogável</span>
              </div>
            </div>
            <button type="button" disabled={openingPluggy} onClick={() => void openOpenFinance()} className="flex min-w-48 items-center justify-center gap-2 rounded-xl bg-brand-primary px-4 py-3 text-xs font-black text-black disabled:opacity-40">{openingPluggy ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} Conectar instituição</button>
          </section>

          <section className="glass-card !p-0 overflow-hidden">
            <div className="border-b border-white/10 p-4"><h3 className="text-sm font-bold">Conexões e sincronizações</h3><p className="mt-1 text-[9px] text-white/35">Cada conta encontrada é vinculada explicitamente antes de alterar seu histórico financeiro.</p></div>
            <div className="divide-y divide-white/5">
              {connections.map((connection) => {
                const lastRun = syncRuns.find((run) => run.connection_id === connection.id);
                const links = accountLinks.filter((link) => link.connection_id === connection.id);
                const canSync = connection.status === 'active' && Boolean(connection.provider_connection_ref);
                const canReconnect = ['error', 'expired', 'expiring', 'authorizing'].includes(connection.status);
                return (
                  <article key={connection.id} className="p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <strong className="text-xs">{connection.display_name || connection.institution_name}</strong>
                          <span className={`rounded-full px-2 py-0.5 text-[8px] font-bold ${connection.status === 'active' ? 'bg-green-500/10 text-green-300' : connection.status === 'error' ? 'bg-red-500/10 text-red-300' : connection.status === 'revoked' ? 'bg-white/5 text-white/30' : 'bg-yellow-500/10 text-yellow-200'}`}>{statusLabels[connection.status]}</span>
                        </div>
                        <p className="mt-1 text-[9px] text-white/35">Open Finance · {connection.provider === 'pluggy' ? 'Pluggy' : connection.provider} · consentimento até {formatDate(connection.consent_expires_at)}</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {canSync && <button type="button" disabled={syncingConnectionId === connection.id} onClick={() => void syncConnection(connection.id)} className="flex items-center gap-1.5 rounded-lg border border-brand-primary/20 px-3 py-2 text-[9px] text-brand-primary disabled:opacity-40">{syncingConnectionId === connection.id ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Sincronizar</button>}
                        {canReconnect && connection.status !== 'revoked' && <button type="button" onClick={() => void openOpenFinance(connection)} className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-[9px] text-white/60"><Link2 size={12} /> Reautorizar</button>}
                        {!['revoked', 'revocation_pending'].includes(connection.status) && <button type="button" onClick={() => void requestRevocation(connection)} className="flex items-center gap-1.5 rounded-lg border border-red-500/15 px-3 py-2 text-[9px] text-red-300"><Unplug size={12} /> Revogar</button>}
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2 text-[9px] sm:grid-cols-5">
                      <div className="rounded-lg bg-white/5 p-2"><span className="text-white/30">Sincronização</span><strong className="mt-1 block">{connection.sync_status}</strong></div>
                      <div className="rounded-lg bg-white/5 p-2"><span className="text-white/30">Última</span><strong className="mt-1 block">{formatDate(connection.last_synced_at)}</strong></div>
                      <div className="rounded-lg bg-white/5 p-2"><span className="text-white/30">Recebidos</span><strong className="mt-1 block">{lastRun?.received_count || 0}</strong></div>
                      <div className="rounded-lg bg-white/5 p-2"><span className="text-white/30">Novos</span><strong className="mt-1 block">{lastRun?.imported_count || 0}</strong></div>
                      <div className="rounded-lg bg-white/5 p-2"><span className="text-white/30">Atualizados</span><strong className="mt-1 block">{lastRun?.updated_count || 0}</strong></div>
                    </div>

                    {links.length > 0 && (
                      <div className="mt-4 space-y-2">
                        <p className="text-[9px] font-black uppercase tracking-wider text-white/30">Contas encontradas</p>
                        {links.map((link) => {
                          const compatibleAccounts = accounts.filter((account) => account.is_active && (
                            link.provider_account_type === 'CREDIT' ? account.account_type === 'credit' : account.account_type !== 'credit'
                          ));
                          const mappedName = link.financial_account_id ? accountNames.get(link.financial_account_id) : null;
                          const needsMapping = !link.financial_account_id && link.status !== 'disconnected';
                          return (
                            <div key={link.id} className="rounded-xl border border-white/8 bg-black/20 p-3">
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                  <div className="flex items-center gap-2"><strong className="text-xs">{link.account_name}</strong><span className="rounded-full bg-white/5 px-2 py-0.5 text-[8px] text-white/40">{link.provider_account_type === 'CREDIT' ? 'Cartão' : 'Conta bancária'}</span></div>
                                  <p className="mt-1 text-[9px] text-white/35">{link.masked_number || 'Número protegido'} · saldo informado {money(link.provider_balance, link.currency)}</p>
                                  {mappedName && <p className="mt-1 text-[9px] text-green-300">Vinculada a: {mappedName}</p>}
                                  {typeof link.balance_delta === 'number' && Math.abs(link.balance_delta) >= 0.01 && <p className="mt-1 text-[9px] text-amber-300">Diferença para o banco: {money(link.balance_delta, link.currency)}. Revise o saldo antes de calibrar.</p>}
                                </div>
                                {!needsMapping && link.status !== 'disconnected' && <span className="flex items-center gap-1 text-[9px] text-green-300"><CheckCircle2 size={12} /> Mapeada</span>}
                              </div>

                              {needsMapping && (
                                <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto_auto]">
                                  <select value={mappingTargets[link.id] || ''} onChange={(event) => setMappingTargets((current) => ({ ...current, [link.id]: event.target.value }))} className="rounded-lg border border-white/10 bg-[#121212] px-3 py-2 text-[10px] text-white">
                                    <option value="">Escolher conta existente</option>
                                    {compatibleAccounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {money(account.current_balance, account.currency)}</option>)}
                                  </select>
                                  <button type="button" disabled={mappingLinkId === link.id || !mappingTargets[link.id]} onClick={() => void mapAccount(link, false)} className="rounded-lg border border-brand-primary/20 px-3 py-2 text-[9px] font-bold text-brand-primary disabled:opacity-40">{mappingLinkId === link.id ? 'Vinculando...' : 'Vincular'}</button>
                                  <button type="button" disabled={mappingLinkId === link.id} onClick={() => void mapAccount(link, true)} className="rounded-lg bg-brand-primary px-3 py-2 text-[9px] font-black text-black disabled:opacity-40">{mappingLinkId === link.id ? 'Criando...' : 'Criar nova conta'}</button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {lastRun && <p className="mt-3 flex items-center gap-1 text-[9px] text-white/30"><Clock3 size={11} /> Última execução: {lastRun.status} · {formatDate(lastRun.finished_at || lastRun.created_at)}{Number(lastRun.mapping_required_count || 0) > 0 ? ` · ${lastRun.mapping_required_count} aguardando vínculo` : ''}</p>}
                    {(connection.last_error || lastRun?.error_message) && <p className="mt-2 text-[9px] text-red-300">{connection.last_error || lastRun?.error_message}</p>}
                  </article>
                );
              })}
              {connections.length === 0 && <div className="py-16 text-center text-xs text-white/30">Nenhuma instituição conectada.</div>}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
