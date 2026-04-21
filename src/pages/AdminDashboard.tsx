import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Building2, Users, FileText, DollarSign, AlertTriangle, TrendingUp, Loader2, ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Metricas {
  totalTenants: number;
  tenantsAtivos: number;
  totalUsuarios: number;
  pedidosMes: number;
  valorProcessadoMes: number;
  errosIaMes: number;
}

interface TenantTopo {
  id: string;
  nome: string;
  slug: string;
  pedidos: number;
}

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const num = (v: number) => v.toLocaleString("pt-BR");

const mesAnoAtual = () => {
  const d = new Date();
  return { mes: d.getMonth() + 1, ano: d.getFullYear() };
};

export default function AdminDashboard() {
  const [loading, setLoading] = useState(true);
  const [metricas, setMetricas] = useState<Metricas>({
    totalTenants: 0,
    tenantsAtivos: 0,
    totalUsuarios: 0,
    pedidosMes: 0,
    valorProcessadoMes: 0,
    errosIaMes: 0,
  });
  const [topTenants, setTopTenants] = useState<TenantTopo[]>([]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const sb = supabase as any;
        const { mes, ano } = mesAnoAtual();

        const [
          { data: tenants, error: errTen },
          { count: totalUsuarios, error: errUsu },
          { data: uso, error: errUso },
        ] = await Promise.all([
          sb.from("tenants").select("id, nome, slug, ativo"),
          sb.from("tenant_membros").select("*", { count: "exact", head: true }).eq("ativo", true),
          sb.from("tenant_uso").select("tenant_id, total_pedidos, valor_total_processado, total_erros").eq("mes", mes).eq("ano", ano),
        ]);

        if (errTen) throw errTen;
        if (errUsu) throw errUsu;
        if (errUso) throw errUso;

        const tenantsList = tenants ?? [];
        const usoList = uso ?? [];

        const pedidosMes = usoList.reduce((s: number, u: any) => s + (u.total_pedidos ?? 0), 0);
        const valorProcessadoMes = usoList.reduce((s: number, u: any) => s + Number(u.valor_total_processado ?? 0), 0);
        const errosIaMes = usoList.reduce((s: number, u: any) => s + (u.total_erros ?? 0), 0);

        setMetricas({
          totalTenants: tenantsList.length,
          tenantsAtivos: tenantsList.filter((t: any) => t.ativo).length,
          totalUsuarios: totalUsuarios ?? 0,
          pedidosMes,
          valorProcessadoMes,
          errosIaMes,
        });

        // Top 5 tenants do mês
        const tenantMap = new Map(tenantsList.map((t: any) => [t.id, t]));
        const top = usoList
          .map((u: any) => {
            const t = tenantMap.get(u.tenant_id) as any;
            return t ? { id: t.id, nome: t.nome, slug: t.slug, pedidos: u.total_pedidos ?? 0 } : null;
          })
          .filter(Boolean)
          .sort((a: any, b: any) => b.pedidos - a.pedidos)
          .slice(0, 5) as TenantTopo[];

        setTopTenants(top);
      } catch (e: any) {
        toast.error("Erro ao carregar métricas: " + (e?.message ?? e));
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const cards = [
    { titulo: "Clientes ativos", valor: num(metricas.tenantsAtivos), sub: `${metricas.totalTenants} no total`, icon: Building2, cor: "text-primary", bg: "bg-primary-soft" },
    { titulo: "Usuários", valor: num(metricas.totalUsuarios), sub: "Membros ativos", icon: Users, cor: "text-info", bg: "bg-info/10" },
    { titulo: "Pedidos no mês", valor: num(metricas.pedidosMes), sub: "Em todos os clientes", icon: FileText, cor: "text-success", bg: "bg-success-soft" },
    { titulo: "Volume processado", valor: brl(metricas.valorProcessadoMes), sub: "Soma do mês", icon: DollarSign, cor: "text-success", bg: "bg-success-soft" },
    { titulo: "Erros de IA", valor: num(metricas.errosIaMes), sub: "Pedidos com falha", icon: AlertTriangle, cor: "text-destructive", bg: "bg-destructive/10" },
    { titulo: "Crescimento", valor: `${metricas.tenantsAtivos > 0 ? Math.round((metricas.pedidosMes / metricas.tenantsAtivos)) : 0}`, sub: "Pedidos / cliente (média)", icon: TrendingUp, cor: "text-primary", bg: "bg-primary-soft" },
  ];

  return (
    <div className="mx-auto w-full max-w-[1400px] px-8 py-8">
      <div className="mb-7">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Painel Admin</h1>
        <p className="mt-1 text-sm text-muted-foreground">Visão geral da plataforma Softeum.</p>
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {cards.map((c) => {
              const Icon = c.icon;
              return (
                <div key={c.titulo} className="rounded-xl border border-border bg-card p-5 shadow-softeum-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{c.titulo}</span>
                    <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${c.bg}`}>
                      <Icon className={`h-4 w-4 ${c.cor}`} />
                    </span>
                  </div>
                  <p className="mt-3 text-2xl font-bold text-foreground">{c.valor}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{c.sub}</p>
                </div>
              );
            })}
          </div>

          <div className="mt-8 rounded-xl border border-border bg-card shadow-softeum-sm">
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
              <div>
                <h2 className="text-base font-semibold text-foreground">Top clientes do mês</h2>
                <p className="text-xs text-muted-foreground">Por volume de pedidos processados</p>
              </div>
              <Link to="/admin/tenants" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                Ver todos <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
            {topTenants.length === 0 ? (
              <div className="px-6 py-12 text-center text-sm text-muted-foreground">Nenhum pedido processado no mês.</div>
            ) : (
              <ul className="divide-y divide-border">
                {topTenants.map((t, i) => (
                  <li key={t.id}>
                    <Link to={`/admin/tenants/${t.id}`} className="flex items-center justify-between px-6 py-3.5 transition-colors hover:bg-muted/40">
                      <div className="flex items-center gap-3">
                        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary">
                          {i + 1}
                        </span>
                        <div>
                          <p className="text-sm font-medium text-foreground">{t.nome}</p>
                          <p className="text-xs text-muted-foreground">{t.slug}</p>
                        </div>
                      </div>
                      <span className="text-sm font-semibold text-foreground">{num(t.pedidos)} pedidos</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
