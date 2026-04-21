import { useEffect, useMemo, useState } from "react";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  produto_codigo: string | null;
  produto_descricao: string | null;
  quantidade: number | null;
  total: number | null;
}

const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

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

export default function Relatorios() {
  const { user, loading: authLoading } = useAuth();
  const [pedidos, setPedidos] = useState<PedidoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dataInicio, setDataInicio] = useState(inicioPadrao());
  const [dataFim, setDataFim] = useState(fimPadrao());

  useEffect(() => {
    if (!user || authLoading) return;
    const load = async () => {
      setLoading(true);
      try {
        const inicioISO = new Date(`${dataInicio}T00:00:00`).toISOString();
        const fimISO = new Date(`${dataFim}T23:59:59`).toISOString();
        const { data, error } = await (supabase as any)
          .from("pedidos")
          .select("id, empresa, status, valor_total, created_at")
          .gte("created_at", inicioISO)
          .lte("created_at", fimISO)
          .order("created_at", { ascending: false });
        if (error) throw error;
        setPedidos((data || []) as PedidoRow[]);
      } catch (err: any) {
        toast.error("Erro ao carregar relatórios", { description: err.message });
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [user, authLoading, dataInicio, dataFim]);

  const aprovados = useMemo(
    () => pedidos.filter((p) => p.status === "aprovado"),
    [pedidos],
  );

  const totalVendas = useMemo(
    () => aprovados.reduce((s, p) => s + Number(p.valor_total ?? 0), 0),
    [aprovados],
  );

  const ticketMedio = aprovados.length > 0 ? totalVendas / aprovados.length : 0;

  const taxaAprovacao =
    pedidos.length > 0 ? (aprovados.length / pedidos.length) * 100 : 0;

  // Vendas por dia (apenas aprovados)
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

  // Ranking empresas
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

  // Status distribuição
  const porStatus = useMemo(() => {
    const counts: Record<string, number> = {};
    pedidos.forEach((p) => {
      const k = p.status || "pendente";
      counts[k] = (counts[k] ?? 0) + 1;
    });
    return Object.entries(counts).map(([status, count]) => ({ status, count }));
  }, [pedidos]);

  return (
    <div className="mx-auto w-full max-w-[1400px] px-8 py-8">
      <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Relatórios</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Vendas, ranking de empresas e ticket médio dos pedidos aprovados.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">De</label>
            <Input
              type="date"
              value={dataInicio}
              onChange={(e) => setDataInicio(e.target.value)}
              className="w-[160px]"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Até</label>
            <Input
              type="date"
              value={dataFim}
              onChange={(e) => setDataFim(e.target.value)}
              className="w-[160px]"
            />
          </div>
          <Button
            variant="outline"
            onClick={() => {
              setDataInicio(inicioPadrao());
              setDataFim(fimPadrao());
            }}
            className="gap-2"
          >
            <Calendar className="h-4 w-4" />
            Últimos 30 dias
          </Button>
        </div>
      </div>

      {/* Métricas */}
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
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
          <div className="rounded-xl border border-border bg-card p-5 shadow-softeum-sm lg:col-span-2">
            <h2 className="mb-1 text-base font-semibold text-foreground">Vendas por dia</h2>
            <p className="mb-4 text-xs text-muted-foreground">
              Valor total dos pedidos aprovados no período.
            </p>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={vendasPorDia}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="data" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <YAxis
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={12}
                    tickFormatter={(v) => brl(Number(v))}
                    width={90}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 8,
                    }}
                    formatter={(v: number) => brl(Number(v))}
                  />
                  <Line
                    type="monotone"
                    dataKey="valor"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2.5}
                    dot={{ r: 3 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Ranking empresas */}
          <div className="rounded-xl border border-border bg-card p-5 shadow-softeum-sm">
            <h2 className="mb-1 text-base font-semibold text-foreground">Top empresas</h2>
            <p className="mb-4 text-xs text-muted-foreground">
              Empresas que mais geraram receita no período.
            </p>
            {ranking.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                Sem pedidos aprovados no período.
              </p>
            ) : (
              <div className="overflow-x-auto">
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
                        <td className="py-2.5 truncate text-foreground">{r.empresa}</td>
                        <td className="py-2.5 text-right tabular-nums text-foreground">
                          {r.pedidos}
                        </td>
                        <td className="py-2.5 text-right font-semibold tabular-nums text-foreground">
                          {brl(r.valor)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Distribuição por status */}
          <div className="rounded-xl border border-border bg-card p-5 shadow-softeum-sm">
            <h2 className="mb-1 text-base font-semibold text-foreground">Pedidos por status</h2>
            <p className="mb-4 text-xs text-muted-foreground">
              Distribuição de todos os pedidos do período.
            </p>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={porStatus}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="status" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 8,
                    }}
                  />
                  <Bar dataKey="count" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
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
    <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {titulo}
          </p>
          <p className="mt-2 truncate text-2xl font-bold tabular-nums text-foreground">{valor}</p>
        </div>
        <div className={`ml-3 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg ${tomStyles[tom]}`}>
          <Icone className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}
