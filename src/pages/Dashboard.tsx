import { useEffect, useState, useMemo, useCallback } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  Search, Eye, X, Inbox, Clock, CheckCircle2, XCircle,
  AlertTriangle, Copy, Ban, DollarSign, Loader2, Calendar,
  RefreshCw, SlidersHorizontal,
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
  numero_pedido_cliente: string | null;
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

const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const dataHora = (iso: string | null) => {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
};

const dataHoraCompacta = (iso: string | null) => {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
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
      const ini = new Date(ano, Math.floor(mes / 3) * 3, 1);
      return { inicio: ini, fim: new Date(ano, mes + 1, 0, 23, 59, 59), label: "Trimestre atual" };
    }
    case "ano":
      return { inicio: new Date(ano, 0, 1), fim: new Date(ano, 11, 31, 23, 59, 59), label: `Ano ${ano}` };
    default:
      return { inicio: new Date(ano, mes, 1), fim: new Date(ano, mes + 1, 0, 23, 59, 59), label: "" };
  }
};

export default function Dashboard() {
  const { user, tenantId, loading: authLoading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [loading, setLoading] = useState(true);
  const [ultimaAtualizacao, setUltimaAtualizacao] = useState<Date>(new Date());
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);

  const [periodo, setPeriodo] = useState("mes_atual");
  const [dataInicioCustom, setDataInicioCustom] = useState("");
  const [dataFimCustom, setDataFimCustom] = useState("");
  const [busca, setBusca] = useState("");
  const [statusFiltro, setStatusFiltro] = useState("todos");
  const [dataInicioTabela, setDataInicioTabela] = useState("");
  const [dataFimTabela, setDataFimTabela] = useState("");

  // Aplica ?statusFiltro= vindo de notificações
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const fil = params.get("statusFiltro");
    if (fil) {
      setStatusFiltro(fil);
      navigate(location.pathname, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  const loadPedidos = useCallback(async (silent = false) => {
    if (!user || !tenantId) return;
    if (!silent) setLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from("pedidos")
        .select("id, numero, numero_pedido_cliente, empresa, data_emissao, created_at, status, confianca_ia, valor_total")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false });
      if (error) throw error;

      const pedidosComItens: Pedido[] = await Promise.all(
        (data || []).map(async (p: any) => {
          const { count } = await supabase
            .from("pedido_itens")
            .select("*", { count: "exact", head: true })
            .eq("tenant_id", tenantId)
            .eq("pedido_id", p.id);
          return {
            id: p.id, numero: p.numero,
            numero_pedido_cliente: p.numero_pedido_cliente,
            empresa: p.empresa, data_emissao: p.data_emissao,
            created_at: p.created_at,
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
  }, [user, tenantId]);

  useEffect(() => {
    if (!user || !tenantId || authLoading) return;
    loadPedidos();
    const channelName = `pedidos-rt-${user.id}-${tenantId}-${Date.now()}`;
    const channel = supabase
      .channel(channelName)
      .on("postgres_changes", { event: "*", schema: "public", table: "pedidos", filter: `tenant_id=eq.${tenantId}` }, () => loadPedidos(true))
      .on("postgres_changes", { event: "*", schema: "public", table: "pedido_itens", filter: `tenant_id=eq.${tenantId}` }, () => loadPedidos(true))
      .subscribe();
    const interval = setInterval(() => loadPedidos(true), 30000);
    return () => { supabase.removeChannel(channel); clearInterval(interval); };
  }, [user, tenantId, authLoading, loadPedidos]);

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
      return d && d >= inicio && d <= fim;
    });
  }, [pedidos, periodo, dataInicioCustom, dataFimCustom]);

  // Métricas respeitam busca por empresa
  const pedidosParaMetricas = useMemo(() => {
    if (!busca) return pedidosPeriodo;
    const t = busca.toLowerCase();
    return pedidosPeriodo.filter((p) => p.empresa?.toLowerCase().includes(t));
  }, [pedidosPeriodo, busca]);

  const metricas = useMemo(() => {
    return pedidosParaMetricas.reduce(
      (acc, p) => {
        acc.total++;
        if (p.status === "pendente") acc.pendentes++;
        if (p.status === "aprovado") acc.aprovados++;
        if (p.status === "reprovado") acc.reprovados++;
        if (p.status === "erro") acc.erros++;
        if (p.status === "duplicado") acc.duplicados++;
        if (p.status === "ignorado") acc.ignorados++;
        if (p.status === "aguardando_de_para" || p.status === "aprovado_parcial") acc.codigos_novos++;
        if (p.status === "aprovado") acc.valor_total += Number(p.valor_total ?? 0);
        return acc;
      },
      { total: 0, pendentes: 0, aprovados: 0, reprovados: 0, erros: 0, duplicados: 0, ignorados: 0, codigos_novos: 0, valor_total: 0 }
    );
  }, [pedidosParaMetricas]);

  const pedidosFiltrados = useMemo(() => {
    return pedidos.filter((p) => {
      if (statusFiltro === "codigos_novos") {
        if (p.status !== "aguardando_de_para" && p.status !== "aprovado_parcial") return false;
      } else if (statusFiltro !== "todos" && p.status !== statusFiltro) return false;
      if (busca) {
        const t = busca.toLowerCase();
        const num = (p.numero_pedido_cliente || p.numero || "").toLowerCase();
        if (!p.empresa?.toLowerCase().includes(t) && !num.includes(t)) return false;
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

  const limparFiltros = () => {
    setBusca(""); setStatusFiltro("todos");
    setDataInicioTabela(""); setDataFimTabela("");
  };

  const temFiltrosAtivos = busca || statusFiltro !== "todos" || dataInicioTabela || dataFimTabela;

  const periodoLabel = periodo === "personalizado"
    ? (dataInicioCustom && dataFimCustom
      ? `${new Date(dataInicioCustom + "T12:00:00").toLocaleDateString("pt-BR")} → ${new Date(dataFimCustom + "T12:00:00").toLocaleDateString("pt-BR")}`
      : "Personalizado")
    : getPeriodo(periodo).label;

  const mapStatus = (s: string): "pendente" | "aprovado" | "erro_ia" | "duplicado" | "ignorado" | "reprovado" | "aguardando_de_para" | "aprovado_parcial" => {
    if (s === "erro") return "erro_ia";
    return s as any;
  };

  const numeroPedido = (p: Pedido) => p.numero_pedido_cliente || p.numero;

  return (
    <div className="mx-auto w-full max-w-[1600px] px-[clamp(1rem,3vw,2rem)] py-[clamp(1.25rem,3vw,2rem)]">

      {/* ── Cabeçalho ── */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[clamp(1.25rem,2.5vw,1.75rem)] font-bold tracking-tight text-foreground">
            Dashboard
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Visão geral dos pedidos recebidos
            <span className="ml-2 hidden text-xs text-muted-foreground/50 lg:inline">
              · Atualizado às {ultimaAtualizacao.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
          </p>
        </div>

        {/* Controles de período */}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => loadPedidos()}
            disabled={loading}
            className="h-9 gap-1.5"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline">Atualizar</span>
          </Button>

          <Select value={periodo} onValueChange={setPeriodo}>
            <SelectTrigger className="h-9 w-[150px] sm:w-[175px]">
              <Calendar className="mr-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <SelectValue />
            </SelectTrigger>
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
              <Input
                type="date"
                value={dataInicioCustom}
                onChange={(e) => setDataInicioCustom(e.target.value)}
                className="h-9 w-[135px]"
              />
              <Input
                type="date"
                value={dataFimCustom}
                onChange={(e) => setDataFimCustom(e.target.value)}
                className="h-9 w-[135px]"
              />
            </>
          )}
        </div>
      </div>

      {/* Chip de período */}
      <div className="mb-5 inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-3 py-1 text-xs font-medium text-muted-foreground">
        <Calendar className="h-3 w-3" />
        {periodoLabel}
        {busca && <span className="ml-1 text-primary">· {busca}</span>}
      </div>

      {/* ── Cards de métricas (CSS Grid auto-fit — fluido) ── */}
      <div
        className="mb-6 grid gap-[clamp(0.75rem,2vw,1rem)]"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(210px, 100%), 1fr))" }}
      >
        <MetricCard titulo="Total de pedidos"  valor={metricas.total}     icone={Inbox}         tom="primary"     />
        <MetricCard titulo="Pendentes"          valor={metricas.pendentes} icone={Clock}         tom="warning"     />
        <MetricCard titulo="Aprovados"          valor={metricas.aprovados} icone={CheckCircle2}  tom="success"     />
        <MetricCard titulo="Reprovados"         valor={metricas.reprovados}icone={XCircle}       tom="destructive" />
        <MetricCard titulo="Erro IA"            valor={metricas.erros}     icone={AlertTriangle} tom="orange"      />
        <MetricCard titulo="Duplicados"         valor={metricas.duplicados}icone={Copy}          tom="purple"      />
        <MetricCard titulo="Ignorados"          valor={metricas.ignorados} icone={Ban}           tom="info"        />
        <MetricCard titulo="Volume aprovado"    valor={brl(metricas.valor_total)} icone={DollarSign} tom="primary" destaque />
      </div>

      {/* ── Painel de pedidos ── */}
      <div className="@container rounded-xl border border-border bg-card shadow-softeum-sm">

        {/* Cabeçalho do painel */}
        <div className="flex items-center justify-between gap-3 border-b border-border px-[clamp(1rem,2.5vw,1.25rem)] py-3.5">
          <div>
            <h2 className="text-sm font-semibold text-foreground sm:text-base">Pedidos recebidos</h2>
            <p className="text-xs text-muted-foreground">
              {loading ? "Carregando…" : `${pedidosFiltrados.length} resultado${pedidosFiltrados.length !== 1 ? "s" : ""}`}
              {temFiltrosAtivos && " (filtrado)"}
            </p>
          </div>
          {/* Botão de filtros — visível em telas estreitas */}
          <button
            onClick={() => setFiltrosAbertos((v) => !v)}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors @[640px]:hidden ${temFiltrosAtivos ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground hover:bg-muted/40"}`}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Filtros{temFiltrosAtivos ? " ●" : ""}
          </button>
        </div>

        {/* Barra de filtros */}
        <div className={`border-b border-border bg-muted/20 ${filtrosAbertos || true ? "" : "hidden"} @[640px]:block`}>
          {/* Layout fluido: linha única em telas largas, empilhado em telas pequenas */}
          <div className="flex flex-col gap-2 px-[clamp(0.75rem,2.5vw,1.25rem)] py-3 @[640px]:flex-row @[640px]:flex-wrap @[640px]:items-center">
            {/* Campo de busca */}
            <div className="relative min-w-0 flex-1 @[640px]:min-w-[200px] @[640px]:max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Empresa ou nº do pedido"
                className="h-9 pl-9 bg-card"
                disabled={loading}
              />
            </div>

            {/* Status */}
            <Select value={statusFiltro} onValueChange={setStatusFiltro} disabled={loading}>
              <SelectTrigger className="h-9 bg-card @[640px]:w-[180px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os status</SelectItem>
                <SelectItem value="codigos_novos">Códigos novos</SelectItem>
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

            {/* Datas */}
            <div className="flex gap-2">
              <Input
                type="date"
                value={dataInicioTabela}
                onChange={(e) => setDataInicioTabela(e.target.value)}
                className="h-9 min-w-0 flex-1 bg-card @[640px]:w-[140px] @[640px]:flex-none"
                disabled={loading}
              />
              <Input
                type="date"
                value={dataFimTabela}
                onChange={(e) => setDataFimTabela(e.target.value)}
                className="h-9 min-w-0 flex-1 bg-card @[640px]:w-[140px] @[640px]:flex-none"
                disabled={loading}
              />
            </div>

            {/* Limpar */}
            {temFiltrosAtivos && (
              <Button variant="ghost" size="sm" onClick={limparFiltros} className="h-9 gap-1.5 text-muted-foreground hover:text-foreground">
                <X className="h-3.5 w-3.5" /> Limpar
              </Button>
            )}
          </div>
        </div>

        {/* ── Tabela (container ≥ 640px) ── */}
        <div className="hidden overflow-x-auto @[640px]:block">
          <table className="w-full text-sm">
            <thead className="bg-muted/20 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-left font-medium @[800px]:px-5">Nº Pedido</th>
                <th className="px-4 py-3 text-left font-medium @[800px]:px-5">Empresa</th>
                <th className="hidden px-4 py-3 text-left font-medium @[800px]:table-cell @[800px]:px-5">Recebido em</th>
                <th className="hidden px-4 py-3 text-left font-medium @[900px]:table-cell @[900px]:px-5">Itens</th>
                <th className="px-4 py-3 text-right font-medium @[800px]:px-5">Valor</th>
                <th className="px-4 py-3 text-left font-medium @[800px]:px-5">Status</th>
                <th className="hidden px-4 py-3 text-left font-medium @[1000px]:table-cell @[1000px]:px-5">Confiança IA</th>
                <th className="px-4 py-3 text-right font-medium @[800px]:px-5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr>
                  <td colSpan={8} className="py-16 text-center text-sm text-muted-foreground">
                    <div className="flex items-center justify-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" /> Carregando pedidos…
                    </div>
                  </td>
                </tr>
              ) : pedidosFiltrados.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-16 text-center text-sm text-muted-foreground">
                    Nenhum pedido encontrado com esses filtros.
                  </td>
                </tr>
              ) : (
                pedidosFiltrados.map((p) => (
                  <tr key={p.id} className="transition-colors hover:bg-muted/30">
                    <td className="px-4 py-3.5 font-semibold text-foreground @[800px]:px-5">
                      {numeroPedido(p)}
                    </td>
                    <td className="max-w-[180px] truncate px-4 py-3.5 text-foreground @[800px]:max-w-none @[800px]:px-5">
                      {p.empresa || "-"}
                    </td>
                    <td className="hidden px-4 py-3.5 tabular-nums text-muted-foreground @[800px]:table-cell @[800px]:px-5">
                      {dataHoraCompacta(p.created_at)}
                    </td>
                    <td className="hidden px-4 py-3.5 tabular-nums text-muted-foreground @[900px]:table-cell @[900px]:px-5">
                      {p.itens_count}
                    </td>
                    <td className="px-4 py-3.5 text-right font-semibold tabular-nums text-foreground @[800px]:px-5">
                      {p.valor_total ? brl(Number(p.valor_total)) : "-"}
                    </td>
                    <td className="px-4 py-3.5 @[800px]:px-5">
                      <StatusBadge status={mapStatus(p.status)} />
                    </td>
                    <td className="hidden px-4 py-3.5 @[1000px]:table-cell @[1000px]:px-5">
                      <ConfiancaBadge valor={p.confianca_ia ? Math.round(Number(p.confianca_ia) * 100) : 0} />
                    </td>
                    <td className="px-4 py-3.5 text-right @[800px]:px-5">
                      <Link
                        to={`/pedido/${p.id}`}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                        aria-label="Abrir pedido"
                      >
                        <Eye className="h-4 w-4" />
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* ── Cards (container < 640px) ── */}
        <div className="divide-y divide-border @[640px]:hidden">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando pedidos…
            </div>
          ) : pedidosFiltrados.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted-foreground">
              Nenhum pedido encontrado com esses filtros.
            </p>
          ) : (
            pedidosFiltrados.map((p) => (
              <Link
                key={p.id}
                to={`/pedido/${p.id}`}
                className="block px-4 py-4 transition-colors hover:bg-muted/30 active:bg-muted/50"
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-foreground leading-snug">{numeroPedido(p)}</p>
                    <p className="mt-0.5 truncate text-sm text-muted-foreground">{p.empresa || "-"}</p>
                  </div>
                  <StatusBadge status={mapStatus(p.status)} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">{dataHoraCompacta(p.created_at)}</span>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span>{p.itens_count} {p.itens_count === 1 ? "item" : "itens"}</span>
                    <span className="font-semibold text-foreground text-sm">
                      {p.valor_total ? brl(Number(p.valor_total)) : "-"}
                    </span>
                  </div>
                </div>
                <div className="mt-2">
                  <ConfiancaBadge valor={p.confianca_ia ? Math.round(Number(p.confianca_ia) * 100) : 0} />
                </div>
              </Link>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ── MetricCard ──────────────────────────────────────────────────────────────

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
    primary:     "bg-primary/10 text-primary",
    success:     "bg-green-500/10 text-green-600",
    warning:     "bg-amber-500/10 text-amber-600",
    destructive: "bg-red-500/10 text-red-600",
    info:        "bg-blue-500/10 text-blue-600",
    orange:      "bg-orange-500/10 text-orange-600",
    purple:      "bg-purple-500/10 text-purple-600",
  };

  return (
    <div className={`rounded-xl border border-border bg-card p-[clamp(0.875rem,2vw,1.25rem)] shadow-sm transition-shadow hover:shadow-md ${destaque ? "border-primary/20 bg-primary/5" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{titulo}</p>
          <p className="mt-1.5 truncate text-[clamp(1.25rem,2.5vw,1.75rem)] font-bold tabular-nums text-foreground leading-none">
            {valor}
          </p>
        </div>
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${tomStyles[tom]}`}>
          <Icone className="h-4.5 w-4.5" size={18} />
        </div>
      </div>
    </div>
  );
}
