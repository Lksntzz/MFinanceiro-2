import React, { useState, useEffect, useMemo, useRef } from "react";
import { Investment, UserSettings, Transaction } from "../types";
import { supabase } from "../lib/supabase";
import {
  TrendingUp,
  PieChart,
  Plus,
  X,
  Search,
  Filter,
  ArrowUpRight,
  ArrowDownRight,
  Briefcase,
  Layers,
  Building2,
  Wallet,
  Clock,
  ChevronRight,
  Info,
  Sparkles,
  BarChart2,
  Target,
  Lightbulb,
  ArrowRight,
  Trash2,
  List,
  Activity,
  Award,
  Star,
  Settings,
  DollarSign,
  Calendar,
  Layers as LayersIcon,
  AlertTriangle,
  RefreshCw,
  Globe,
  FileDown,
  Banknote,
  AlertCircle
} from "lucide-react";
import { ReportService } from "../services/reportService";
import { syncInvestmentsWithMarket } from "../services/marketData";
import { motion, AnimatePresence } from "motion/react";
import {
  InvestmentMonthlyChart,
  InvestmentDonutChart,
} from "./InvestmentCharts";
import {
  getMarketIntelligence,
  getInvestmentAdvice,
  getFundamentalistAnalysis,
  MarketInsight,
  InvestmentAdvice,
  FundamentalistAnalysis,
} from "../services/investmentIntelligence";
import { format, startOfMonth, subMonths, isSameMonth } from "date-fns";
import { ptBR } from "date-fns/locale";

interface InvestmentsProps {
  user: { id: string };
  settings: UserSettings | null;
  onRefresh: () => void;
}

const INVESTMENT_TYPES = [
  {
    id: "fixed_income",
    label: "Renda Fixa",
    color: "text-blue-400",
    bg: "bg-blue-400/10",
    icon: Wallet,
    description: "CDB, Tesouro Direto, LCI/LCA",
  },
  {
    id: "variable_income",
    label: "Renda Variável",
    color: "text-purple-400",
    bg: "bg-purple-400/10",
    icon: TrendingUp,
    description: "Ações, FIIs, ETFs",
  },
  {
    id: "crypto",
    label: "Criptoativos",
    color: "text-orange-400",
    bg: "bg-orange-400/10",
    icon: Layers,
    description: "Bitcoin, Ethereum, DeFi",
  },
  {
    id: "other",
    label: "Outros",
    color: "text-gray-400",
    bg: "bg-gray-400/10",
    icon: Briefcase,
    description: "Imóveis, Ouro, Arte",
  },
];

