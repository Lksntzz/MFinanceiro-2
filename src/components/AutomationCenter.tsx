import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  Clock3,
  Landmark,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
  WandSparkles,
  X,
} from 'lucide-react';

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

export default function AutomationCenter({ userId, accounts, categories }: AutomationCenterProps) {
  const [activeTab, setActiveTab] = useState<'rules' | 'connections'>('rules');
  const [rules, setRules] = useState<CategorizationRule[]>([]);
  const [connections, setConnections] = useState<BankConnection[]>([]);
  const [syncRuns, setSyncRuns] = useState<BankSyncRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [ruleForm, setRuleForm] = useState<RuleForm>(() => emptyRule(categories));
  const [showRuleForm, setShowRuleForm] = useState(false);
  const [institutionName, setInstitutionName] = useState('');
  const [preparingConnection, setPreparingConnection] = useState(false);

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
        .select('id,connection_id,status,trigger_source,received_count,imported_count,duplicate_count,error_message,started_at,finished_at,created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(20),
    ]);
    const firstError = rulesResult.error || connectionsResult.error || runsResult.error;
    if (firstError) setError(firstError.message);
    else {
      setRules((rulesResult.data || []) as CategorizationRule[]);
      setConnections((connectionsResult.data || []) as BankConnection[]);
      setSyncRuns((runsResult.data || []) as BankSyncRun[]);
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
      setError(saveError instanceof Error ? saveError.message : 'Não foi possível salvar a regra.');
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

  async function prepareOpenFinance() {
    if (institutionName.trim().length < 2 || preparingConnection) return;
    setPreparingConnection(true);
    setError(null);
    setMessage(null);
    try {
      const { data, error: functionError } = await supabase.functions.invoke('open-finance-session', {
        body: {
          institutionName: institutionName.trim(),
          scopes: ['ACCOUNTS_READ', 'RESOURCES_READ'],
        },
      });
      if (functionError) throw functionError;
      if (data?.authorizationUrl) {
        window.location.assign(String(data.authorizationUrl));
        return;
      }
      setMessage(String(data?.message || 'Conexão preparada. A ativação depende da configuração do participante Open Finance.'));
      setInstitutionName('');
      await load();
    } catch (connectionError) {
      setError(connectionError instanceof Error ? connectionError.message : 'Não foi possível preparar a conexão.');
    } finally {
      setPreparingConnection(false);
    }
  }

  async function requestRevocation(connection: BankConnection) {
    if (!window.confirm(`Solicitar revogação do consentimento de ${connection.institution_name}?`)) return;
    const { data, error: functionError } = await supabase.functions.invoke('open-finance-session', {
      body: { action: 'revoke', connectionId: connection.id },
    });
    if (functionError || data?.error) setError(functionError?.message || String(data.error));
    else {
      setMessage('Revogação registrada. O conector do provedor deverá cancelar o consentimento antes de remover os dados.');
      await load();
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
          <p className="mt-1 text-[10px] text-white/35">Regras determinísticas, consentimentos e histórico de sincronização auditável.</p>
        </div>
        <button type="button" onClick={() => void load()} className="rounded-xl border border-white/10 p-2 text-white/45" aria-label="Atualizar automações"><RefreshCw size={15} /></button>
      </div>

      {(error || message) && (
        <div className={`flex items-start justify-between gap-3 rounded-xl border p-3 text-xs ${error ? 'border-red-500/25 bg-red-500/10 text-red-200' : 'border-green-500/25 bg-green-500/10 text-green-200'}`} role={error ? 'alert' : 'status'}>
          <span className="flex items-start gap-2">{error ? <AlertCircle size={15} /> : <CheckCircle2 size={15} />}{error || message}</span>
          <button type="button" onClick={() => { setError(null); setMessage(null); }}><X size={14} /></button>
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
        <div className="grid gap-4 lg:grid-cols-[minmax(300px,.8fr)_minmax(0,1.2fr)]">
          <section className="glass-card space-y-4">
            <div><h3 className="flex items-center gap-2 text-sm font-bold"><Landmark size={16} className="text-brand-primary" /> Preparar instituição</h3><p className="mt-1 text-[10px] leading-relaxed text-white/40">O navegador nunca recebe senha bancária ou token do provedor. A autorização acontece no ambiente da instituição.</p></div>
            <label className="block text-[9px] font-bold uppercase text-white/35">Instituição financeira<input value={institutionName} onChange={(event) => setInstitutionName(event.target.value)} placeholder="Ex.: Banco Inter" className="mt-1 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-xs text-white" /></label>
            <div className="rounded-xl border border-white/8 bg-white/[0.025] p-3 text-[10px] text-white/45"><ShieldCheck size={14} className="mb-2 text-green-300" />Escopos mínimos preparados: leitura de contas e recursos. Novos escopos exigem novo consentimento explícito.</div>
            <button type="button" disabled={institutionName.trim().length < 2 || preparingConnection} onClick={() => void prepareOpenFinance()} className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-primary px-4 py-3 text-xs font-black text-black disabled:opacity-40">{preparingConnection ? <Loader2 size={15} className="animate-spin" /> : <Landmark size={15} />} Preparar conexão</button>
          </section>

          <section className="glass-card !p-0 overflow-hidden">
            <div className="border-b border-white/10 p-4"><h3 className="text-sm font-bold">Conexões e sincronizações</h3><p className="mt-1 text-[9px] text-white/35">Estado do consentimento separado do estado da última sincronização.</p></div>
            <div className="divide-y divide-white/5">
              {connections.map((connection) => {
                const lastRun = syncRuns.find((run) => run.connection_id === connection.id);
                return (
                  <div key={connection.id} className="p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><strong className="text-xs">{connection.display_name || connection.institution_name}</strong><span className={`rounded-full px-2 py-0.5 text-[8px] font-bold ${connection.status === 'active' ? 'bg-green-500/10 text-green-300' : connection.status === 'error' ? 'bg-red-500/10 text-red-300' : 'bg-yellow-500/10 text-yellow-200'}`}>{statusLabels[connection.status]}</span></div><p className="mt-1 text-[9px] text-white/35">Provedor: {connection.provider} · consentimento até {formatDate(connection.consent_expires_at)}</p></div>{!['revoked', 'revocation_pending'].includes(connection.status) && <button type="button" onClick={() => void requestRevocation(connection)} className="rounded-lg border border-red-500/15 px-3 py-2 text-[9px] text-red-300">Revogar</button>}</div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-[9px] sm:grid-cols-4"><div className="rounded-lg bg-white/5 p-2"><span className="text-white/30">Sincronização</span><strong className="block mt-1">{connection.sync_status}</strong></div><div className="rounded-lg bg-white/5 p-2"><span className="text-white/30">Última</span><strong className="block mt-1">{formatDate(connection.last_synced_at)}</strong></div><div className="rounded-lg bg-white/5 p-2"><span className="text-white/30">Recebidos</span><strong className="block mt-1">{lastRun?.received_count || 0}</strong></div><div className="rounded-lg bg-white/5 p-2"><span className="text-white/30">Importados</span><strong className="block mt-1">{lastRun?.imported_count || 0}</strong></div></div>
                    {lastRun && <p className="mt-2 flex items-center gap-1 text-[9px] text-white/30"><Clock3 size={11} /> Última execução: {lastRun.status} · {formatDate(lastRun.finished_at || lastRun.created_at)}</p>}
                    {(connection.last_error || lastRun?.error_message) && <p className="mt-2 text-[9px] text-red-300">{connection.last_error || lastRun?.error_message}</p>}
                  </div>
                );
              })}
              {connections.length === 0 && <div className="py-16 text-center text-xs text-white/30">Nenhuma conexão preparada.</div>}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
