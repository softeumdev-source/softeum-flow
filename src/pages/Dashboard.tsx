import { useEffect, useState, useMemo, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  Search, Eye, X, Inbox, Clock, CheckCircle2, XCircle,
  AlertTriangle, Copy, Ban, DollarSign, Loader2, Calendar, RefreshCw, Boxes,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge, ConfiancaBadge } from "@/components/StatusBadge";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Pedido {
  id: string;
  numero: string;
  empresa: string | null;
  data_emissao: string | null;
  created_at: string | null;
  status:
    | "pendente"
    | "aprovado"
    | "reprovado"
    | "erro"
    | "duplicado"
    | "ignorado"
    | "aguardando_de_para"
    | "aprovado_parcial";
  confianca_ia: number | null;
  valor_total: number | null;
  itens_count: number;
}

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dataHora = (iso: string | null) => {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
};

const getPeriodo = (periodo: string): { inicio: Date; fim: Date; label: string } => {
  const hoje = new Date();
  const ano = hoje.getFullYear();
  const mes = hoje.getMonth();
  switch (periodo) {
    case "mes_atual":
      return { inicio: new Date(ano, mes, 1), fim: new Date(ano, mes + 1, 0, 23, 59, 59), label: `${hoje.toLocaleString("pt-BR", { month: "long" })}/${ano}` };
    case "mes_anterior": {
      const m = mes === 0 ? 11 : mes - 1;
      const a = mes === 0 ? ano - 1 : ano;
      return { inicio: new Date(a, m, 1), fim: new Date(a, m + 1, 0, 23, 59, 59), label: `${new Date(a, m).toLocaleString("pt-BR", { month: "long" })}/${a}` };
    }
    case "trimestre": {
      const inicioTrimestre = new Date(ano, Math.floor(mes / 3) * 3, 1);
      return { inicio: inicioTrimestre, fim: new Date(ano, mes + 1, 0, 23, 59, 59), label: `Trimestre atual` };
    }
    case "ano":
      return { inicio: new Date(ano, 0, 1), fim: new Date(ano, 11, 31, 23, 59, 59), label: `Ano ${ano}` };
    default:
      return { inicio: new Date(ano, mes, 1), fim: new Date(ano, mes + 1, 0, 23, 59, 59), label: "" };
  }
};

