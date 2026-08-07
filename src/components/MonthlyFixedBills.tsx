import React, { useEffect, useMemo, useState } from 'react';
import {
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Pencil,
  Plus,
  RefreshCcw,
  Repeat2,
  Save,
  Trash2,
  X,
} from 'lucide-react';
import { addMonths, format, parseISO, startOfMonth } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { CATEGORIES } from '../lib/constants';
import { supabase } from '../lib/supabase';

type OccurrenceStatus = 'pending' | 'paid' | 'skipped';

type BillTemplate = {
  id: string;
  name: string;
  category: string | null;
  default_amount: number;
  default_due_day: number;
  active: boolean;
};

type Occurrence = {
  id: string;
  fixed_bill_id: string;
  competence: string;
  due_date: string;
  amount: number;
  status: OccurrenceStatus;
  paid_at?: string | null;
  notes?: string | null;
  fixed_bill: BillTemplate;
};

type EditScope = 'month' | 'future';

const money = (value: number) => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const monthKey = (date: Date) => format(startOfMonth(date), 'yyyy-MM-01');
const monthLabel = (value: string) => {
  const label = format(parseISO(value), 'MMMM yyyy', { locale: ptBR });
  return label.charAt(0).toUpperCase() + label.slice(1);
};

export default function MonthlyFixedBills({ userId, onDataChanged }: { userId: string; onDataChanged?: () => void }) {
  const [rows, setRows] = useState<Occurrence[]>([]);
  const [selectedMonth, setSelectedMonth] = useState(monthKey(new Date()));
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState<Occurrence | null>(null);
  const [editScope, setEditScope] = useState<EditScope>('month');
  const [paymentMethod, setPaymentMethod] = useState('pix');
  const [newForm, setNewForm] = useState({ name: '', amount: '', dueDay: '10', category: CATEGORIES[0] || 'Moradia' });
  const [editForm, setEditForm] = useState({ name: '', amount: '', dueDate: '', category: '', notes: '' });

  const months = useMemo(() => Array.from({ length: 6 }, (_, index) => {
    const date = addMonths(startOfMonth(new Date()), index);
    return { key: monthKey(date), label: monthLabel(monthKey(date)) };
  }), []);

  async function load() {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const { error: ensureError } = await supabase.rpc('mf_ensure_fixed_bill_occurrences', { p_months_ahead: 12 });
      if (ensureError) throw ensureError;

      const start = monthKey(addMonths(new Date(), -1));
      const end = monthKey(addMonths(new Date(), 7));
      const { data, error: queryError } = await supabase
        .from('mf_fixed_bill_occurrences')
        .select('id,fixed_bill_id,competence,due_date,amount,status,paid_at,notes,fixed_bill:mf_fixed_bills(id,name,category,default_amount,default_due_day,active)')
        .eq('user_id', userId)
        .gte('competence', start)
        .lt('competence', end)
        .order('due_date', { ascending: true });
      if (queryError) throw queryError;

      const normalized = (data || []).map((item: any) => ({
        ...item,
        amount: Number(item.amount || 0),
        fixed_bill: Array.isArray(item.fixed_bill) ? item.fixed_bill[0] : item.fixed_bill,
      })).filter((item: any) => item.fixed_bill) as Occurrence[];
      setRows(normalized);
    } catch (loadError: any) {
      setError(loadError?.message || 'Não foi possível carregar as contas mensais.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [userId]);

  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`monthly-fixed-bills-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mf_fixed_bill_occurrences', filter: `user_id=eq.${userId}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mf_fixed_bills', filter: `user_id=eq.${userId}` }, load)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userId]);

  const selectedRows = rows.filter((row) => row.competence === selectedMonth && row.status !== 'skipped');
  const ignoredRows = rows.filter((row) => row.competence === selectedMonth && row.status === 'skipped');
  const selectedTotal = selectedRows.reduce((sum, row) => sum + row.amount, 0);
  const pendingTotal = selectedRows.filter((row) => row.status === 'pending').reduce((sum, row) => sum + row.amount, 0);
  const paidTotal = selectedRows.filter((row) => row.status === 'paid').reduce((sum, row) => sum + row.amount, 0);

  function announce(text: string) {
    setMessage(text);
    setError(null);
    onDataChanged?.();
  }

  async function createRecurring(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const amount = Number(newForm.amount);
      const dueDay = Number(newForm.dueDay);
      const { error: rpcError } = await supabase.rpc('mf_create_fixed_bill_recurring', {
        p_name: newForm.name.trim(),
        p_amount: amount,
        p_due_day: dueDay,
        p_category: newForm.category,
      });
      if (rpcError) throw rpcError;
      setNewForm({ name: '', amount: '', dueDay: '10', category: CATEGORIES[0] || 'Moradia' });
      setShowNew(false);
      announce('Conta fixa criada. Os próximos meses já foram registrados.');
      await load();
    } catch (saveError: any) {
      setError(saveError?.message || 'Não foi possível criar a conta fixa.');
    } finally { setSaving(false); }
  }

  function openEdit(row: Occurrence) {
    setEditing(row);
    setEditScope(row.status === 'paid' ? 'future' : 'month');
    setEditForm({
      name: row.fixed_bill.name,
      amount: String(row.amount),
      dueDate: row.due_date,
      category: row.fixed_bill.category || CATEGORIES[0] || 'Moradia',
      notes: row.notes || '',
    });
  }

  async function saveEdit(event: React.FormEvent) {
    event.preventDefault();
    if (!editing) return;
    setSaving(true);
    setError(null);
    try {
      const amount = Number(editForm.amount);
      if (editScope === 'month') {
        const { error: rpcError } = await supabase.rpc('mf_update_fixed_bill_occurrence', {
          p_occurrence_id: editing.id,
          p_amount: amount,
          p_due_date: editForm.dueDate,
          p_notes: editForm.notes || null,
        });
        if (rpcError) throw rpcError;
        announce(`${monthLabel(editing.competence)} foi alterado sem modificar os outros meses.`);
      } else {
        const fromCompetence = editing.status === 'paid'
          ? monthKey(addMonths(parseISO(editing.competence), 1))
          : editing.competence;
        const dueDay = Number(format(parseISO(editForm.dueDate), 'd'));
        const { error: rpcError } = await supabase.rpc('mf_update_fixed_bill_future', {
          p_fixed_bill_id: editing.fixed_bill_id,
          p_from_competence: fromCompetence,
          p_amount: amount,
          p_due_day: dueDay,
          p_name: editForm.name,
          p_category: editForm.category,
        });
        if (rpcError) throw rpcError;
        announce('O valor padrão foi aplicado aos próximos meses pendentes.');
      }
      setEditing(null);
      await load();
    } catch (saveError: any) {
      setError(saveError?.message || 'Não foi possível editar a conta.');
    } finally { setSaving(false); }
  }

  async function pay(row: Occurrence) {
    setSaving(true);
    setError(null);
    try {
      const { error: rpcError } = await supabase.rpc('mf_pay_fixed_bill_occurrence', {
        p_occurrence_id: row.id,
        p_payment_method: paymentMethod,
      });
      if (rpcError) throw rpcError;
      announce(`${row.fixed_bill.name} foi paga. A conta do mês seguinte já está disponível.`);
      await load();
    } catch (payError: any) {
      setError(payError?.message || 'Não foi possível registrar o pagamento.');
    } finally { setSaving(false); }
  }

  async function reopen(row: Occurrence) {
    if (!window.confirm(`Desfazer o pagamento de ${row.fixed_bill.name} em ${monthLabel(row.competence)}?`)) return;
    setSaving(true);
    try {
      const { error: rpcError } = await supabase.rpc('mf_reopen_fixed_bill_occurrence', { p_occurrence_id: row.id });
      if (rpcError) throw rpcError;
      announce('Pagamento desfeito e valor devolvido ao saldo.');
      await load();
    } catch (actionError: any) { setError(actionError?.message || 'Não foi possível desfazer o pagamento.'); }
    finally { setSaving(false); }
  }

  async function skip(row: Occurrence) {
    if (!window.confirm(`Ignorar somente ${monthLabel(row.competence)} de ${row.fixed_bill.name}? Os próximos meses continuarão registrados.`)) return;
    setSaving(true);
    try {
      const { error: rpcError } = await supabase.rpc('mf_skip_fixed_bill_occurrence', { p_occurrence_id: row.id });
      if (rpcError) throw rpcError;
      announce('Somente este mês foi ignorado.');
      await load();
    } catch (actionError: any) { setError(actionError?.message || 'Não foi possível ignorar este mês.'); }
    finally { setSaving(false); }
  }

  async function endRecurring(row: Occurrence) {
    if (!window.confirm(`Encerrar a recorrência de ${row.fixed_bill.name}? O histórico pago será preservado e os próximos meses serão cancelados.`)) return;
    setSaving(true);
    try {
      const { error: rpcError } = await supabase.rpc('mf_end_fixed_bill_recurring', { p_fixed_bill_id: row.fixed_bill_id });
      if (rpcError) throw rpcError;
      announce('Recorrência encerrada. O histórico foi preservado.');
      await load();
    } catch (actionError: any) { setError(actionError?.message || 'Não foi possível encerrar a recorrência.'); }
    finally { setSaving(false); }
  }

  function nextOccurrence(row: Occurrence) {
    return rows
      .filter((item) => item.fixed_bill_id === row.fixed_bill_id && item.competence > row.competence && item.status !== 'skipped')
      .sort((a, b) => a.competence.localeCompare(b.competence))[0];
  }

  return (
    <div className="mf-monthly-bills-page">
      <style>{`
        #mf-monthly-fixed-bills-host { width:100%; min-width:0; }
        .mf-monthly-bills-page { width:100%; min-height:0; display:flex; flex:1; flex-direction:column; gap:14px; color:white; overflow:hidden; }
        .mf-bills-heading { display:flex; align-items:flex-start; justify-content:space-between; gap:14px; flex-wrap:wrap; }
        .mf-bills-heading h2 { font-size:18px; font-weight:900; }
        .mf-bills-heading p { margin-top:4px; font-size:10px; color:rgba(255,255,255,.4); }
        .mf-bills-months { display:flex; gap:7px; overflow-x:auto; scrollbar-width:none; padding-bottom:2px; }
        .mf-bills-months::-webkit-scrollbar { display:none; }
        .mf-month-chip { flex:0 0 auto; border:1px solid rgba(255,255,255,.08); border-radius:12px; padding:8px 11px; font-size:10px; font-weight:800; color:rgba(255,255,255,.48); background:rgba(255,255,255,.025); }
        .mf-month-chip.active { color:#050505; background:var(--brand-primary,#00f2ff); border-color:transparent; }
        .mf-bills-metrics { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:9px; }
        .mf-bills-metric { border:1px solid rgba(255,255,255,.08); border-radius:15px; padding:12px; background:rgba(255,255,255,.025); }
        .mf-bills-metric span { display:block; font-size:9px; font-weight:800; text-transform:uppercase; color:rgba(255,255,255,.35); }
        .mf-bills-metric strong { display:block; margin-top:5px; font-size:15px; }
        .mf-bills-list { flex:1; min-height:0; overflow-y:auto; display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); align-content:start; gap:10px; padding-right:2px; }
        .mf-occurrence-card { border:1px solid rgba(255,255,255,.09); border-radius:17px; padding:14px; background:rgba(255,255,255,.025); }
        .mf-occurrence-card.paid { border-color:rgba(34,197,94,.22); background:rgba(34,197,94,.045); }
        .mf-occurrence-title { display:flex; align-items:flex-start; justify-content:space-between; gap:10px; }
        .mf-occurrence-title h3 { font-size:13px; font-weight:900; }
        .mf-occurrence-title p { margin-top:4px; font-size:9px; color:rgba(255,255,255,.36); }
        .mf-status { border-radius:999px; padding:5px 8px; font-size:8px; font-weight:900; text-transform:uppercase; }
        .mf-status.pending { color:#fde68a; background:rgba(234,179,8,.12); }
        .mf-status.paid { color:#86efac; background:rgba(34,197,94,.12); }
        .mf-occurrence-value { margin-top:13px; font-size:20px; font-weight:950; }
        .mf-occurrence-actions { display:flex; gap:7px; flex-wrap:wrap; margin-top:13px; }
        .mf-small-action { display:inline-flex; align-items:center; gap:5px; border:1px solid rgba(255,255,255,.09); border-radius:10px; padding:7px 9px; font-size:9px; font-weight:850; color:rgba(255,255,255,.62); }
        .mf-small-action.primary { border-color:rgba(0,242,255,.22); color:var(--brand-primary,#00f2ff); background:rgba(0,242,255,.07); }
        .mf-next-bill { margin-top:11px; border-top:1px solid rgba(255,255,255,.07); padding-top:10px; font-size:9px; color:rgba(255,255,255,.43); }
        .mf-bill-dialog-backdrop { position:fixed; inset:0; z-index:135; display:grid; place-items:center; padding:15px; background:rgba(0,0,0,.8); backdrop-filter:blur(8px); }
        .mf-bill-dialog { width:min(580px,100%); max-height:92vh; overflow-y:auto; border:1px solid rgba(255,255,255,.11); border-radius:22px; background:#090909; box-shadow:0 30px 90px rgba(0,0,0,.65); }
        .mf-bill-dialog header { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:16px 18px; border-bottom:1px solid rgba(255,255,255,.08); }
        .mf-bill-dialog form { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:13px; padding:18px; }
        .mf-bill-field { font-size:9px; font-weight:850; text-transform:uppercase; color:rgba(255,255,255,.4); }
        .mf-bill-field input,.mf-bill-field select,.mf-bill-field textarea { width:100%; margin-top:6px; border:1px solid rgba(255,255,255,.1); border-radius:11px; padding:10px 11px; background:#121212; color:white; outline:none; }
        .mf-bill-field textarea { min-height:75px; resize:vertical; }
        .mf-edit-scope { grid-column:1/-1; display:grid; grid-template-columns:1fr 1fr; gap:8px; }
        .mf-edit-scope button { border:1px solid rgba(255,255,255,.09); border-radius:12px; padding:10px; text-align:left; font-size:10px; color:rgba(255,255,255,.5); }
        .mf-edit-scope button.active { border-color:rgba(0,242,255,.28); color:var(--brand-primary,#00f2ff); background:rgba(0,242,255,.06); }
        .mf-dialog-actions { grid-column:1/-1; display:flex; justify-content:flex-end; gap:8px; }
        @media(max-width:800px){ .mf-bills-metrics{grid-template-columns:1fr 1fr}.mf-bills-list{grid-template-columns:1fr} }
        @media(max-width:560px){ .mf-bill-dialog form{grid-template-columns:1fr}.mf-edit-scope{grid-template-columns:1fr}.mf-dialog-actions{grid-column:1}.mf-bills-metrics{grid-template-columns:1fr 1fr} }
      `}</style>

      <header className="mf-bills-heading">
        <div>
          <h2 className="flex items-center gap-2"><Repeat2 size={19} className="text-brand-primary" /> Contas fixas por mês</h2>
          <p>Uma conta recorrente gera automaticamente cada mês. O valor de um mês pode ser diferente sem alterar os anteriores.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => void load()} className="mf-small-action"><RefreshCcw size={13} /> Atualizar</button>
          <button type="button" onClick={() => setShowNew(true)} className="mf-small-action primary"><Plus size={13} /> Nova conta fixa</button>
        </div>
      </header>

      {(error || message) && <div className={`rounded-xl border px-4 py-2 text-xs ${error ? 'border-red-500/20 bg-red-500/10 text-red-300' : 'border-green-500/20 bg-green-500/10 text-green-300'}`}>{error || message}<button type="button" className="float-right" onClick={() => { setError(null); setMessage(null); }}><X size={14} /></button></div>}

      <div className="mf-bills-months">
        {months.map((month, index) => (
          <button key={month.key} type="button" className={`mf-month-chip ${selectedMonth === month.key ? 'active' : ''}`} onClick={() => setSelectedMonth(month.key)}>
            {index === 0 ? 'Este mês · ' : ''}{month.label}
          </button>
        ))}
      </div>

      <section className="mf-bills-metrics">
        <div className="mf-bills-metric"><span>Total do mês</span><strong>{money(selectedTotal)}</strong></div>
        <div className="mf-bills-metric"><span>Pendente</span><strong className="text-yellow-300">{money(pendingTotal)}</strong></div>
        <div className="mf-bills-metric"><span>Pago</span><strong className="text-green-300">{money(paidTotal)}</strong></div>
        <div className="mf-bills-metric"><span>Contas registradas</span><strong>{selectedRows.length}</strong></div>
      </section>

      <section className="mf-bills-list">
        {loading ? <div className="col-span-full flex min-h-44 items-center justify-center text-xs text-white/35">Carregando contas mensais...</div> : selectedRows.length === 0 ? (
          <div className="col-span-full flex min-h-44 flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 text-center text-xs text-white/35">
            <CircleDollarSign size={30} className="mb-3" />
            Nenhuma conta fixa para {monthLabel(selectedMonth)}.
          </div>
        ) : selectedRows.map((row) => {
          const next = nextOccurrence(row);
          return (
            <article key={row.id} className={`mf-occurrence-card ${row.status}`}>
              <div className="mf-occurrence-title">
                <div><h3>{row.fixed_bill.name}</h3><p>{row.fixed_bill.category || 'Conta fixa'} · vence {format(parseISO(row.due_date), 'dd/MM/yyyy')}</p></div>
                <span className={`mf-status ${row.status}`}>{row.status === 'paid' ? 'Paga' : 'Pendente'}</span>
              </div>
              <div className="mf-occurrence-value">{money(row.amount)}</div>
              {row.notes && <p className="mt-2 text-[9px] text-white/35">{row.notes}</p>}
              <div className="mf-occurrence-actions">
                <button type="button" className="mf-small-action" onClick={() => openEdit(row)}><Pencil size={12} /> Editar</button>
                {row.status === 'paid' ? (
                  <button type="button" className="mf-small-action" disabled={saving} onClick={() => void reopen(row)}><RefreshCcw size={12} /> Desfazer pagamento</button>
                ) : (
                  <button type="button" className="mf-small-action primary" disabled={saving} onClick={() => void pay(row)}><CheckCircle2 size={12} /> Marcar paga</button>
                )}
                {row.status !== 'paid' && <button type="button" className="mf-small-action" onClick={() => void skip(row)}>Ignorar mês</button>}
                <button type="button" className="mf-small-action text-red-300" onClick={() => void endRecurring(row)}><Trash2 size={12} /> Encerrar recorrência</button>
              </div>
              {row.status === 'paid' && next && (
                <div className="mf-next-bill"><strong className="text-brand-primary">Próximo mês já registrado:</strong> {monthLabel(next.competence)} · {money(next.amount)} · vence {format(parseISO(next.due_date), 'dd/MM')}</div>
              )}
            </article>
          );
        })}
        {ignoredRows.length > 0 && <div className="col-span-full text-[9px] text-white/25">{ignoredRows.length} conta(s) ignorada(s) somente neste mês.</div>}
      </section>

      <div className="flex items-center justify-between text-[9px] text-white/30">
        <button type="button" className="flex items-center gap-1" onClick={() => {
          const index = months.findIndex((month) => month.key === selectedMonth);
          if (index > 0) setSelectedMonth(months[index - 1].key);
        }}><ChevronLeft size={12} /> Mês anterior</button>
        <span><CalendarDays size={12} className="mr-1 inline" /> Os meses futuros são criados automaticamente.</span>
        <button type="button" className="flex items-center gap-1" onClick={() => {
          const index = months.findIndex((month) => month.key === selectedMonth);
          if (index >= 0 && index < months.length - 1) setSelectedMonth(months[index + 1].key);
        }}>Próximo mês <ChevronRight size={12} /></button>
      </div>

      {showNew && (
        <div className="mf-bill-dialog-backdrop">
          <div className="mf-bill-dialog">
            <header><div><strong>Nova conta fixa</strong><p className="mt-1 text-[9px] text-white/35">Ela será repetida automaticamente nos próximos meses.</p></div><button type="button" onClick={() => setShowNew(false)}><X size={18} /></button></header>
            <form onSubmit={createRecurring}>
              <label className="mf-bill-field">Nome<input required value={newForm.name} onChange={(event) => setNewForm({ ...newForm, name: event.target.value })} placeholder="Ex.: Energia elétrica" /></label>
              <label className="mf-bill-field">Valor padrão<input required type="number" min="0.01" step="0.01" value={newForm.amount} onChange={(event) => setNewForm({ ...newForm, amount: event.target.value })} /></label>
              <label className="mf-bill-field">Dia padrão<input required type="number" min="1" max="31" value={newForm.dueDay} onChange={(event) => setNewForm({ ...newForm, dueDay: event.target.value })} /></label>
              <label className="mf-bill-field">Categoria<select value={newForm.category} onChange={(event) => setNewForm({ ...newForm, category: event.target.value })}>{CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select></label>
              <div className="mf-dialog-actions"><button type="button" className="mf-small-action" onClick={() => setShowNew(false)}>Cancelar</button><button className="mf-small-action primary" disabled={saving}><Save size={13} /> {saving ? 'Salvando...' : 'Criar recorrência'}</button></div>
            </form>
          </div>
        </div>
      )}

      {editing && (
        <div className="mf-bill-dialog-backdrop">
          <div className="mf-bill-dialog">
            <header><div><strong>Editar {editing.fixed_bill.name}</strong><p className="mt-1 text-[9px] text-white/35">Escolha se a mudança vale somente para um mês ou para os próximos.</p></div><button type="button" onClick={() => setEditing(null)}><X size={18} /></button></header>
            <form onSubmit={saveEdit}>
              <div className="mf-edit-scope">
                <button type="button" disabled={editing.status === 'paid'} className={editScope === 'month' ? 'active' : ''} onClick={() => setEditScope('month')}><strong>Somente {monthLabel(editing.competence)}</strong><span className="mt-1 block text-[9px] opacity-60">Não altera os demais meses.</span></button>
                <button type="button" className={editScope === 'future' ? 'active' : ''} onClick={() => setEditScope('future')}><strong>{editing.status === 'paid' ? 'A partir do próximo mês' : 'Este e próximos meses'}</strong><span className="mt-1 block text-[9px] opacity-60">Atualiza o valor padrão futuro.</span></button>
              </div>
              <label className="mf-bill-field">Nome<input disabled={editScope === 'month'} value={editForm.name} onChange={(event) => setEditForm({ ...editForm, name: event.target.value })} /></label>
              <label className="mf-bill-field">Valor<input required type="number" min="0.01" step="0.01" value={editForm.amount} onChange={(event) => setEditForm({ ...editForm, amount: event.target.value })} /></label>
              <label className="mf-bill-field">Vencimento<input required type="date" value={editForm.dueDate} onChange={(event) => setEditForm({ ...editForm, dueDate: event.target.value })} /></label>
              <label className="mf-bill-field">Categoria<select disabled={editScope === 'month'} value={editForm.category} onChange={(event) => setEditForm({ ...editForm, category: event.target.value })}>{CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select></label>
              {editScope === 'month' && <label className="mf-bill-field col-span-full">Observação<textarea value={editForm.notes} onChange={(event) => setEditForm({ ...editForm, notes: event.target.value })} placeholder="Ex.: consumo maior neste mês" /></label>}
              <label className="mf-bill-field col-span-full">Forma usada ao marcar como paga<select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}><option value="pix">Pix</option><option value="debit_card">Cartão de débito</option><option value="boleto">Boleto</option><option value="bank_transfer">Transferência</option><option value="cash">Dinheiro</option></select></label>
              <div className="mf-dialog-actions"><button type="button" className="mf-small-action" onClick={() => setEditing(null)}>Cancelar</button><button className="mf-small-action primary" disabled={saving}><Save size={13} /> {saving ? 'Salvando...' : 'Salvar alteração'}</button></div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
