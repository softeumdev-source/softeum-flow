import React, { useEffect, useMemo, useState } from "react";
import { BarChart3, TrendingUp, Building2, Receipt, Loader2, Calendar, TrendingDown, Package } from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  LineChart,
  Line,
} from "recharts";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface PedidoRow {
  id: string;
  empresa: string | null;
  status: string | null;
  valor_total: number | null;
  created_at: string | null;
}

interface ItemRow {
  pedido_id: string;
  codigo_cliente: string | null;
  descricao: string | null;
  quantidade: number | null;
  preco_total: number | null;
}

const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// Compact format only for chart axis labels (scale indicators, not real values)
const brlAxis = (v: number) => {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
  return v.toFixed(0);
};

const fmtData = (iso: string) =>
  new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

function inicioPadrao() {
  const d = new Date();
  d.setDate(d.getDate() - 29);
  return d.toISOString().slice(0, 10);
}
function fimPadrao() {
  return new Date().toISOString().slice(0, 10);
}

function useWindowWidth() {
  const [width, setWidth] = useState(
    typeof window !== "undefined" ? window.innerWidth : 1280,
  );
  useEffect(() => {
    const h = () => setWidth(window.innerWidth);
    window.addEventListener("resize", h, { passive: true });
    return () => window.removeEventListener("resize", h);
  }, []);
  return width;
}

const STATUS_LABELS: Record<string, string> = {
  pendente: "Pendente",
  aprovado: "Aprovado",
  reprovado: "Reprovado",
  duplicado: "Duplicado",
  ignorado: "Arquivado",
  aprovado_parcial: "Aprov. parcial",
  aguardando_de_para: "Ag. DE-PARA",
  leitura_manual: "Leitura manual",
};