export default function Dashboard() {
  const { user, loading: authLoading } = useAuth();
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [loading, setLoading] = useState(true);
  const [ultimaAtualizacao, setUltimaAtualizacao] = useState<Date>(new Date());

  const [periodo, setPeriodo] = useState("mes_atual");
  const [dataInicioCustom, setDataInicioCustom] = useState("");
  const [dataFimCustom, setDataFimCustom] = useState("");
  const [busca, setBusca] = useState("");
  const [statusFiltro, setStatusFiltro] = useState<string>("todos");
  const [dataInicioTabela, setDataInicioTabela] = useState("");
  const [dataFimTabela, setDataFimTabela] = useState("");

  const loadPedidos = useCallback(async (silent = false) => {
    if (!user) return;
    if (!silent) setLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from("pedidos")
        .select("id, numero, empresa, data_emissao, created_at, status, confianca_ia, valor_total")
        .order("created_at", { ascending: false });

      if (error) throw error;

      const pedidosComItens: Pedido[] = await Promise.all(
        (data || []).map(async (p: any) => {
          const { count } = await supabase
            .from("pedido_itens")
            .select("*", { count: "exact", head: true })
            .eq("pedido_id", p.id);
          return {
            id: p.id, numero: p.numero, empresa: p.empresa,
            data_emissao: p.data_emissao, created_at: p.created_at,
            status: (p.status ?? "pendente") as Pedido["status"],
            confianca_ia: p.confianca_ia, valor_total: p.valor_total,
            itens_count: count || 0,
          };
        })
      );

      setPedidos(pedidosComItens);
      setUltimaAtualizacao(new Date());
    } catch (err: any) {
      if (!silent) toast.error("Erro ao carregar pedidos", { description: err.message });
    } finally {
      if (!silent) setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!user || authLoading) return;

    // Carga inicial
    loadPedidos();

    // Realtime com nome único para evitar conflito entre abas
    const channelName = `pedidos-rt-${user.id}-${Date.now()}`;
    const channel = supabase
      .channel(channelName)
      .on("postgres_changes", { event: "*", schema: "public", table: "pedidos" }, () => loadPedidos(true))
      .on("postgres_changes", { event: "*", schema: "public", table: "pedido_itens" }, () => loadPedidos(true))
      .subscribe();

    // Polling a cada 30 segundos como fallback
    const interval = setInterval(() => loadPedidos(true), 30000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [user, authLoading, loadPedidos]);

  const pedidosPeriodo = useMemo(() => {
    let inicio: Date, fim: Date;
    if (periodo === "personalizado") {
      if (!dataInicioCustom || !dataFimCustom) return pedidos;
      inicio = new Date(dataInicioCustom + "T00:00:00");
      fim = new Date(dataFimCustom + "T23:59:59");
    } else {
      const p = getPeriodo(periodo);
      inicio = p.inicio; fim = p.fim;
    }
    return pedidos.filter((p) => {
      const d = p.created_at ? new Date(p.created_at) : null;
      if (!d) return false;
      return d >= inicio && d <= fim;
    });
  }, [pedidos, periodo, dataInicioCustom, dataFimCustom]);

  const metricas = useMemo(() => {
    return pedidosPeriodo.reduce((acc, p) => {
      acc.total++;
      if (p.status === "pendente") acc.pendentes++;
      if (p.status === "aprovado") acc.aprovados++;
      if (p.status === "reprovado") acc.reprovados++;
      if (p.status === "erro") acc.erros++;
      if (p.status === "duplicado") acc.duplicados++;
      if (p.status === "ignorado") acc.ignorados++;
      if (p.status === "aguardando_de_para" || p.status === "aprovado_parcial") acc.codigos_novos++;
      acc.valor_total += Number(p.valor_total ?? 0);
      return acc;
    }, { total: 0, pendentes: 0, aprovados: 0, reprovados: 0, erros: 0, duplicados: 0, ignorados: 0, codigos_novos: 0, valor_total: 0 });
  }, [pedidosPeriodo]);

  const pedidosFiltrados = useMemo(() => {
    return pedidos.filter((p) => {
      if (statusFiltro === "codigos_novos") {
        if (p.status !== "aguardando_de_para" && p.status !== "aprovado_parcial") return false;
      } else if (statusFiltro !== "todos" && p.status !== statusFiltro) return false;
      if (busca) {
        const t = busca.toLowerCase();
        if (!p.empresa?.toLowerCase().includes(t) && !p.numero?.toLowerCase().includes(t)) return false;
      }
      if (dataInicioTabela && p.created_at) {
        if (new Date(p.created_at) < new Date(dataInicioTabela + "T00:00:00")) return false;
      }
      if (dataFimTabela && p.created_at) {
        if (new Date(p.created_at) > new Date(dataFimTabela + "T23:59:59")) return false;
      }
      return true;
    });
  }, [pedidos, statusFiltro, busca, dataInicioTabela, dataFimTabela]);

  const limparFiltrosTabela = () => {
    setBusca(""); setStatusFiltro("todos");
    setDataInicioTabela(""); setDataFimTabela("");
  };

  const periodoLabel = periodo === "personalizado"
    ? (dataInicioCustom && dataFimCustom
      ? `${new Date(dataInicioCustom + "T12:00:00").toLocaleDateString("pt-BR")} → ${new Date(dataFimCustom + "T12:00:00").toLocaleDateString("pt-BR")}`
      : "Personalizado")
    : getPeriodo(periodo).label;

  const mapStatusToBadge = (status: string):
    | "pendente" | "aprovado" | "erro_ia" | "duplicado" | "ignorado" | "reprovado"
    | "aguardando_de_para" | "aprovado_parcial" => {
    switch (status) {
      case "pendente": return "pendente";
      case "aprovado": return "aprovado";
      case "reprovado": return "reprovado";
      case "erro": return "erro_ia";
      case "duplicado": return "duplicado";
      case "ignorado": return "ignorado";
      case "aguardando_de_para": return "aguardando_de_para";
      case "aprovado_parcial": return "aprovado_parcial";
      default: return "pendente";
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1400px] px-8 py-8">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Visão geral dos pedidos recebidos
            <span className="ml-2 text-xs text-muted-foreground/60">
              · Atualizado às {ultimaAtualizacao.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => loadPedidos()}
            disabled={loading}
            className="gap-1.5"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
          <Calendar className="h-4 w-4 text-muted-foreground" />
          <Select value={periodo} onValueChange={setPeriodo}>
            <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="mes_atual">Mês atual</SelectItem>
              <SelectItem value="mes_anterior">Mês anterior</SelectItem>
              <SelectItem value="trimestre">Trimestre atual</SelectItem>
              <SelectItem value="ano">Ano atual</SelectItem>
              <SelectItem value="personalizado">Personalizado</SelectItem>
            </SelectContent>
          </Select>
          {periodo === "personalizado" && (
            <>
              <Input type="date" value={dataInicioCustom} onChange={(e) => setDataInicioCustom(e.target.value)} className="w-[150px]" />
              <Input type="date" value={dataFimCustom} onChange={(e) => setDataFimCustom(e.target.value)} className="w-[150px]" />
            </>
          )}
        </div>
      </div>

      <div className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-3 py-1 text-xs font-medium text-muted-foreground">
        <Calendar className="h-3 w-3" />
        {periodoLabel}
      </div>

      {metricas.codigos_novos > 0 && (
        <button
          type="button"
          onClick={() => setStatusFiltro("codigos_novos")}
          className="mb-6 flex w-full items-center justify-between rounded-xl border border-amber-300 bg-amber-50 px-5 py-3 text-left transition-colors hover:bg-amber-100"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-200 text-amber-800">
              <Boxes className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-semibold text-amber-900">
                {metricas.codigos_novos} pedido{metricas.codigos_novos === 1 ? "" : "s"} com códigos novos pendentes
              </div>
              <div className="text-xs text-amber-800/80">
                A IA sugeriu correspondências do catálogo. Abra cada pedido e clique em "Resolver códigos novos".
              </div>
            </div>
          </div>
          <span className="text-xs font-medium text-amber-800 underline">Ver lista</span>
        </button>
      )}

      {/* Métricas - Linha 1 */}
      <div className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-4">
        <MetricCard titulo="Total de pedidos" valor={metricas.total} icone={Inbox} tom="primary" />
        <MetricCard titulo="Pendentes" valor={metricas.pendentes} icone={Clock} tom="warning" />
        <MetricCard titulo="Aprovados" valor={metricas.aprovados} icone={CheckCircle2} tom="success" />
        <MetricCard titulo="Reprovados" valor={metricas.reprovados} icone={XCircle} tom="destructive" />
      </div>

      {/* Métricas - Linha 2 */}
      <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-4">
        <MetricCard titulo="Erro IA" valor={metricas.erros} icone={AlertTriangle} tom="orange" />
        <MetricCard titulo="Duplicados" valor={metricas.duplicados} icone={Copy} tom="purple" />
        <MetricCard titulo="Ignorados" valor={metricas.ignorados} icone={Ban} tom="info" />
        <MetricCard titulo="Volume processado" valor={brl(metricas.valor_total)} icone={DollarSign} tom="primary" destaque />
      </div>

      {/* Tabela */}
      <div className="rounded-xl border border-border bg-card shadow-softeum-sm">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">Pedidos recebidos</h2>
            <p className="text-xs text-muted-foreground">
              {loading ? "Carregando..." : `${pedidosFiltrados.length} ${pedidosFiltrados.length === 1 ? "resultado encontrado" : "resultados encontrados"}`}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 border-b border-border bg-muted/30 px-5 py-4 md:grid-cols-[1fr_180px_160px_160px_auto]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por empresa ou nº do pedido" className="pl-9 bg-card" disabled={loading} />
          </div>
          <Select value={statusFiltro} onValueChange={setStatusFiltro} disabled={loading}>
            <SelectTrigger className="bg-card"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              <SelectItem value="codigos_novos">Códigos novos pendentes</SelectItem>
              <SelectItem value="pendente">Pendente</SelectItem>
              <SelectItem value="aprovado">Aprovado</SelectItem>
              <SelectItem value="aprovado_parcial">Aprovado parcial</SelectItem>
              <SelectItem value="aguardando_de_para">Aguardando DE-PARA</SelectItem>
              <SelectItem value="reprovado">Reprovado</SelectItem>
              <SelectItem value="erro">Erro IA</SelectItem>
              <SelectItem value="duplicado">Duplicado</SelectItem>
              <SelectItem value="ignorado">Ignorado</SelectItem>
            </SelectContent>
          </Select>
          <Input type="date" value={dataInicioTabela} onChange={(e) => setDataInicioTabela(e.target.value)} className="bg-card" disabled={loading} />
          <Input type="date" value={dataFimTabela} onChange={(e) => setDataFimTabela(e.target.value)} className="bg-card" disabled={loading} />
          <Button variant="outline" onClick={limparFiltrosTabela} className="gap-2" disabled={loading}>
            <X className="h-4 w-4" /> Limpar
          </Button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/20 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-5 py-3 text-left font-medium">Nº Pedido</th>
                <th className="px-5 py-3 text-left font-medium">Empresa</th>
                <th className="px-5 py-3 text-left font-medium">Recebido em</th>
                <th className="px-5 py-3 text-left font-medium">Itens</th>
                <th className="px-5 py-3 text-right font-medium">Valor Total</th>
                <th className="px-5 py-3 text-left font-medium">Status</th>
                <th className="px-5 py-3 text-left font-medium">Confiança IA</th>
                <th className="px-5 py-3 text-right font-medium">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-5 py-16 text-center text-sm text-muted-foreground">
                    <div className="flex items-center justify-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" /> Carregando pedidos...
                    </div>
                  </td>
                </tr>
              ) : (
                <>
                  {pedidosFiltrados.map((p) => (
                    <tr key={p.id} className="transition-colors hover:bg-muted/30">
                      <td className="px-5 py-3.5 font-semibold text-foreground">{p.numero}</td>
                      <td className="px-5 py-3.5 text-foreground">{p.empresa || "-"}</td>
                      <td className="px-5 py-3.5 tabular-nums text-muted-foreground">{dataHora(p.created_at)}</td>
                      <td className="px-5 py-3.5 tabular-nums text-muted-foreground">{p.itens_count}</td>
                      <td className="px-5 py-3.5 text-right font-semibold tabular-nums text-foreground">
                        {p.valor_total ? brl(Number(p.valor_total)) : "-"}
                      </td>
                      <td className="px-5 py-3.5"><StatusBadge status={mapStatusToBadge(p.status)} /></td>
                      <td className="px-5 py-3.5"><ConfiancaBadge valor={p.confianca_ia ? Math.round(Number(p.confianca_ia) * 100) : 0} /></td>
                      <td className="px-5 py-3.5 text-right">
                        <Link to={`/pedido/${p.id}`} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground" aria-label="Abrir pedido">
                          <Eye className="h-4 w-4" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                  {pedidosFiltrados.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-5 py-16 text-center text-sm text-muted-foreground">
                        Nenhum pedido encontrado com esses filtros.
                      </td>
                    </tr>
                  )}
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

type Tom = "primary" | "success" | "warning" | "destructive" | "info" | "orange" | "purple";

interface MetricCardProps {
  titulo: string;
  valor: string | number;
  icone: typeof Inbox;
  tom: Tom;
  destaque?: boolean;
}

function MetricCard({ titulo, valor, icone: Icone, tom, destaque }: MetricCardProps) {
  const tomStyles: Record<Tom, string> = {
    primary: "bg-primary/10 text-primary",
    success: "bg-green-500/10 text-green-600",
    warning: "bg-amber-500/10 text-amber-600",
    destructive: "bg-red-500/10 text-red-600",
    info: "bg-blue-500/10 text-blue-600",
    orange: "bg-orange-500/10 text-orange-600",
    purple: "bg-purple-500/10 text-purple-600",
  };

  return (
    <div className={`rounded-xl border border-border bg-card p-5 shadow-sm transition-shadow hover:shadow-md ${destaque ? "border-primary/20 bg-primary/5" : ""}`}>
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{titulo}</p>
          <p className="mt-2 truncate text-2xl font-bold tabular-nums text-foreground">{valor}</p>
        </div>
        <div className={`ml-3 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg ${tomStyles[tom]}`}>
          <Icone className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}
