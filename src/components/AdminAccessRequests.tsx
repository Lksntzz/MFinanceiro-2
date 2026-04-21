import React, { useEffect, useMemo, useState } from "react";
import { User } from "@supabase/supabase-js";
import { CheckCircle2, Search, ShieldAlert, XCircle, Clock3, RefreshCw } from "lucide-react";
import { supabase } from "../lib/supabase";

type AccessFilter = "all" | "pending" | "approved" | "denied";
type AccessStatus = "pending" | "approved" | "denied";

interface AccessRequestItem {
  id: string;
  name: string;
  email: string;
  status: AccessStatus;
  createdAt: string;
  note: string | null;
}

function isAdminUser(user: User): boolean {
  const role = String(user.app_metadata?.role || "").toLowerCase();
  if (role === "admin" || role === "owner") return true;
  return user.user_metadata?.is_admin === true;
}

function normalizeStatus(raw: unknown): AccessStatus {
  const v = String(raw || "").toLowerCase();
  if (v === "approved" || v === "aprovado") return "approved";
  if (v === "denied" || v === "negado" || v === "rejected") return "denied";
  return "pending";
}

function mapStatusForSchema(status: AccessStatus, schemaVariant: "pt" | "en") {
  if (schemaVariant === "pt") {
    if (status === "approved") return "aprovado";
    if (status === "denied") return "negado";
    return "pendente";
  }
  if (status === "approved") return "approved";
  if (status === "denied") return "denied";
  return "pending";
}

function isColumnMismatch(error: any): boolean {
  const message = String(error?.message || "").toLowerCase();
  return message.includes("column") && message.includes("does not exist");
}