export default function Relatorios() {
  const { user, tenantId, loading: authLoading } = useAuth();
  const [pedidos, setPedidos] = useState<PedidoRow[]>([]);
  const [itens, setItens] = useState<ItemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dataInicio, setDataInicio] = useState(inicioPadrao());
  const [dataFim, setDataFim] = useState(fimPadrao());
  const [empresaFiltro, setEmpresaFiltro] = useState<string>("__all__");

  const windowWidth = useWindowWidth();
  const isMobile = windowWidth < 640;

  useEffect(() => {
    if (!user || !tenantId || authLoading) return;
    const load = async () => {
      setLoading(true);
      try {
        const inicioISO = new Date(`${dataInicio}T00:00:00`).toISOString();
        const fimISO = new Date(`${dataFim}T23:59:59`).toISOString();
        const { data, error } = await (supabase as any)
          .from("pedidos")
          .select("id, empresa, status, valor_total, created_at")
          .eq("tenant_id", tenantId)
          .gte("created_at", inicioISO)
          .lte("created_at", fimISO)
          .order("created_at", { ascending: false });
        if (error) throw error;
        const rows = (data || []) as PedidoRow[];
        setPedidos(rows);

        const aprovadosIds = rows
          .filter((p) => p.status === "aprovado")
          .map((p) => p.id);
        if (aprovadosIds.length > 0) {
          const { data: itensData, error: itensErr } = await (supabase as any)
            .from("pedido_itens")
            .select("pedido_id, codigo_cliente, descricao, quantidade, preco_total")
            .eq("tenant_id", tenantId)
            .in("pedido_id", aprovadosIds);
          if (itensErr) throw itensErr;
          setItens((itensData || []) as ItemRow[]);
        } else {
          setItens([]);
        }
      } catch (err: any) {
        toast.error("Erro ao carregar relatórios", { description: err.message });
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [user, tenantId, authLoading, dataInicio, dataFim]);

  const empresasDisponiveis = useMemo(() => {
    const set = new Set<string>();
    pedidos.forEach((p) => {
      if (p.empresa && p.empresa.trim()) set.add(p.empresa.trim());
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [pedidos]);

  const pedidosFiltrados = useMemo(() => {
    if (empresaFiltro === "__all__") return pedidos;
    return pedidos.filter((p) => (p.empresa || "").trim() === empresaFiltro);
  }, [pedidos, empresaFiltro]);

  const aprovados = useMemo(
    () => pedidosFiltrados.filter((p) => p.status === "aprovado"),
    [pedidosFiltrados],
  );

  const totalVendas = useMemo(
    () => aprovados.reduce((s, p) => s + Number(p.valor_total ?? 0), 0),
    [aprovados],
  );

  const ticketMedio = aprovados.length > 0 ? totalVendas / aprovados.length : 0;

  const taxaAprovacao =
    pedidosFiltrados.length > 0 ? (aprovados.length / pedidosFiltrados.length) * 100 : 0;

  const vendasPorDia = useMemo(() => {
    const map = new Map<string, { data: string; valor: number; pedidos: number }>();
    const cursor = new Date(`${dataInicio}T00:00:00`);
    const fim = new Date(`${dataFim}T00:00:00`);
    while (cursor <= fim) {
      const k = cursor.toISOString().slice(0, 10);
      map.set(k, { data: fmtData(k), valor: 0, pedidos: 0 });
      cursor.setDate(cursor.getDate() + 1);
    }
    aprovados.forEach((p) => {
      if (!p.created_at) return;
      const k = p.created_at.slice(0, 10);
      const e = map.get(k);
      if (e) {
        e.valor += Number(p.valor_total ?? 0);
        e.pedidos += 1;
      }
    });
    return Array.from(map.values());
  }, [aprovados, dataInicio, dataFim]);

  const ranking = useMemo(() => {
    const map = new Map<string, { empresa: string; pedidos: number; valor: number }>();
    aprovados.forEach((p) => {
      const k = p.empresa || "Sem empresa";
      const cur = map.get(k) ?? { empresa: k, pedidos: 0, valor: 0 };
      cur.pedidos += 1;
      cur.valor += Number(p.valor_total ?? 0);
      map.set(k, cur);
    });
    return Array.from(map.values())
      .sort((a, b) => b.valor - a.valor)
      .slice(0, 10);
  }, [aprovados]);

  const porStatus = useMemo(() => {
    const counts: Record<string, number> = {};
    pedidosFiltrados.forEach((p) => {
      const k = p.status || "pendente";
      counts[k] = (counts[k] ?? 0) + 1;
    });
    return Object.entries(counts).map(([status, count]) => ({
      status,
      label: STATUS_LABELS[status] ?? status,
      count,
    }));
  }, [pedidosFiltrados]);

  const produtosAgg = useMemo(() => {
    const aprovadosIds = new Set(aprovados.map((p) => p.id));
    const map = new Map<string, { nome: string; quantidade: number; valor: number; pedidos: number }>();
    itens
      .filter((it) => aprovadosIds.has(it.pedido_id))
      .forEach((it) => {
        const nome =
          (it.descricao && it.descricao.trim()) ||
          (it.codigo_cliente && it.codigo_cliente.trim()) ||
          "Sem descrição";
        const cur = map.get(nome) ?? { nome, quantidade: 0, valor: 0, pedidos: 0 };
        cur.quantidade += Number(it.quantidade ?? 0);
        cur.valor += Number(it.preco_total ?? 0);
        cur.pedidos += 1;
        map.set(nome, cur);
      });
    return Array.from(map.values());
  }, [itens, aprovados]);

  const maisVendidos = useMemo(
    () => [...produtosAgg].sort((a, b) => b.quantidade - a.quantidade).slice(0, 5),
    [produtosAgg],
  );
  const menosVendidos = useMemo(
    () => [...produtosAgg].sort((a, b) => a.quantidade - b.quantidade).slice(0, 5),
    [produtosAgg],
  );

  const tooltipStyle = {
    background: "hsl(var(--card))",
    border: "1px solid hsl(var(--border))",
    borderRadius: 8,
    fontSize: 12,
  };

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-8 sm:py-8">

      {/* Header + filtros */}
      <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Relatórios</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Vendas, ranking de empresas e ticket médio dos pedidos aprovados.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Empresa</label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  className="w-full justify-between font-normal sm:w-[260px]"
                >
                  <span className="truncate">
                    {empresaFiltro === "__all__" ? "Todas as empresas" : empresaFiltro}
                  </span>
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[min(320px,calc(100vw-2rem))] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Buscar por nome ou CNPJ..." />
                  <CommandList>
                    <CommandEmpty>Nenhuma empresa encontrada.</CommandEmpty>
                    <CommandGroup>
                      <CommandItem value="todas" onSelect={() => setEmpresaFiltro("__all__")}>
                        <Check className={cn("mr-2 h-4 w-4", empresaFiltro === "__all__" ? "opacity-100" : "opacity-0")} />
                        Todas as empresas
                      </CommandItem>
                      {empresasDisponiveis.map((emp) => (
                        <CommandItem key={emp} value={emp} onSelect={() => setEmpresaFiltro(emp)}>
                          <Check className={cn("mr-2 h-4 w-4", empresaFiltro === emp ? "opacity-100" : "opacity-0")} />
                          <span className="truncate">{emp}</span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
          <div className="flex gap-2">
            <div className="flex-1 sm:flex-none">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">De</label>
              <Input
                type="date"
                value={dataInicio}
                onChange={(e) => setDataInicio(e.target.value)}
                className="w-full sm:w-[160px]"
              />
            </div>
            <div className="flex-1 sm:flex-none">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Até</label>
              <Input
                type="date"
                value={dataFim}
                onChange={(e) => setDataFim(e.target.value)}
                className="w-full sm:w-[160px]"
              />
            </div>
          </div>
          <Button
            variant="outline"
            onClick={() => {
              setDataInicio(inicioPadrao());
              setDataFim(fimPadrao());
              setEmpresaFiltro("__all__");
            }}
            className="gap-2"
          >
            <Calendar className="h-4 w-4" />
            Últimos 30 dias
          </Button>
        </div>
      </div>

      {/* Métricas */}
      <div
        className="mb-6 grid gap-4"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(160px,100%),1fr))" }}
      >
        <Card titulo="Total de vendas" valor={brl(totalVendas)} icone={TrendingUp} tom="success" />
        <Card titulo="Pedidos aprovados" valor={aprovados.length} icone={Receipt} tom="primary" />
        <Card titulo="Ticket médio" valor={brl(ticketMedio)} icone={BarChart3} tom="info" />
        <Card
          titulo="Taxa de aprovação"
          valor={`${taxaAprovacao.toFixed(1)}%`}
          icone={Building2}
          tom="warning"
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center rounded-xl border border-border bg-card py-20 text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Carregando relatórios...
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">

          {/* Vendas por dia */}
          <div className="rounded-xl border border-border bg-card p-4 shadow-softeum-sm sm:p-5 lg:col-span-2">
            <h2 className="mb-1 text-base font-semibold text-foreground">Vendas por dia</h2>
            <p className="mb-4 text-xs text-muted-foreground">
              Valor total dos pedidos aprovados no período.
            </p>
            <div style={{ minHeight: 250, height: "clamp(250px, 35vw, 400px)" }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={vendasPorDia}
                  margin={{
                    top: 5,
                    right: 10,
                    left: isMobile ? 0 : 10,
                    bottom: isMobile ? 50 : 10,
                  }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis
                    dataKey="data"
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={isMobile ? 10 : 12}
                    angle={isMobile ? -45 : 0}
                    textAnchor={isMobile ? "end" : "middle"}
                    interval={isMobile ? 2 : 0}
                    tick={{ fill: "hsl(var(--muted-foreground))" }}
                  />
                  <YAxis
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={isMobile ? 10 : 12}
                    tickFormatter={(v) => brlAxis(Number(v))}
                    width={isMobile ? 48 : 72}
                    tick={{ fill: "hsl(var(--muted-foreground))" }}
                  />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(v: number) => [brl(Number(v)), "Valor"]}
                    labelFormatter={(l) => `Data: ${l}`}
                  />
                  <Line
                    type="monotone"
                    dataKey="valor"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2.5}
                    dot={{ r: 3 }}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Top empresas */}
          <div className="rounded-xl border border-border bg-card p-4 shadow-softeum-sm sm:p-5">
            <h2 className="mb-1 text-base font-semibold text-foreground">Top empresas</h2>
            <p className="mb-4 text-xs text-muted-foreground">
              Empresas que mais geraram receita no período.
            </p>
            {ranking.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                Sem pedidos aprovados no período.
              </p>
            ) : (
              <>
                {/* Mobile: cards verticais */}
                <div className="flex flex-col gap-2 sm:hidden">
                  {ranking.map((r, i) => (
                    <div key={r.empresa} className="rounded-lg border border-border bg-background px-3 py-2.5">
                      <p className="mb-1 text-xs font-semibold text-muted-foreground">
                        #{i + 1}
                      </p>
                      <p className="mb-2 break-words text-sm font-semibold text-foreground">
                        {r.empresa}
                      </p>
                      <div className="flex gap-4 text-xs text-muted-foreground">
                        <span>
                          <span className="font-medium text-foreground">{r.pedidos}</span> pedidos
                        </span>
                        <span>
                          <span className="font-medium text-foreground">{brl(r.valor)}</span>
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
                {/* Tablet+: tabela */}
                <div className="hidden overflow-x-auto sm:block">
                  <table className="w-full text-sm">
                    <thead className="text-xs uppercase tracking-wider text-muted-foreground">
                      <tr className="border-b border-border">
                        <th className="py-2 text-left font-medium">#</th>
                        <th className="py-2 text-left font-medium">Empresa</th>
                        <th className="py-2 text-right font-medium">Pedidos</th>
                        <th className="py-2 text-right font-medium">Valor total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {ranking.map((r, i) => (
                        <tr key={r.empresa}>
                          <td className="py-2.5 text-muted-foreground tabular-nums">{i + 1}</td>
                          <td className="max-w-[180px] py-2.5 text-foreground">
                            <span className="block break-words">{r.empresa}</span>
                          </td>
                          <td className="py-2.5 text-right tabular-nums text-foreground">{r.pedidos}</td>
                          <td className="py-2.5 text-right font-semibold tabular-nums text-foreground">
                            {brl(r.valor)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>

          {/* Distribuição por status */}
          <div className="rounded-xl border border-border bg-card p-4 shadow-softeum-sm sm:p-5">
            <h2 className="mb-1 text-base font-semibold text-foreground">Pedidos por status</h2>
            <p className="mb-4 text-xs text-muted-foreground">
              Distribuição de todos os pedidos do período.
            </p>
            <div style={{ minHeight: 250, height: "clamp(250px, 35vw, 320px)" }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={porStatus}
                  margin={{
                    top: 5,
                    right: 10,
                    left: 0,
                    bottom: isMobile ? 40 : 10,
                  }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis
                    dataKey="label"
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={isMobile ? 10 : 12}
                    angle={isMobile ? -30 : 0}
                    textAnchor={isMobile ? "end" : "middle"}
                    tick={{ fill: "hsl(var(--muted-foreground))" }}
                  />
                  <YAxis
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={isMobile ? 10 : 12}
                    allowDecimals={false}
                    width={isMobile ? 28 : 40}
                    tick={{ fill: "hsl(var(--muted-foreground))" }}
                  />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(value: number) => [value, "Pedidos"]}
                  />
                  <Bar dataKey="count" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Produtos mais vendidos */}
          <ProdutosTable
            titulo="Produtos mais vendidos"
            descricao="Top 5 produtos por quantidade nos pedidos aprovados do período."
            icone={<Package className="h-4 w-4 text-green-600" />}
            dados={maisVendidos}
          />

          {/* Produtos menos vendidos */}
          <ProdutosTable
            titulo="Produtos menos vendidos"
            descricao="Bottom 5 produtos por quantidade nos pedidos aprovados do período."
            icone={<TrendingDown className="h-4 w-4 text-amber-600" />}
            dados={menosVendidos}
          />
        </div>
      )}
    </div>
  );
}

function ProdutosTable({
  titulo,
  descricao,
  icone,
  dados,
}: {
  titulo: string;
  descricao: string;
  icone: React.ReactNode;
  dados: { nome: string; quantidade: number; valor: number }[];
}) {
  const brl = (v: number) =>
    v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-softeum-sm sm:p-5">
      <div className="mb-1 flex items-center gap-2">
        {icone}
        <h2 className="text-base font-semibold text-foreground">{titulo}</h2>
      </div>
      <p className="mb-4 text-xs text-muted-foreground">{descricao}</p>
      {dados.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          Sem itens nos pedidos aprovados do período.
        </p>
      ) : (
        <>
          {/* Mobile: cards verticais */}
          <div className="flex flex-col gap-2 sm:hidden">
            {dados.map((p, i) => (
              <div key={p.nome} className="rounded-lg border border-border bg-background px-3 py-2.5">
                <p className="mb-1 text-xs font-semibold text-muted-foreground">#{i + 1}</p>
                <p className="mb-2 break-words text-sm font-semibold text-foreground">{p.nome}</p>
                <div className="flex gap-4 text-xs text-muted-foreground">
                  <span>
                    Qtd: <span className="font-medium text-foreground">{p.quantidade.toLocaleString("pt-BR")}</span>
                  </span>
                  <span>
                    Total: <span className="font-medium text-foreground">{brl(p.valor)}</span>
                  </span>
                </div>
              </div>
            ))}
          </div>
          {/* Tablet+: tabela */}
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wider text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="py-2 text-left font-medium">#</th>
                  <th className="py-2 text-left font-medium">Produto</th>
                  <th className="py-2 text-right font-medium">Qtd</th>
                  <th className="py-2 text-right font-medium">Valor total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {dados.map((p, i) => (
                  <tr key={p.nome}>
                    <td className="py-2.5 text-muted-foreground tabular-nums">{i + 1}</td>
                    <td className="max-w-[200px] py-2.5 text-foreground">
                      <span className="block break-words">{p.nome}</span>
                    </td>
                    <td className="py-2.5 text-right tabular-nums text-foreground">
                      {p.quantidade.toLocaleString("pt-BR")}
                    </td>
                    <td className="py-2.5 text-right font-semibold tabular-nums text-foreground">
                      {brl(p.valor)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

type Tom = "primary" | "success" | "warning" | "info";
function Card({
  titulo,
  valor,
  icone: Icone,
  tom,
}: {
  titulo: string;
  valor: string | number;
  icone: typeof TrendingUp;
  tom: Tom;
}) {
  const tomStyles: Record<Tom, string> = {
    primary: "bg-primary/10 text-primary",
    success: "bg-green-500/10 text-green-600",
    warning: "bg-amber-500/10 text-amber-600",
    info: "bg-blue-500/10 text-blue-600",
  };
  return (
    <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-1">
        <p className="line-clamp-2 text-[10px] font-medium uppercase leading-tight tracking-wider text-muted-foreground">
          {titulo}
        </p>
        <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${tomStyles[tom]}`}>
          <Icone className="h-3.5 w-3.5" />
        </div>
      </div>
      <p
        className="break-words font-bold leading-snug tabular-nums text-foreground"
        style={{ fontSize: "clamp(0.75rem, 2vw, 1.25rem)" }}
      >
        {valor}
      </p>
    </div>
  );
}
