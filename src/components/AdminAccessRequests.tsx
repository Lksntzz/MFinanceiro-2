import React, { useEffect, useMemo, useState } from 'react';
import { User } from '@supabase/supabase-js';
import { CheckCircle2, Clock3, RefreshCw, Search, ShieldAlert, XCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';

type AccessFilter = 'all' | 'pending' | 'approved' | 'denied';
type AccessStatus = 'pending' | 'approved' | 'denied';

type AccessRequestItem = {
  id: string;
  name: string;
  email: string;
  status: AccessStatus;
  createdAt: string;
  note: string | null;
};

function isAdminUser(user: User): boolean {
  const role = String(user.app_metadata?.role || '').toLowerCase();
  return role === 'admin' || role === 'owner';
}

function normalizeStatus(raw: unknown): AccessStatus {
  const value = String(raw || '').toLowerCase();
  if (value === 'approved' || value === 'aprovado') return 'approved';
  if (value === 'denied' || value === 'negado' || value === 'rejected') return 'denied';
  return 'pending';
}

function mapStatus(status: AccessStatus, variant: 'pt' | 'en') {
  if (variant === 'pt') {
    if (status === 'approved') return 'aprovado';
    if (status === 'denied') return 'negado';
    return 'pendente';
  }
  return status;
}

function isColumnMismatch(error: any) {
  const message = String(error?.message || '').toLowerCase();
  return message.includes('column') && message.includes('does not exist');
}

export default function AdminAccessRequests({ user }: { user: User }) {
  const [items, setItems] = useState<AccessRequestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<AccessFilter>('all');
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [schemaVariant, setSchemaVariant] = useState<'pt' | 'en'>('pt');

  const isAdmin = isAdminUser(user);

  async function assertBackendAdmin() {
    if (!isAdmin) throw new Error('Permissão administrativa ausente no token de acesso.');
    const { data, error: refreshError } = await supabase.auth.refreshSession();
    if (refreshError || !data.session) throw refreshError || new Error('Sessão administrativa não encontrada.');

    const refreshedRole = String(data.session.user.app_metadata?.role || '').toLowerCase();
    if (refreshedRole !== 'admin' && refreshedRole !== 'owner') {
      throw new Error('Seu token não possui perfil administrativo. Faça login novamente.');
    }

    const { data: adminCheck, error: adminCheckError } = await supabase.rpc('mf_is_admin_user');
    if (adminCheckError) {
      throw new Error(`Não foi possível validar o perfil administrativo no servidor: ${adminCheckError.message}`);
    }
    if (adminCheck !== true) throw new Error('O servidor não confirmou permissão administrativa.');
  }

  const fetchRequests = async () => {
    if (!isAdmin) {
      setItems([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await assertBackendAdmin();

      const byPt = await supabase
        .from('mf_access_requests')
        .select('id,nome,email,status,created_at,observacao,updated_at')
        .order('updated_at', { ascending: false });

      let data: any[] | null = byPt.data;
      let queryError: any = byPt.error;
      let variant: 'pt' | 'en' = 'pt';

      if (byPt.error && isColumnMismatch(byPt.error)) {
        const byEn = await supabase
          .from('mf_access_requests')
          .select('id,name,email,status,created_at,note,updated_at')
          .order('updated_at', { ascending: false });
        data = byEn.data;
        queryError = byEn.error;
        variant = 'en';
      }

      if (queryError) throw queryError;
      setSchemaVariant(variant);
      setItems((data || []).map((row: any) => ({
        id: String(row.id),
        name: String(row.nome ?? row.name ?? ''),
        email: String(row.email ?? ''),
        status: normalizeStatus(row.status),
        createdAt: String(row.created_at ?? ''),
        note: (row.observacao ?? row.note ?? null) as string | null,
      })));
    } catch (fetchError: any) {
      setItems([]);
      setError(String(fetchError?.message || 'Falha ao carregar solicitações.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchRequests();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, user.id]);

  useEffect(() => {
    if (!isAdmin) return;
    const onFocus = () => void fetchRequests();
    window.addEventListener('focus', onFocus);
    const channel = supabase
      .channel(`admin_access_requests_${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mf_access_requests' }, () => void fetchRequests())
      .subscribe();

    return () => {
      window.removeEventListener('focus', onFocus);
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, user.id]);

  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    return items.filter((item) => {
      if (filter !== 'all' && item.status !== filter) return false;
      if (!query) return true;
      return item.name.toLowerCase().includes(query) || item.email.toLowerCase().includes(query);
    });
  }, [items, filter, search]);

  async function updateStatus(id: string, nextStatus: AccessStatus) {
    if (!isAdmin) {
      setError('Permissão negada para alterar solicitações.');
      return;
    }

    setSavingId(id);
    setError(null);
    setMessage(null);
    try {
      await assertBackendAdmin();
      const now = new Date().toISOString();

      const updatePt = await supabase
        .from('mf_access_requests')
        .update({
          status: mapStatus(nextStatus, 'pt'),
          observacao: null,
          aprovado_por: user.id,
          aprovado_em: now,
        })
        .eq('id', id)
        .select('id,status')
        .limit(1);

      let result = updatePt;
      if (updatePt.error && isColumnMismatch(updatePt.error)) {
        result = await supabase
          .from('mf_access_requests')
          .update({
            status: mapStatus(nextStatus, 'en'),
            note: null,
            approved_by: user.id,
            approved_at: now,
          })
          .eq('id', id)
          .select('id,status')
          .limit(1);
      }

      if (result.error) throw result.error;
      const updated = Array.isArray(result.data) ? result.data[0] : null;
      if (!updated) throw new Error('Solicitação inexistente ou já alterada por outro administrador.');

      setSchemaVariant(schemaVariant);
      setItems((current) => current.map((item) => item.id === id
        ? { ...item, status: normalizeStatus(updated.status) }
        : item));
      setMessage(nextStatus === 'approved' ? 'Solicitação aprovada.' : 'Solicitação negada.');
    } catch (updateError: any) {
      setError(String(updateError?.message || 'Falha ao atualizar solicitação.'));
      await fetchRequests();
    } finally {
      setSavingId(null);
    }
  }

  if (!isAdmin) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="glass-card !p-6 max-w-md text-center border-red-500/20">
          <ShieldAlert className="mx-auto text-red-400 mb-3" size={28} />
          <h3 className="text-sm font-bold text-red-400 uppercase tracking-widest">Acesso restrito</h3>
          <p className="text-xs text-white/50 mt-2">Esta área exige papel admin ou owner validado pelo servidor.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col gap-4 overflow-hidden animate-fade-in">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">Solicitações de acesso</h2>
          <p className="text-[10px] text-white/40 uppercase font-bold tracking-widest">Gestão manual de aprovação</p>
        </div>
        <button type="button" onClick={() => void fetchRequests()} disabled={loading} className="px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-xs font-bold text-white/70 hover:bg-white/10 transition-all disabled:opacity-50 flex items-center gap-2">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Atualizar
        </button>
      </div>

      <div className="glass-card !p-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nome ou e-mail" className="w-full bg-white/5 border border-white/10 rounded-xl py-2.5 pl-9 pr-3 text-sm outline-none focus:border-brand-primary" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(['all', 'pending', 'approved', 'denied'] as AccessFilter[]).map((value) => (
            <button key={value} type="button" onClick={() => setFilter(value)} className={`px-3 py-2 rounded-lg text-xs font-bold uppercase tracking-widest transition-all ${filter === value ? 'bg-brand-primary text-black' : 'bg-white/5 text-white/50 hover:bg-white/10 hover:text-white'}`}>
              {value === 'all' ? 'Todos' : value === 'pending' ? 'Pendente' : value === 'approved' ? 'Aprovado' : 'Negado'}
            </button>
          ))}
        </div>
      </div>

      {message && <div className="p-3 rounded-xl bg-green-500/10 border border-green-500/20 text-green-400 text-sm" role="status">{message}</div>}
      {error && <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm" role="alert">{error}</div>}

      <div className="glass-card !p-0 overflow-hidden flex-1 min-h-0">
        {loading ? (
          <div className="h-full flex items-center justify-center text-white/30 uppercase text-xs font-bold tracking-widest">Carregando solicitações...</div>
        ) : filteredItems.length === 0 ? (
          <div className="h-full flex items-center justify-center text-white/30 uppercase text-xs font-bold tracking-widest">Nenhuma solicitação encontrada.</div>
        ) : (
          <div className="h-full overflow-auto no-scrollbar">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-[#0a0a0a] border-b border-white/10">
                <tr>
                  <th className="py-3 px-4 text-[10px] uppercase tracking-widest text-white/40">Nome</th>
                  <th className="py-3 px-4 text-[10px] uppercase tracking-widest text-white/40">E-mail</th>
                  <th className="py-3 px-4 text-[10px] uppercase tracking-widest text-white/40">Status</th>
                  <th className="py-3 px-4 text-[10px] uppercase tracking-widest text-white/40">Solicitado em</th>
                  <th className="py-3 px-4 text-[10px] uppercase tracking-widest text-white/40 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((item) => (
                  <tr key={item.id} className="border-b border-white/5">
                    <td className="py-3 px-4 font-semibold">{item.name || '-'}</td>
                    <td className="py-3 px-4 text-white/70">{item.email}</td>
                    <td className="py-3 px-4">
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-widest ${item.status === 'approved' ? 'bg-green-500/10 text-green-400' : item.status === 'denied' ? 'bg-red-500/10 text-red-400' : 'bg-yellow-500/10 text-yellow-400'}`}>
                        {item.status === 'approved' ? <CheckCircle2 size={12} /> : item.status === 'denied' ? <XCircle size={12} /> : <Clock3 size={12} />}
                        {item.status === 'approved' ? 'Aprovado' : item.status === 'denied' ? 'Negado' : 'Pendente'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-white/60">{item.createdAt ? new Date(item.createdAt).toLocaleString('pt-BR') : '-'}</td>
                    <td className="py-3 px-4">
                      <div className="flex justify-end gap-2">
                        <button type="button" onClick={() => void updateStatus(item.id, 'approved')} disabled={savingId === item.id || item.status !== 'pending'} className="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-green-500/15 text-green-400 hover:bg-green-500/25 disabled:opacity-40 disabled:cursor-not-allowed">Aprovar</button>
                        <button type="button" onClick={() => void updateStatus(item.id, 'denied')} disabled={savingId === item.id || item.status !== 'pending'} className="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-red-500/15 text-red-400 hover:bg-red-500/25 disabled:opacity-40 disabled:cursor-not-allowed">Negar</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