export default function AdminAccessRequests({ user }: { user: User }) {
  const [items, setItems] = useState<AccessRequestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<AccessFilter>("all");
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [schemaVariant, setSchemaVariant] = useState<"pt" | "en">("pt");

  const isAdmin = isAdminUser(user);

  const fetchRequests = async () => {
    if (!supabase || !isAdmin) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const { data, error } = await supabase
        .from("mf_access_requests")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;

      const rows = Array.isArray(data) ? data : [];
      const detectedVariant = rows.some((row: any) => "nome" in row || "observacao" in row)
        ? "pt"
        : "en";
      setSchemaVariant(detectedVariant);

      const normalized: AccessRequestItem[] = rows.map((row: any) => ({
        id: String(row.id),
        name: String(row.nome ?? row.name ?? ""),
        email: String(row.email ?? ""),
        status: normalizeStatus(row.status),
        createdAt: String(row.created_at ?? ""),
        note: (row.observacao ?? row.note ?? null) as string | null,
      }));

      setItems(normalized);
    } catch (err: any) {
      const errMsg = String(err?.message || "Falha ao carregar solicitações.");
      setError(errMsg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRequests();
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) {
      setError("Acesso restrito ao administrador.");
    }
  }, [isAdmin]);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((item) => {
      const passStatus = filter === "all" ? true : item.status === filter;
      const passQuery = !q
        ? true
        : item.name.toLowerCase().includes(q) || item.email.toLowerCase().includes(q);
      return passStatus && passQuery;
    });
  }, [items, filter, search]);

  const updateStatus = async (id: string, nextStatus: AccessStatus) => {
    if (!supabase || !isAdmin) {
      setError("Permissão negada para alterar solicitações.");
      return;
    }

    const exists = items.some((item) => item.id === id);
    if (!exists) {
      setError("Solicitação não encontrada.");
      return;
    }

    setSavingId(id);
    setError(null);
    setMessage(null);

    try {
      const nowIso = new Date().toISOString();

      const tryPt = await supabase
        .from("mf_access_requests")
        .update({
          status: mapStatusForSchema(nextStatus, "pt"),
          observacao: null,
          aprovado_por: user.id,
          aprovado_em: nowIso,
        })
        .eq("id", id)
        .select("id,status")
        .limit(1);

      let finalResult = tryPt;

      if (tryPt.error && isColumnMismatch(tryPt.error)) {
        const tryEn = await supabase
          .from("mf_access_requests")
          .update({
            status: mapStatusForSchema(nextStatus, "en"),
            note: null,
            approved_by: user.id,
            approved_at: nowIso,
          })
          .eq("id", id)
          .select("id,status")
          .limit(1);
        finalResult = tryEn;
      }

      if (finalResult.error) throw finalResult.error;

      const updatedRow = Array.isArray(finalResult.data) ? finalResult.data[0] : null;
      if (!updatedRow) {
        setError("Solicitação inexistente ou já alterada por outro admin.");
        await fetchRequests();
        return;
      }

      setItems((prev) =>
        prev.map((item) =>
          item.id === id ? { ...item, status: normalizeStatus(updatedRow.status) } : item,
        ),
      );
      setMessage(nextStatus === "approved" ? "Solicitação aprovada." : "Solicitação negada.");
    } catch (err: any) {
      setError(String(err?.message || "Falha ao atualizar solicitação."));
      await fetchRequests();
    } finally {
      setSavingId(null);
    }
  };

  if (!isAdmin) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="glass-card !p-6 max-w-md text-center border-red-500/20">
          <ShieldAlert className="mx-auto text-red-400 mb-3" size={28} />
          <h3 className="text-sm font-bold text-red-400 uppercase tracking-widest">Acesso restrito</h3>
          <p className="text-xs text-white/50 mt-2">Esta área é exclusiva para administradores.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col gap-4 overflow-hidden animate-fade-in">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">Solicitações de acesso</h2>
          <p className="text-[10px] text-white/40 uppercase font-bold tracking-widest">
            Gestão manual de aprovação
          </p>
        </div>
        <button
          onClick={fetchRequests}
          disabled={loading}
          className="px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-xs font-bold text-white/70 hover:bg-white/10 transition-all disabled:opacity-50 flex items-center gap-2"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          Atualizar
        </button>
      </div>

      <div className="glass-card !p-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome ou e-mail"
            className="w-full bg-white/5 border border-white/10 rounded-xl py-2.5 pl-9 pr-3 text-sm outline-none focus:border-brand-primary"
          />
        </div>
        <div className="flex items-center gap-2">
          {(["all", "pending", "approved", "denied"] as AccessFilter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-2 rounded-lg text-xs font-bold uppercase tracking-widest transition-all ${
                filter === f
                  ? "bg-brand-primary text-black"
                  : "bg-white/5 text-white/50 hover:bg-white/10 hover:text-white"
              }`}
            >
              {f === "all" ? "Todos" : f === "pending" ? "Pendente" : f === "approved" ? "Aprovado" : "Negado"}
            </button>
          ))}
        </div>
      </div>

      {message && (
        <div className="p-3 rounded-xl bg-green-500/10 border border-green-500/20 text-green-400 text-sm">
          {message}
        </div>
      )}
      {error && (
        <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
          {error}
        </div>
      )}

      <div className="glass-card !p-0 overflow-hidden flex-1 min-h-0">
        {loading ? (
          <div className="h-full flex items-center justify-center text-white/30 uppercase text-xs font-bold tracking-widest">
            Carregando solicitações...
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="h-full flex items-center justify-center text-white/30 uppercase text-xs font-bold tracking-widest">
            Nenhuma solicitação encontrada
          </div>
        ) : (
          <div className="h-full overflow-auto no-scrollbar">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-[#0a0a0a] border-b border-white/10">
                <tr>
                  <th className="py-3 px-4 text-[10px] uppercase tracking-widest text-white/40">Nome</th>
                  <th className="py-3 px-4 text-[10px] uppercase tracking-widest text-white/40">E-mail</th>
                  <th className="py-3 px-4 text-[10px] uppercase tracking-widest text-white/40">Status</th>
                  <th className="py-3 px-4 text-[10px] uppercase tracking-widest text-white/40">Solicitado em</th>
                  <th className="py-3 px-4 text-[10px] uppercase tracking-widest text-white/40">Observação</th>
                  <th className="py-3 px-4 text-[10px] uppercase tracking-widest text-white/40 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((item) => (
                  <tr key={item.id} className="border-b border-white/5">
                    <td className="py-3 px-4 font-semibold">{item.name || "-"}</td>
                    <td className="py-3 px-4 text-white/70">{item.email}</td>
                    <td className="py-3 px-4">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-widest ${
                          item.status === "approved"
                            ? "bg-green-500/10 text-green-400"
                            : item.status === "denied"
                              ? "bg-red-500/10 text-red-400"
                              : "bg-yellow-500/10 text-yellow-400"
                        }`}
                      >
                        {item.status === "approved" ? (
                          <CheckCircle2 size={12} />
                        ) : item.status === "denied" ? (
                          <XCircle size={12} />
                        ) : (
                          <Clock3 size={12} />
                        )}
                        {item.status === "approved"
                          ? "Aprovado"
                          : item.status === "denied"
                            ? "Negado"
                            : "Pendente"}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-white/60">
                      {item.createdAt ? new Date(item.createdAt).toLocaleString("pt-BR") : "-"}
                    </td>
                    <td className="py-3 px-4 text-white/50">{item.note || "-"}</td>
                    <td className="py-3 px-4">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => updateStatus(item.id, "approved")}
                          disabled={savingId === item.id || item.status !== "pending"}
                          className="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-green-500/15 text-green-400 hover:bg-green-500/25 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          Aprovar
                        </button>
                        <button
                          onClick={() => updateStatus(item.id, "denied")}
                          disabled={savingId === item.id || item.status !== "pending"}
                          className="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-red-500/15 text-red-400 hover:bg-red-500/25 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          Negar
                        </button>
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