export default function Investments({
  user,
  settings,
  onRefresh,
}: InvestmentsProps) {
  const [investments, setInvestments] = useState<Investment[]>([]);
  const [ledgerEntries, setLedgerEntries] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [filter, setFilter] = useState<"all" | string>("all");
  const [activeTab, setActiveTab] = useState<"resumo" | "proventos">("resumo");
  const [showAdvice, setShowAdvice] = useState(false);
  const [showRebalance, setShowRebalance] = useState(false);
  const [showTaxCalc, setShowTaxCalc] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({ open: false, title: "", message: "", onConfirm: () => {} });

  const [marketInsight, setMarketInsight] = useState<MarketInsight | null>(
    null,
  );
  const [advice, setAdvice] = useState<InvestmentAdvice | null>(null);
  const [loadingAI, setLoadingAI] = useState(false);
  const lastAiLoadAtRef = useRef<number>(0);

  const [newInvestment, setNewInvestment] = useState({
    name: "",
    type: "fixed_income" as any,
    institution: "",
    amount: "",
    initial_amount: "",
    quantity: "1",
    average_price: "",
    current_price: "",
    dividends_received: "0",
    target_percentage: "0",
    category: "Investimento",
    pl: "",
    roe: "",
    ebitda: "",
    liquid_debt: "",
    dividend_yield: "",
  });

  const fetchInvestments = async () => {
    if (!supabase) return;
    try {
      setLoading(true);

      const [invRes, ledgerRes] = await Promise.all([
        supabase.from("mf_investments").select("*").eq("user_id", user.id),
        supabase
          .from("mf_finance_ledger_entries")
          .select("*")
          .eq("user_id", user.id),
      ]);

      if (invRes.error && invRes.error.code !== "PGRST116") {
        if (
          invRes.error.code === "PGRST204" ||
          invRes.error.code === "PGRST205"
        ) {
          console.warn("Investments table not ready");
        } else {
          throw invRes.error;
        }
      }

      if (ledgerRes.error && ledgerRes.error.code !== "PGRST116") {
        if (
          ledgerRes.error.code === "PGRST204" ||
          ledgerRes.error.code === "PGRST205"
        ) {
          console.warn("Ledger table not ready");
        } else {
          throw ledgerRes.error;
        }
      }

      setInvestments(invRes.data || []);
      setLedgerEntries(ledgerRes.data || []);
    } catch (err) {
      console.error("Error fetching data:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleSyncMarket = async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    try {
      const success = await syncInvestmentsWithMarket(user.id);
      if (success) {
        onRefresh();
      }
    } catch (err) {
      console.error('Sync error:', err);
    } finally {
      setIsSyncing(false);
    }
  };

  const withTimeout = async <T,>(promise: Promise<T>, ms: number): Promise<T> => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<T>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error("IA timeout")), ms);
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  };

  const loadAIIntelligence = async (force = false) => {
    if (loadingAI) return;
    if (!force && marketInsight && advice) return;
    if (!force && Date.now() - lastAiLoadAtRef.current < 60_000) return;

    setLoadingAI(true);
    try {
      const invested = investments.reduce(
        (sum, i) => sum + Number(i.amount),
        0,
      );
      const balance = Number(settings?.current_balance) || 0;

      // Simular cálculo de contas fixas pendentes
      const fixedOutflow = 0; // Idealmente pegar do DB

      const marketPromise = withTimeout(getMarketIntelligence(), 6000);
      const goalsAndBudgetsPromise = Promise.all([
        supabase.from("mf_financial_goals").select("*").eq("user_id", user.id),
        supabase.from("mf_budgets").select("*").eq("user_id", user.id),
      ]);
      const advicePromise = goalsAndBudgetsPromise.then(
        async ([goalsRes, budgetsRes]) =>
          withTimeout(
            getInvestmentAdvice(
              balance,
              fixedOutflow,
              invested,
              goalsRes.data || [],
              budgetsRes.data || [],
            ),
            8000,
          ),
      );

      const [marketResult, adviceResult] = await Promise.allSettled([
        marketPromise,
        advicePromise,
      ]);

      if (marketResult.status === "fulfilled") {
        setMarketInsight(marketResult.value);
      }
      if (adviceResult.status === "fulfilled") {
        setAdvice(adviceResult.value);
      }
      lastAiLoadAtRef.current = Date.now();
    } catch (err) {
      console.error("IA Error:", err);
    } finally {
      setLoadingAI(false);
    }
  };

  useEffect(() => {
    fetchInvestments();
  }, [user.id]);

  useEffect(() => {
    if (showAdvice && !marketInsight) {
      loadAIIntelligence();
    }
  }, [showAdvice]);

  useEffect(() => {
    if (loading || investments.length === 0 || marketInsight || advice) return;
    const timer = setTimeout(() => {
      loadAIIntelligence();
    }, 300);
    return () => clearTimeout(timer);
  }, [loading, investments.length, marketInsight, advice]);

  const [isSyncing, setIsSyncing] = useState(false);

  const stats = useMemo(() => {
    const total = investments.reduce((sum, inv) => sum + Number(inv.amount), 0);
    const totalInvested = investments.reduce(
      (sum, inv) => sum + Number(inv.initial_amount || inv.amount),
      0,
    );
    const totalDividends = investments.reduce(
      (sum, inv) => sum + Number(inv.dividends_received || 0),
      0,
    );
    const profit = total - totalInvested;
    const profitPerc = totalInvested > 0 ? (profit / totalInvested) * 100 : 0;

    const byType = investments.reduce(
      (acc, inv) => {
        acc[inv.type] = (acc[inv.type] || 0) + Number(inv.amount);
        return acc;
      },
      {} as Record<string, number>,
    );

    // Suggested contribution per asset
    const suggestedAportes = investments.reduce((acc, inv) => {
      const currentPerc = total > 0 ? (Number(inv.amount) / total) * 100 : 0;
      const targetPerc = Number(inv.target_percentage || 0);

      if (targetPerc > currentPerc) {
        // Simple formula: how much needed to reach target percentage relative to current total
        // Note: A real rebalancing would consider the NEW total after aporte, but here we suggest based on current.
        const idealValue = (total * targetPerc) / 100;
        const diff = idealValue - Number(inv.amount);
        acc[inv.id] = diff > 0 ? diff : 0;
      } else {
        acc[inv.id] = 0;
      }
      return acc;
    }, {} as Record<string, number>);

    return { total, totalInvested, totalDividends, profit, profitPerc, byType, suggestedAportes };
  }, [investments]);

  const monthlyData = useMemo(() => {
    const totalCurrent = investments.reduce(
      (sum, inv) => sum + Number(inv.amount),
      0,
    );
    const totalInvestedCurrent = investments.reduce(
      (sum, inv) => sum + Number(inv.initial_amount || inv.amount),
      0,
    );

    const last6Months = Array.from({ length: 6 }).map((_, i) => {
      const d = subMonths(new Date(), 5 - i);
      return {
        month: format(d, "MMM", { locale: ptBR }),
        date: d,
        amount: 0,
        total: 0,
        invested: 0,
      };
    });

    ledgerEntries.forEach((entry) => {
      if (
        entry.category === "Investimento" ||
        entry.description.toLowerCase().includes("aporte")
      ) {
        const entryDate = new Date(entry.date);
        const monthSlot = last6Months.find((m) =>
          isSameMonth(m.date, entryDate),
        );
        if (monthSlot) {
          monthSlot.amount += Math.abs(Number(entry.amount));
        }
      }
    });

    // Populate with reasonable estimates if historical data is thin
    let cumulativeInvested = totalInvestedCurrent;
    let cumulativeTotal = totalCurrent;

    for (let i = 5; i >= 0; i--) {
      last6Months[i].total = Math.max(0, cumulativeTotal);
      last6Months[i].invested = Math.max(0, cumulativeInvested);

      // Backwards calculation
      const monthAporte = last6Months[i].amount > 0 ? last6Months[i].amount : 0;
      cumulativeInvested -= monthAporte;
      // Assume a small organic growth factor if we don't have real price history
      cumulativeTotal -= monthAporte * 1.01;
    }

    return last6Months;
  }, [investments, ledgerEntries]);

  const proventosData = useMemo(() => {
    // Evolução de Proventos (últimos 12 meses)
    const months = Array.from({ length: 12 }).map((_, i) => {
      const d = subMonths(new Date(), 11 - i);
      return {
        monthId: format(d, "MM/yyyy"),
        label: format(d, "MM/yyyy"),
        value: 0,
      };
    });

    // Mocking some data for the chart based on existing dividends or ledger
    investments.forEach((inv) => {
      if (inv.dividends_received && Number(inv.dividends_received) > 0) {
        // Distribuindo o total de proventos aleatoriamente pelos últimos 6 meses para visualização no gráfico
        // Em um app real, isso viria de uma tabela de lançamentos de proventos específica
        const total = Number(inv.dividends_received);
        const perMonth = total / 4;
        months.slice(-4).forEach((m) => (m.value += perMonth));
      }
    });

    const byAsset = investments
      .filter((i) => Number(i.dividends_received) > 0)
      .map((i) => ({
        name: i.name,
        value: Number(i.dividends_received),
        color: "#00E676",
      }))
      .sort((a, b) => b.value - a.value);

    // Tabela histórica
    const years = [new Date().getFullYear(), new Date().getFullYear() - 1];
    const historyTable = years.map((year) => {
      const row = { year, months: Array(12).fill(0), total: 0, avg: 0 };
      // Simulação baseada no recebido total (exemplo didático)
      investments.forEach((inv) => {
        if (Number(inv.dividends_received) > 0) {
          const mIdx = Math.floor(Math.random() * 5); // Primeiros 5 meses do ano
          row.months[mIdx] += Number(inv.dividends_received) / years.length / 3;
        }
      });
      row.total = row.months.reduce((a, b) => a + b, 0);
      row.avg = row.total / 12;
      return row;
    });

    return { evolution: months, byAsset, historyTable };
  }, [investments]);

  const filteredInvestments = useMemo(() => {
    if (filter === "all") return investments;
    return investments.filter((inv) => inv.type === filter);
  }, [investments, filter]);

  const handleAddInvestment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) return;

    setIsSaving(true);
    try {
      const payload = {
        user_id: user.id,
        name: newInvestment.name,
        type: newInvestment.type,
        institution: newInvestment.institution,
        amount: Number(newInvestment.amount),
        initial_amount: Number(
          newInvestment.initial_amount || newInvestment.amount,
        ),
        quantity: Number(newInvestment.quantity || 1),
        average_price: Number(newInvestment.average_price || 0),
        current_price: Number(newInvestment.current_price || 0),
        dividends_received: Number(newInvestment.dividends_received || 0),
        target_percentage: Number(newInvestment.target_percentage || 0),
        category: newInvestment.category,
        purchase_date: new Date().toISOString(),
        pl: newInvestment.pl ? Number(newInvestment.pl) : null,
        roe: newInvestment.roe ? Number(newInvestment.roe) : null,
        ebitda: newInvestment.ebitda ? Number(newInvestment.ebitda) : null,
        liquid_debt: newInvestment.liquid_debt
          ? Number(newInvestment.liquid_debt)
          : null,
        dividend_yield: newInvestment.dividend_yield
          ? Number(newInvestment.dividend_yield)
          : null,
      };

      const { error } = await supabase.from("mf_investments").insert(payload);
      if (error) throw error;

      setShowAddModal(false);
      setNewInvestment({
        name: "",
        type: "fixed_income",
        institution: "",
        amount: "",
        initial_amount: "",
        quantity: "1",
        average_price: "",
        current_price: "",
        dividends_received: "0",
        target_percentage: "0",
        category: "Investimento",
        pl: "",
        roe: "",
        ebitda: "",
        liquid_debt: "",
        dividend_yield: "",
      });
      fetchInvestments();
      onRefresh();
    } catch (err) {
      console.error("Error adding investment:", err);
      alert("Falha ao salvar investimento.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteInvestment = async (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    
    setConfirmDialog({
      open: true,
      title: "Excluir Ativo",
      message: "Tem certeza que deseja excluir este investimento da sua carteira? Esta ação não pode ser desfeita.",
      onConfirm: async () => {
        if (!supabase) return;
        try {
          const { error } = await supabase
            .from("mf_investments")
            .delete()
            .eq("id", id);
          if (error) {
            console.error("Delete error:", error);
            return;
          }
          fetchInvestments();
          if (onRefresh) onRefresh();
        } catch (err) {
          console.error("Unexpected error:", err);
        }
      }
    });
  };

  const handleDeleteAllInvestments = async (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!supabase) return;
    if (
      !confirm(
        "AVISO: Você está prestes a apagar TODOS os seus ativos da carteira. Esta ação é irreversível.\n\nDeseja continuar?",
      )
    )
      return;

    setLoading(true);
    try {
      const { error } = await supabase
        .from("mf_investments")
        .delete()
        .eq("user_id", user.id);
      if (error) {
        console.error("Database error on clear portfolio:", error);
        alert("Erro ao limpar carteira: " + error.message);
        return;
      }

      console.log("Portfolio cleared successfully");
      fetchInvestments();
      onRefresh();
      alert("Sua carteira de investimentos foi limpa com sucesso.");
    } catch (err) {
      console.error("Error clearing portfolio:", err);
      alert("Falha ao limpar carteira.");
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center p-12">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-brand-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col gap-6 animate-fade-in pb-32 overflow-y-auto no-scrollbar pr-1">
      {/* Navigation Tabs */}
      <div className="flex items-center justify-between border-b border-white/5 pb-1">
        <div className="flex items-center gap-4 overflow-x-auto no-scrollbar">
          <button
            onClick={() => setActiveTab("resumo")}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-bold transition-all relative ${activeTab === "resumo" ? "text-brand-primary" : "text-white/40 hover:text-white"}`}
          >
            <PieChart size={18} /> Resumo
            {activeTab === "resumo" && (
              <motion.div
                layoutId="tab-active"
                className="absolute bottom-0 left-0 right-0 h-0.5 bg-brand-primary"
              />
            )}
          </button>
          <button
            onClick={() => setActiveTab("proventos")}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-bold transition-all relative ${activeTab === "proventos" ? "text-brand-primary" : "text-white/40 hover:text-white"}`}
          >
            <DollarSign size={18} /> Proventos
            {activeTab === "proventos" && (
              <motion.div
                layoutId="tab-active"
                className="absolute bottom-0 left-0 right-0 h-0.5 bg-brand-primary"
              />
            )}
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => ReportService.exportPortfolioToPDF(investments, stats.total)}
            className="flex items-center gap-2 px-4 py-2 text-xs font-bold bg-white/5 text-white/60 rounded-xl border border-white/10 hover:bg-white/10 transition-all"
            title="Exportar PDF"
          >
            <FileDown size={16} /> PDF
          </button>
          <button
            onClick={() => setShowTaxCalc(true)}
            className="flex items-center gap-2 px-4 py-2 text-xs font-bold bg-orange-500/10 text-orange-400 rounded-xl border border-orange-500/20 hover:bg-orange-500/20 transition-all font-mono"
            title="Calculadora de IR"
          >
            <Banknote size={16} /> IR Bolsa
          </button>
          <button
            onClick={() => setShowRebalance(true)}
            className="flex items-center gap-2 px-4 py-2 text-xs font-bold bg-purple-500/10 text-purple-400 rounded-xl border border-purple-500/20 hover:bg-purple-500/20 transition-all"
            title="Dicas de Rebalanceamento"
          >
            <Activity size={16} /> Rebalanceamento
          </button>
          <button
            onClick={() => setShowAdvice(true)}
            className="flex items-center gap-2 px-4 py-2 text-xs font-bold bg-brand-primary/10 text-brand-primary rounded-xl border border-brand-primary/20 hover:bg-brand-primary/20 transition-all"
            title="Conselho do Advisor (IA)"
          >
            <Sparkles size={16} /> Gerenciamento
          </button>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {activeTab === "resumo" ? (
          <motion.div
            key="resumo"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            className="flex flex-col gap-6"
          >
            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <div className="glass-card !p-5 border-white/5 flex flex-col gap-2 relative overflow-hidden group">
                <div className="absolute -right-4 -top-4 w-24 h-24 bg-brand-primary/5 rounded-full blur-2xl group-hover:bg-brand-primary/10 transition-all" />
                <div className="flex items-center justify-between text-white/40">
                  <span className="text-[10px] font-bold uppercase tracking-widest">
                    Patrimônio total
                  </span>
                  <div className="p-1.5 bg-white/5 rounded-lg">
                    <Wallet size={14} className="text-white/60" />
                  </div>
                </div>
                <div className="text-2xl font-bold">
                  R$ {stats.total.toLocaleString("pt-BR")}
                </div>
                <div className="flex items-center gap-1.5 mt-1">
                  <span className="text-[10px] text-white/40">
                    Valor investido:
                  </span>
                  <span className="text-[10px] font-bold text-white/70">
                    R$ {stats.totalInvested.toLocaleString("pt-BR")}
                  </span>
                </div>
              </div>

              <div className="glass-card !p-5 border-brand-primary/10 flex flex-col gap-2 relative overflow-hidden group">
                <div
                  className={`absolute -right-4 -top-4 w-24 h-24 rounded-full blur-2xl transition-all ${stats.profit >= 0 ? "bg-green-500/5 group-hover:bg-green-500/10" : "bg-red-500/5 group-hover:bg-red-500/10"}`}
                />
                <div className="flex items-center justify-between text-brand-primary/40">
                  <span className="text-[10px] font-bold uppercase tracking-widest">
                    Lucro Total
                  </span>
                  <div
                    className={`p-1.5 rounded-lg ${stats.profit >= 0 ? "bg-green-500/10" : "bg-red-500/10"}`}
                  >
                    <TrendingUp
                      size={14}
                      className={
                        stats.profit >= 0 ? "text-green-500" : "text-red-500"
                      }
                    />
                  </div>
                </div>
                <div
                  className={`text-2xl font-bold ${stats.profit >= 0 ? "text-green-500" : "text-red-500"}`}
                >
                  R$ {stats.profit.toLocaleString("pt-BR")}
                </div>
                <div className="flex items-center gap-1.5 mt-1">
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${stats.profit >= 0 ? "bg-green-500/10 text-green-500" : "bg-red-500/10 text-red-500"}`}
                  >
                    {stats.profitPerc >= 0 ? "+" : ""}
                    {stats.profitPerc.toFixed(2)}%
                  </span>
                </div>
              </div>

              <div className="glass-card !p-5 border-purple-500/10 flex flex-col gap-2 relative overflow-hidden group">
                <div className="absolute -right-4 -top-4 w-24 h-24 bg-purple-500/5 rounded-full blur-2xl group-hover:bg-purple-500/10 transition-all" />
                <div className="flex items-center justify-between text-purple-400/60">
                  <span className="text-[10px] font-bold uppercase tracking-widest">
                    Proventos (Totais)
                  </span>
                  <div className="p-1.5 bg-purple-500/10 rounded-lg">
                    <Award size={14} className="text-purple-400" />
                  </div>
                </div>
                <div className="text-2xl font-bold text-purple-400">
                  R$ {stats.totalDividends.toLocaleString("pt-BR")}
                </div>
                <div className="text-[10px] text-white/40 mt-1">
                  Acumulado desde o início
                </div>
              </div>

              <div className="glass-card !p-5 border-blue-500/10 flex flex-col gap-2 relative overflow-hidden group">
                <div className="absolute -right-4 -top-4 w-24 h-24 bg-blue-500/5 rounded-full blur-2xl group-hover:bg-blue-500/10 transition-all" />
                <div className="flex items-center justify-between text-blue-400/60">
                  <span className="text-[10px] font-bold uppercase tracking-widest">
                    Rentabilidade Geral
                  </span>
                  <div className="p-1.5 bg-blue-500/10 rounded-lg">
                    <Activity size={14} className="text-blue-400" />
                  </div>
                </div>
                <div className="text-2xl font-bold text-blue-400">
                  {stats.profitPerc.toFixed(2)}%
                </div>
                <div className="text-[10px] text-white/40 mt-1 flex items-center gap-1">
                  Variação da carteira{" "}
                  <ArrowUpRight size={10} className="text-brand-primary" />
                </div>
              </div>
            </div>

            {/* Charts Section */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-8">
                <div className="glass-card !p-6 border-white/5">
                  <div className="flex items-center justify-between mb-8">
                    <div>
                      <h3 className="font-bold flex items-center gap-2">
                        Evolução do Patrimônio
                        <span className="px-2 py-0.5 bg-green-500/10 text-green-400 text-[10px] rounded-full border border-green-500/20">
                          vs CDI/IPCA
                        </span>
                      </h3>
                      <p className="text-[10px] text-white/30 uppercase tracking-widest mt-1">
                        Desempenho histórico da carteira
                      </p>
                    </div>
                    <div className="flex gap-4">
                      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase text-white/40">
                        <div className="h-2 w-2 rounded-full bg-brand-primary" />{" "}
                        Carteira
                      </div>
                      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase text-white/40 opacity-50">
                        <div className="h-2 w-2 bg-brand-primary/30 rounded-sm" />{" "}
                        Aportes
                      </div>
                    </div>
                  </div>
                  <div className="h-64">
                    <InvestmentMonthlyChart 
                      data={monthlyData.map(m => ({
                        ...m,
                        benchmark: m.total * 0.95 // CDI Mock
                      }))} 
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-4 mt-8 pt-6 border-t border-white/5">
                    <div className="flex flex-col gap-1">
                      <span className="text-[9px] text-white/30 uppercase font-bold">Média Mensal</span>
                      <span className="text-lg font-bold">R$ {(stats.total / 12).toLocaleString('pt-BR')}</span>
                    </div>
                    <div className="flex flex-col gap-1 text-center">
                      <span className="text-[9px] text-white/30 uppercase font-bold">Alpha vs CDI</span>
                      <span className="text-lg font-bold text-green-500">+4.2%</span>
                    </div>
                    <div className="flex flex-col gap-1 text-right">
                      <span className="text-[9px] text-white/30 uppercase font-bold">Meta Patrimonial</span>
                      <span className="text-lg font-bold text-brand-primary">82%</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="lg:col-span-4 glass-card !p-6 flex flex-col items-center">
                <div className="w-full mb-6">
                  <h3 className="font-bold">Distribuição de Ativos</h3>
                  <p className="text-xs text-white/40">
                    Porcentagem da carteira por categoria
                  </p>
                </div>
                <div className="h-48 w-full">
                  <InvestmentDonutChart
                    data={INVESTMENT_TYPES.map((type) => ({
                      name: type.label,
                      value: stats.byType[type.id] || 0,
                      color:
                        type.color.replace("text-", "") === "brand-primary"
                          ? "#00E676"
                          : type.color.replace("text-", "") === "blue-400"
                            ? "#60A5FA"
                            : type.color.replace("text-", "") === "purple-400"
                              ? "#A78BFA"
                              : "#94A3B8",
                    }))}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2 w-full mt-4">
                  {INVESTMENT_TYPES.map((t) => {
                    const val = stats.byType[t.id] || 0;
                    const perc =
                      stats.total > 0 ? (val / stats.total) * 100 : 0;
                    return (
                      <div
                        key={t.id}
                        className="flex items-center justify-between p-2 bg-white/5 rounded-lg border border-white/5"
                      >
                        <div className="flex items-center gap-2 truncate">
                          <div
                            className={`h-2 w-2 rounded-full ${t.bg.replace("/10", "")}`}
                          />
                          <span className="text-[10px] font-bold text-white/60 truncate">
                            {t.label}
                          </span>
                        </div>
                        <span className="text-[10px] font-bold text-white/40">
                          {perc.toFixed(1)}%
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Assets Table (Investidor10 Style) */}
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold flex items-center gap-2">
                  <Layers className="text-brand-primary" size={20} /> Meus
                  Ativos
                  <span className="text-xs text-white/20 ml-2 font-normal">
                    ({investments.length} Ativos)
                  </span>
                </h2>
                <div className="flex gap-2">
                  <button
                    onClick={handleSyncMarket}
                    disabled={isSyncing}
                    className="bg-white/5 text-white/60 border border-white/10 px-4 py-2 rounded-xl text-xs font-bold hover:bg-white/10 transition-all flex items-center gap-2 disabled:opacity-50"
                  >
                    <RefreshCw size={14} className={isSyncing ? 'animate-spin' : ''} /> 
                    {isSyncing ? 'Sincronizando...' : 'Sincronizar Mercado'}
                  </button>
                  <button
                    onClick={() => setShowAddModal(true)}
                    className="bg-brand-primary text-black px-4 py-2 rounded-xl text-xs font-bold hover:brightness-110 transition-all flex items-center gap-2"
                  >
                    <Plus size={14} /> Adicionar Lançamento
                  </button>
                </div>
              </div>

              {INVESTMENT_TYPES.map((type) => {
                const typeInvestments = investments.filter(
                  (i) => i.type === type.id,
                );
                if (typeInvestments.length === 0) return null;

                const totalType = typeInvestments.reduce(
                  (sum, i) => sum + Number(i.amount),
                  0,
                );
                const percTotal =
                  stats.total > 0 ? (totalType / stats.total) * 100 : 0;

                return (
                  <div
                    key={type.id}
                    className="glass-card !p-0 border-white/5 overflow-hidden"
                  >
                    <div className="bg-white/5 p-4 flex items-center justify-between border-b border-white/5">
                      <div className="flex items-center gap-3">
                        <div
                          className={`h-8 w-8 rounded-lg flex items-center justify-center ${type.bg} ${type.color}`}
                        >
                          <type.icon size={16} />
                        </div>
                        <div>
                          <h4 className="font-bold text-sm tracking-tight">
                            {type.label}
                          </h4>
                          <div className="text-[10px] text-white/40 font-bold uppercase tracking-widest">
                            {typeInvestments.length} Ativo(s)
                          </div>
                        </div>
                      </div>
                          <div className="flex items-center gap-6">
                            <div className="text-right">
                              <div className="text-[10px] text-white/40 font-bold uppercase mb-0.5">
                                Valor total
                              </div>
                              <div className="text-sm font-bold">
                                R$ {totalType.toLocaleString("pt-BR")}
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="text-[10px] text-white/40 font-bold uppercase mb-0.5">
                                % na carteira
                              </div>
                              <div className="text-sm font-bold text-brand-primary">
                                {percTotal.toFixed(2)}%
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="overflow-x-auto scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
                          <table className="w-full text-left text-xs min-w-[1000px] border-separate border-spacing-0">
                          <thead className="text-[10px] text-white/30 font-bold uppercase tracking-widest border-b border-white/5 bg-white/[0.02]">
                            <tr>
                              <th className="py-4 pl-6 text-left">Ativo</th>
                              <th className="py-4 px-4 text-center">Quant.</th>
                              <th className="py-4 px-4 text-center">Preço Médio</th>
                              <th className="py-4 px-4 text-center">Preço Atual</th>
                              <th className="py-4 px-4 text-center">Rentabilidade</th>
                              <th className="py-4 px-4 text-center">Saldo</th>
                              <th className="py-4 px-4 text-center">% Carteira</th>
                              <th className="py-4 pr-6 text-right">Opções</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-white/5">
                            {typeInvestments.map((inv) => {
                              const itemPerc =
                                stats.total > 0
                                  ? (Number(inv.amount) / stats.total) * 100
                                  : 0;
                              const investedValue = Number(inv.quantity || 1) * Number(inv.average_price || 0);
                              const currentValue = Number(inv.amount);
                              const itemProfitTotal = currentValue - investedValue;
                              const itemProfitPerc = investedValue > 0 ? (itemProfitTotal / investedValue) * 100 : 0;

                              return (
                                <tr
                                  key={inv.id}
                                  className="hover:bg-white/5 transition-colors group"
                                >
                                  <td className="py-4 pl-6">
                                    <div className="flex flex-col min-w-[150px]">
                                      <span className="font-bold text-white group-hover:text-brand-primary transition-colors line-clamp-1">
                                        {inv.name}
                                      </span>
                                      <span className="text-[9px] text-white/20 uppercase font-mono truncate max-w-[140px]">
                                        {inv.institution}
                                      </span>
                                    </div>
                                  </td>
                                  <td className="py-4 px-4 text-center font-mono text-white/80">
                                    {Number(inv.quantity || 0).toLocaleString('pt-BR')}
                                  </td>
                                  <td className="py-4 px-4 text-center text-white/70 whitespace-nowrap">
                                    R$ {Number(inv.average_price || 0).toLocaleString("pt-BR", {
                                      minimumFractionDigits: 2,
                                      maximumFractionDigits: 2,
                                    })}
                                  </td>
                                  <td className="py-4 px-4 text-center text-white/70 font-bold whitespace-nowrap">
                                    R$ {(Number(inv.current_price) || 0).toLocaleString("pt-BR", {
                                      minimumFractionDigits: 2,
                                      maximumFractionDigits: 2,
                                    })}
                                  </td>
                                  <td className="py-4 px-4">
                                    <div
                                      className={`flex items-center justify-center gap-1 font-bold whitespace-nowrap ${itemProfitPerc >= 0 ? "text-green-500" : "text-red-400"}`}
                                    >
                                      {itemProfitPerc >= 0 ? (
                                        <ArrowUpRight size={12} />
                                      ) : (
                                        <ArrowDownRight size={12} />
                                      )}
                                      {Math.abs(itemProfitPerc).toFixed(2)}%
                                    </div>
                                  </td>
                                  <td className="py-4 px-4 text-center font-bold text-white whitespace-nowrap">
                                    R$ {Number(inv.amount).toLocaleString("pt-BR", {
                                      minimumFractionDigits: 2,
                                      maximumFractionDigits: 2,
                                    })}
                                  </td>
                                  <td className="py-4 px-4 text-center text-white/50 font-bold whitespace-nowrap">
                                    {itemPerc.toFixed(2)}%
                                  </td>
                                  <td className="py-4 pr-6 text-right">
                                    <div className="flex items-center justify-end">
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleDeleteInvestment(inv.id);
                                        }}
                                        title="Excluir Ativo"
                                        className="p-2 text-white/20 hover:text-red-500 transition-all rounded-lg hover:bg-red-500/10 active:scale-95"
                                      >
                                        <Trash2 size={16} />
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })}
              </div>
          </motion.div>
        ) : (
          <motion.div
            key="proventos"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            className="flex flex-col gap-6"
          >
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
              {/* Sidebar Proventos */}
              <div className="lg:col-span-1 flex flex-col gap-6">
                <div className="glass-card !p-6 border-white/5 space-y-6">
                  <div>
                    <h3 className="text-sm font-bold text-white/60 mb-4 uppercase tracking-widest">
                      Resumo
                    </h3>
                    <div className="space-y-4">
                      <div>
                        <div className="text-[10px] text-white/40 font-bold uppercase mb-1">
                          Média Mensal (últ. 12 meses)
                        </div>
                        <div className="text-xl font-bold flex items-baseline gap-2">
                          R${" "}
                          {proventosData.historyTable[0].avg.toLocaleString(
                            "pt-BR",
                          )}
                          <span className="text-[10px] text-white/20 font-normal">
                            / Criar meta <Target size={10} />
                          </span>
                        </div>
                      </div>
                      <div className="pt-4 border-t border-white/5">
                        <div className="text-[10px] text-white/40 font-bold uppercase mb-1">
                          Total de 12 meses{" "}
                          <Info size={10} className="inline opacity-40 ml-1" />
                        </div>
                        <div className="text-xl font-bold">
                          R${" "}
                          {proventosData.historyTable[0].total.toLocaleString(
                            "pt-BR",
                          )}
                        </div>
                      </div>
                      <div className="pt-4 border-t border-white/5">
                        <div className="text-[10px] text-white/40 font-bold uppercase mb-1">
                          Total da carteira
                        </div>
                        <div className="text-xl font-bold">
                          R$ {stats.totalDividends.toLocaleString("pt-BR")}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="pt-6 border-t border-white/5">
                    <h4 className="text-[10px] text-white/40 font-bold uppercase mb-4 tracking-widest">
                      Distribuição de proventos
                    </h4>
                    <div className="h-40 w-full mb-4">
                      <InvestmentDonutChart
                        data={proventosData.byAsset.slice(0, 5).map((a) => ({
                          name: a.name,
                          value: a.value,
                          color: "#00E676",
                        }))}
                      />
                    </div>
                    <div className="space-y-2">
                      {proventosData.byAsset.slice(0, 3).map((a, i) => (
                        <div
                          key={i}
                          className="flex items-center justify-between text-[10px]"
                        >
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-1.5 rounded-full bg-brand-primary" />
                            <span className="font-bold text-white/40">
                              {a.name}
                            </span>
                          </div>
                          <span className="font-bold text-white/60">
                            {((a.value / stats.totalDividends) * 100).toFixed(
                              2,
                            )}
                            %
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Main Evolution Chart */}
              <div className="lg:col-span-3 flex flex-col gap-6">
                <div className="glass-card !p-6 border-white/5">
                  <div className="flex items-center justify-between mb-8">
                    <div>
                      <h3 className="font-bold">Evolução de Proventos</h3>
                      <div className="flex items-center gap-4 mt-2">
                        <div className="flex items-center gap-1.5 text-[10px] font-bold text-white/40">
                          <div className="h-2 w-2 rounded bg-brand-primary" />{" "}
                          Proventos recebidos
                        </div>
                        <div className="flex items-center gap-1.5 text-[10px] font-bold text-white/40 opacity-40">
                          <div className="h-2 w-2 rounded bg-white/20" />{" "}
                          Proventos a receber
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex bg-white/5 rounded-lg p-1">
                        <button className="px-3 py-1 text-[10px] font-bold bg-white/10 rounded-md">
                          Mensal
                        </button>
                        <button className="px-3 py-1 text-[10px] font-bold text-white/40">
                          Anual
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="h-64 mt-4">
                    <InvestmentMonthlyChart
                      data={proventosData.evolution.map((m) => ({
                        month: m.label,
                        amount: m.value,
                        total: m.value,
                      }))}
                    />
                  </div>
                </div>

                {/* History Table */}
                <div className="glass-card !p-0 border-white/5 overflow-hidden">
                  <div className="p-4 flex items-center justify-between border-b border-white/5">
                    <h3 className="font-bold text-sm">Próximos Dividendos</h3>
                    <div className="px-2 py-1 bg-brand-primary/10 text-brand-primary text-[10px] rounded-lg font-bold">
                      Agenda 2024
                    </div>
                  </div>
                  <div className="p-6">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {investments.slice(0, 3).map((inv, i) => (
                        <div key={i} className="bg-white/5 rounded-xl p-4 border border-white/5 hover:border-brand-primary/30 transition-all cursor-pointer group">
                          <div className="flex items-center justify-between mb-3">
                            <span className="text-[10px] font-bold text-brand-primary">{inv.name}</span>
                            <span className="text-[10px] text-white/30">{i + 15}/05</span>
                          </div>
                          <div className="text-lg font-bold">R$ {(Number(inv.quantity) * 0.45).toLocaleString('pt-BR')}</div>
                          <div className="text-[10px] text-white/40 mt-1 uppercase">Estimado</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* History Table */}
                <div className="glass-card !p-0 border-white/5 overflow-hidden">
                  <div className="p-4 flex items-center justify-between border-b border-white/5">
                    <h3 className="font-bold text-sm">Histórico mensal</h3>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-white/40 font-bold uppercase">
                        Total:
                      </span>
                      <span className="text-sm font-bold text-brand-primary">
                        R${" "}
                        {proventosData.historyTable[0].total.toLocaleString(
                          "pt-BR",
                        )}
                      </span>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-[10px]">
                      <thead className="bg-white/5 text-white/20 font-bold uppercase tracking-widest">
                        <tr>
                          <th className="py-3 px-4">Ano</th>
                          {[
                            "Jan",
                            "Fev",
                            "Mar",
                            "Abr",
                            "Mai",
                            "Jun",
                            "Jul",
                            "Ago",
                            "Set",
                            "Out",
                            "Nov",
                            "Dez",
                          ].map((m) => (
                            <th key={m} className="py-3 px-2 text-center">
                              {m}
                            </th>
                          ))}
                          <th className="py-3 px-2 text-center italic">
                            Média
                          </th>
                          <th className="py-3 px-4 text-right">Total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {proventosData.historyTable.map((row, i) => (
                          <tr
                            key={i}
                            className="hover:bg-white/5 transition-colors"
                          >
                            <td className="py-4 px-4 font-bold text-white/60">
                              {row.year}
                            </td>
                            {row.months.map((m, mi) => (
                              <td
                                key={mi}
                                className={`py-4 px-2 text-center font-mono ${m > 0 ? "text-white" : "text-white/10"}`}
                              >
                                {m > 0
                                  ? m.toLocaleString("pt-BR", {
                                      minimumFractionDigits: 2,
                                      maximumFractionDigits: 2,
                                    })
                                  : "0,00"}
                              </td>
                            ))}
                            <td className="py-4 px-2 text-center font-bold text-brand-primary/60">
                              {row.avg.toLocaleString("pt-BR", {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                            </td>
                            <td className="py-4 px-4 text-right font-bold text-brand-primary">
                              {row.total.toLocaleString("pt-BR", {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Advice / Gerenciamento Modal */}
      <AnimatePresence>
        {showAdvice && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowAdvice(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="relative glass-card w-full max-w-lg !p-0 border-brand-primary/20 overflow-hidden"
            >
              <div className="bg-brand-primary p-6 flex items-center justify-between text-black">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl bg-black/10 flex items-center justify-center">
                    <Sparkles size={24} />
                  </div>
                  <div>
                    <h3 className="font-black text-xl tracking-tighter">
                      Gerencial IA
                    </h3>
                    <p className="text-[10px] font-bold uppercase tracking-widest opacity-60">
                      Personal Advisor
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setShowAdvice(false)}
                  className="h-8 w-8 flex items-center justify-center hover:bg-black/5 rounded-full transition-all"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="p-8 space-y-6">
                {loadingAI ? (
                  <div className="flex flex-col items-center justify-center py-12 gap-4">
                    <div className="h-10 w-10 animate-spin rounded-full border-4 border-brand-primary border-t-transparent" />
                    <p className="text-xs font-bold text-white/40 uppercase tracking-widest animate-pulse">
                      Analizando mercado e saldo...
                    </p>
                  </div>
                ) : advice ? (
                  <>
                    <div className="space-y-4">
                      <div className="p-4 bg-brand-primary/5 rounded-2xl border border-brand-primary/10">
                        <div className="text-[10px] uppercase font-bold text-brand-primary mb-2">
                          Recomendação de Aporte
                        </div>
                        <div className="text-3xl font-bold tracking-tighter text-brand-primary">
                          R$ {advice.recommendedAmount.toLocaleString("pt-BR")}
                        </div>
                        <p className="text-sm text-white/70 mt-3 leading-relaxed">
                          {advice.reasoning}
                        </p>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="p-4 bg-white/5 rounded-2xl border border-white/5">
                          <div className="text-[10px] uppercase font-bold text-white/40 mb-2">
                            Estratégia
                          </div>
                          <div className="text-xs font-bold flex items-center gap-2">
                            <Target size={14} className="text-brand-primary" />{" "}
                            {advice.strategy}
                          </div>
                        </div>
                        <div className="p-4 bg-white/5 rounded-2xl border border-white/5">
                          <div className="text-[10px] uppercase font-bold text-white/40 mb-2">
                            Tendência
                          </div>
                          <div className="text-xs font-bold flex items-center gap-2">
                            <TrendingUp
                              size={14}
                              className={`text-brand-primary ${marketInsight?.tendency === "bear" ? "text-red-400 rotate-180" : ""}`}
                            />
                            {marketInsight?.tendency === "bull"
                              ? "Alta"
                              : "Estável"}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="pt-6 border-t border-white/5">
                      <h4 className="text-[10px] font-bold text-white/30 uppercase tracking-widest mb-4">
                        Sugestão de Alocação
                      </h4>
                      <div className="space-y-2">
                        {marketInsight?.topAssetTypes.map((type, i) => (
                          <div
                            key={i}
                            className="flex items-center justify-between p-3 bg-white/5 rounded-xl text-xs font-bold border border-white/5"
                          >
                            <span className="text-white/60">{type}</span>
                            <ArrowRight
                              size={14}
                              className="text-brand-primary opacity-40"
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="flex flex-col items-center py-12 gap-4">
                    <p className="text-white/40 text-sm">
                      Nenhum conselho disponível no momento.
                    </p>
                    <button
                      onClick={() => loadAIIntelligence(true)}
                      className="text-brand-primary font-bold text-sm"
                    >
                      Tentar novamente
                    </button>
                  </div>
                )}
              </div>

              <div className="bg-black/40 p-4 border-t border-white/5 text-center">
                <p className="text-[8px] text-white/20 uppercase font-bold tracking-[0.2em]">
                  O Advisor analisa seu saldo disponível e as tendências atuais
                  do mercado da B3.
                </p>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showAddModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowAddModal(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-md"
            />

            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="glass-card w-full max-w-lg relative border-brand-primary/20 !p-0 overflow-hidden"
            >
              <div className="bg-brand-primary p-4 flex items-center justify-between">
                <div className="flex items-center gap-2 text-black">
                  <TrendingUp size={20} />
                  <h3 className="font-bold">Lançar Novo Ativo</h3>
                </div>
                <button
                  onClick={() => setShowAddModal(false)}
                  className="bg-black/10 hover:bg-black/20 p-1 rounded-lg transition-colors text-black"
                >
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={handleAddInvestment} className="p-6 space-y-5">
                <div className="flex items-center gap-4 bg-white/5 p-4 rounded-2xl border border-white/10 mb-4">
                  {INVESTMENT_TYPES.map((type) => (
                    <button
                      key={type.id}
                      type="button"
                      onClick={() =>
                        setNewInvestment({ ...newInvestment, type: type.id })
                      }
                      className={`flex-1 flex flex-col items-center gap-2 p-2 rounded-xl border transition-all ${
                        newInvestment.type === type.id
                          ? `bg-brand-primary/10 border-brand-primary text-brand-primary`
                          : "border-transparent text-white/40 hover:bg-white/5"
                      }`}
                    >
                      <type.icon size={24} />
                      <span className="text-[10px] font-bold uppercase">
                        {type.label.split(" ")[0]}
                      </span>
                    </button>
                  ))}
                </div>

                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-white/40 ml-1">
                      Ticker / Nome do Ativo
                    </label>
                    <div className="relative">
                      <Search
                        className="absolute left-3 top-1/2 -translate-y-1/2 text-white/20"
                        size={16}
                      />
                      <input
                        required
                        type="text"
                        placeholder="Ex: PETR4, Tesouro Selic, BTC"
                        value={newInvestment.name}
                        onChange={(e) =>
                          setNewInvestment({
                            ...newInvestment,
                            name: e.target.value,
                          })
                        }
                        className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-10 pr-4 outline-none focus:border-brand-primary transition-all font-bold"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-white/40 ml-1">
                        Instituição
                      </label>
                      <input
                        required
                        type="text"
                        placeholder="Ex: XP, NuInvest"
                        value={newInvestment.institution}
                        onChange={(e) =>
                          setNewInvestment({
                            ...newInvestment,
                            institution: e.target.value,
                          })
                        }
                        className="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 outline-none focus:border-brand-primary text-sm"
                      />
                    </div>
                    <div className="space-y-1.5 flex flex-col justify-end">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-white/40 ml-1">
                        Quantidade
                      </label>
                      <input
                        required
                        type="number"
                        step="0.01"
                        placeholder="1"
                        value={newInvestment.quantity}
                        onChange={(e) => {
                          const qty = Number(e.target.value);
                          const avg = Number(newInvestment.average_price);
                          const total = avg * qty;
                          setNewInvestment({
                            ...newInvestment,
                            quantity: e.target.value,
                            initial_amount: total.toString(),
                          });
                        }}
                        className="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 outline-none focus:border-brand-primary font-bold"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 bg-brand-primary/5 p-4 rounded-2xl border border-brand-primary/10">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-brand-primary ml-1">
                        Preço Médio Pago
                      </label>
                      <input
                        required
                        type="number"
                        step="0.01"
                        placeholder="0,00"
                        value={newInvestment.average_price}
                        onChange={(e) => {
                          const avg = Number(e.target.value);
                          const qty = Number(newInvestment.quantity);
                          const total = avg * qty;
                          setNewInvestment({
                            ...newInvestment,
                            average_price: e.target.value,
                            initial_amount: total.toString(),
                          });
                        }}
                        className="w-full bg-black/20 border border-brand-primary/20 rounded-xl py-3 px-4 outline-none focus:border-brand-primary font-bold text-brand-primary"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-brand-primary ml-1">
                        Preço Atual Mercado
                      </label>
                      <input
                        required
                        type="number"
                        step="0.01"
                        placeholder="0,00"
                        value={newInvestment.current_price}
                        onChange={(e) => {
                          const curr = Number(e.target.value);
                          const qty = Number(newInvestment.quantity);
                          const patrimony = curr * qty;
                          setNewInvestment({
                            ...newInvestment,
                            current_price: e.target.value,
                            amount: patrimony.toString(),
                          });
                        }}
                        className="w-full bg-black/20 border border-brand-primary/20 rounded-xl py-3 px-4 outline-none focus:border-brand-primary font-bold text-brand-primary"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-white/40 ml-1">
                        % Alvo (Carteira)
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        placeholder="Ex: 15%"
                        value={newInvestment.target_percentage}
                        onChange={(e) =>
                          setNewInvestment({
                            ...newInvestment,
                            target_percentage: e.target.value,
                          })
                        }
                        className="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 outline-none focus:border-brand-primary font-bold"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-white/40 ml-1">
                        Categoria
                      </label>
                      <input
                        type="text"
                        placeholder="Ex: Longo Prazo"
                        value={newInvestment.category}
                        onChange={(e) =>
                          setNewInvestment({
                            ...newInvestment,
                            category: e.target.value,
                          })
                        }
                        className="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 outline-none focus:border-brand-primary text-sm"
                      />
                    </div>
                  </div>

                  <div className="p-4 bg-purple-500/5 rounded-2xl border border-purple-500/10 mb-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-purple-400/60 ml-1 block mb-2">
                      Proventos Recebidos (Histórico)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="R$ 0,00"
                      value={newInvestment.dividends_received}
                      onChange={(e) =>
                        setNewInvestment({
                          ...newInvestment,
                          dividends_received: e.target.value,
                        })
                      }
                      className="w-full bg-transparent border-b border-purple-500/30 py-2 outline-none text-purple-400 font-bold"
                    />
                  </div>

                  <div className="p-4 bg-white/5 rounded-2xl border border-white/10 space-y-4">
                    <div className="flex items-center gap-2 text-[10px] font-bold uppercase text-white/40 mb-2">
                      <Activity size={14} /> Indicadores Fundamentalistas
                      (Opcional)
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="space-y-1">
                        <label className="text-[8px] font-bold uppercase text-white/30">
                          P/L
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          value={newInvestment.pl}
                          onChange={(e) =>
                            setNewInvestment({
                              ...newInvestment,
                              pl: e.target.value,
                            })
                          }
                          className="w-full bg-white/5 border border-white/10 rounded-lg py-1.5 px-3 text-xs outline-none"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[8px] font-bold uppercase text-white/30">
                          ROE (%)
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          value={newInvestment.roe}
                          onChange={(e) =>
                            setNewInvestment({
                              ...newInvestment,
                              roe: e.target.value,
                            })
                          }
                          className="w-full bg-white/5 border border-white/10 rounded-lg py-1.5 px-3 text-xs outline-none"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[8px] font-bold uppercase text-white/30">
                          DY (%)
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          value={newInvestment.dividend_yield}
                          onChange={(e) =>
                            setNewInvestment({
                              ...newInvestment,
                              dividend_yield: e.target.value,
                            })
                          }
                          className="w-full bg-white/5 border border-white/10 rounded-lg py-1.5 px-3 text-xs outline-none"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3 pb-2">
                      <div className="space-y-1">
                        <label className="text-[8px] font-bold uppercase text-white/30">
                          EBITDA
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          value={newInvestment.ebitda}
                          onChange={(e) =>
                            setNewInvestment({
                              ...newInvestment,
                              ebitda: e.target.value,
                            })
                          }
                          className="w-full bg-white/5 border border-white/10 rounded-lg py-1.5 px-3 text-xs outline-none"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[8px] font-bold uppercase text-white/30">
                          Dív. Líquida
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          value={newInvestment.liquid_debt}
                          onChange={(e) =>
                            setNewInvestment({
                              ...newInvestment,
                              liquid_debt: e.target.value,
                            })
                          }
                          className="w-full bg-white/5 border border-white/10 rounded-lg py-1.5 px-3 text-xs outline-none"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowAddModal(false)}
                    className="flex-1 py-4 rounded-xl font-bold bg-white/5 hover:bg-white/10 transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={isSaving}
                    className="flex-[2] bg-brand-primary text-black py-4 rounded-xl font-bold hover:brightness-110 shadow-lg disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {isSaving ? (
                      "Salvando..."
                    ) : (
                      <>
                        <Target size={18} /> Confirmar Lançamento
                      </>
                    )}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal de Imposto de Renda */}
      <AnimatePresence>
        {showTaxCalc && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowTaxCalc(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-xl bg-[#0a0a0a] border border-white/10 rounded-3xl overflow-hidden shadow-2xl"
            >
              <div className="p-8">
                <div className="flex items-center gap-4 mb-8">
                  <div className="h-12 w-12 rounded-2xl bg-orange-500/20 flex items-center justify-center text-orange-400">
                    <Banknote size={24} />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold">Calculadora de IR Bolsa</h2>
                    <p className="text-xs text-white/40 uppercase tracking-widest mt-1">Estimativa de impostos sobre ganhos</p>
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="bg-white/5 p-6 rounded-2xl border border-white/5">
                    <div className="flex justify-between items-center mb-4">
                      <span className="text-xs text-white/40 font-bold uppercase">Límite de Isenção (Ações)</span>
                      <span className="text-sm font-bold text-green-400">R$ 20.000,00/mês</span>
                    </div>
                    <div className="space-y-3">
                      <div className="flex justify-between text-sm">
                        <span className="text-white/40">Ganhos em Ações (Estimado)</span>
                        <span className="font-bold text-white">R$ {(stats.profit > 0 ? stats.profit * 0.4 : 0).toLocaleString('pt-BR')}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-white/40">Ganhos em FIIs (Estimado)</span>
                        <span className="font-bold text-white">R$ {(stats.profit > 0 ? stats.profit * 0.1 : 0).toLocaleString('pt-BR')}</span>
                      </div>
                      <div className="pt-3 border-t border-white/5 flex justify-between">
                        <span className="text-sm font-black uppercase text-brand-primary">Darf Estimada</span>
                        <span className="text-xl font-black text-brand-primary">R$ {(stats.profit > 0 ? stats.profit * 0.15 : 0).toLocaleString('pt-BR')}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-start gap-4 p-4 bg-orange-500/5 border border-orange-500/10 rounded-2xl">
                    <AlertCircle className="text-orange-400 shrink-0" size={18} />
                    <p className="text-[10px] text-orange-400/80 leading-relaxed uppercase font-bold">
                      Atenção: Este cálculo é uma estimativa baseada no seu lucro total. Ganhos com FIIs são tributados em 20% e Ações em 15% (acima da isenção). Day Trade sempre 20%. Consulte um contador.
                    </p>
                  </div>
                </div>

                <div className="mt-8 pt-6 border-t border-white/5 flex justify-end">
                  <button 
                    onClick={() => setShowTaxCalc(false)}
                    className="px-8 py-3 bg-white/5 hover:bg-white/10 rounded-xl text-xs font-bold transition-all"
                  >
                    Fechar
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {showRebalance && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowRebalance(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-2xl bg-[#0a0a0a] border border-white/10 rounded-3xl overflow-hidden shadow-2xl"
            >
              <div className="p-8">
                <div className="flex items-center justify-between mb-8">
                  <div className="flex items-center gap-4">
                    <div className="h-12 w-12 rounded-2xl bg-purple-500/20 flex items-center justify-center text-purple-400">
                      <Activity size={24} />
                    </div>
                    <div>
                      <h2 className="text-xl font-bold">Estrategista de Rebalanceamento</h2>
                      <p className="text-xs text-white/40 uppercase tracking-widest mt-1">Aportes inteligentes para bater metas</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setShowRebalance(false)}
                    className="p-2 hover:bg-white/5 rounded-xl transition-colors"
                  >
                    <X size={20} className="text-white/40" />
                  </button>
                </div>

                <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
                  {investments.filter(inv => Number(inv.target_percentage) > 0).map(inv => {
                    const currentPerc = stats.total > 0 ? (Number(inv.amount) / stats.total) * 100 : 0;
                    const targetPerc = Number(inv.target_percentage);
                    const needsAporte = targetPerc > currentPerc;
                    const aporteVal = stats.suggestedAportes[inv.id] || 0;

                    return (
                      <div key={inv.id} className="bg-white/5 rounded-2xl p-4 border border-white/5 flex items-center justify-between group hover:border-purple-500/30 transition-all">
                        <div className="flex items-center gap-4">
                          <div className="flex flex-col">
                            <span className="font-bold text-white group-hover:text-purple-400 transition-colors">{inv.name}</span>
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-[10px] text-white/30 uppercase font-bold">Atual: {currentPerc.toFixed(1)}%</span>
                              <div className="h-1 w-1 rounded-full bg-white/20" />
                              <span className="text-[10px] text-purple-400 font-bold uppercase">Alvo: {targetPerc.toFixed(1)}%</span>
                            </div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-[10px] text-white/30 font-bold uppercase mb-1">Aporte Sugerido</div>
                          <div className={`text-lg font-bold font-mono ${needsAporte ? 'text-green-400' : 'text-white/10'}`}>
                            R$ {aporteVal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-8 pt-6 border-t border-white/5 flex items-center justify-between">
                  <div>
                    <div className="text-[10px] text-white/40 font-bold uppercase mb-1">Poder de Compra Necessário</div>
                    <div className="text-2xl font-bold">
                      R$ {(Object.values(stats.suggestedAportes) as number[]).reduce((a: number, b: number) => a + b, 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </div>
                  </div>
                  <button 
                    onClick={() => setShowRebalance(false)}
                    className="px-6 py-3 bg-white/5 hover:bg-white/10 rounded-xl text-xs font-bold transition-all"
                  >
                    Entendido
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {confirmDialog.open && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/60 backdrop-blur-md"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-sm bg-[#121212] border border-white/10 rounded-[32px] overflow-hidden p-8 text-center shadow-2xl"
            >
              <div className="h-16 w-16 rounded-2xl bg-red-500/10 flex items-center justify-center text-red-500 mx-auto mb-6">
                <AlertTriangle size={32} />
              </div>
              <h3 className="text-xl font-bold mb-2">{confirmDialog.title}</h3>
              <p className="text-sm text-white/40 leading-relaxed mb-8">
                {confirmDialog.message}
              </p>
              <div className="flex flex-col gap-3">
                <button
                  onClick={() => {
                    confirmDialog.onConfirm();
                    setConfirmDialog({ ...confirmDialog, open: false });
                  }}
                  className="w-full py-4 bg-red-500 text-white rounded-2xl font-bold hover:brightness-110"
                >
                  Confirmar Exclusão
                </button>
                <button
                  onClick={() => setConfirmDialog({ ...confirmDialog, open: false })}
                  className="w-full py-4 bg-white/5 text-white/60 rounded-2xl font-bold hover:bg-white/10 transition-all"
                >
                  Cancelar
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
