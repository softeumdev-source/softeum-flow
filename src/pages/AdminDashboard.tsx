import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Building2, Users, FileText, DollarSign, AlertTriangle, TrendingUp, Loader2, ArrowRight, AlertCircle, CalendarClock, Wallet, Receipt, Repeat, Banknote } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { calcularStatusVencimento } from "@/lib/vencimento";

interface Metricas {
  totalTenants: number;
  tenantsAtivos: number;
  totalUsuarios: number;
  pedidosMes: number;
  valorProcessadoMes: number;
  errosIaMes: number;
  receitaMensal: number;
  setupAReceber: number;
  mrrTotal: number;
  qtdVencendo: number;
  qtdInadimplentes: number;
  qtdExcedentes: number;
}

interface TenantTopo {
  id: string;
  nome: string;
  slug: string;
  pedidos: number;
}

interface Excedente {
  id: string;
  nome: string;
  slug: string;
  pedidos: number;
  limite: number;
  excedente: number;
  valorUnitario: number;
  valorACobrar: number;
}

interface VencimentoProximo {
  id: string;
  nome: string;
  slug: string;
  diaVencimento: number;
  diasRestantes: number; // 0 = hoje, negativo = vencido
  vencido: boolean;
  valorMensal: number | null;
  emailFinanceiro: string | null;
}

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const num = (v: number) => v.toLocaleString("pt-BR");
const anoMesAtual = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
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
    receitaMensal: 0,
    setupAReceber: 0,
    mrrTotal: 0,
    qtdVencendo: 0,
    qtdInadimplentes: 0,
    qtdExcedentes: 0,
  });
  const [topTenants, setTopTenants] = useState<TenantTopo[]>([]);
  const [excedentes, setExcedentes] = useState<Excedente[]>([]);
  const [vencimentos, setVencimentos] = useState<VencimentoProximo[]>([]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const sb = supabase as any;
        const ano_mes = anoMesAtual();

        const [
          { data: tenants, error: errTen },
          { count: totalUsuarios, error: errUsu },
          { data: uso, error: errUso },
          { data: configs, error: errCfg },
        ] = await Promise.all([
          sb.from("tenants").select("id, nome, slug, ativo, limite_pedidos_mes, dia_vencimento, valor_mensal, valor_setup, email_financeiro, created_at"),
          sb.from("tenant_membros").select("*", { count: "exact", head: true }).eq("ativo", true),
          sb.from("tenant_uso").select("tenant_id, pedidos_processados, total_previsto_processado, erros_ia").eq("ano_mes", ano_mes),
          sb.from("configuracoes").select("tenant_id, chave, valor").in("chave", ["valor_excedente", "excedente_cobrado_em"]),
        ]);

        if (errTen) throw errTen;
        if (errUsu) throw errUsu;
        if (errUso) throw errUso;
        if (errCfg) throw errCfg;

        const tenantsList = tenants ?? [];
        const usoList = uso ?? [];

        const pedidosMes = usoList.reduce((s: number, u: any) => s + (u.pedidos_processados ?? 0), 0);
        const valorProcessadoMes = usoList.reduce((s: number, u: any) => s + Number(u.total_previsto_processado ?? 0), 0);
        const errosIaMes = usoList.reduce((s: number, u: any) => s + (u.erros_ia ?? 0), 0);

        setMetricas({
          totalTenants: tenantsList.length,
          tenantsAtivos: tenantsList.filter((t: any) => t.ativo).length,
          totalUsuarios: totalUsuarios ?? 0,
          pedidosMes,
          valorProcessadoMes,
          errosIaMes,
        });

        const tenantMap = new Map(tenantsList.map((t: any) => [t.id, t]));

        // Top 5
        const top = usoList
          .map((u: any) => {
            const t: any = tenantMap.get(u.tenant_id);
            return t ? { id: t.id, nome: t.nome, slug: t.slug, pedidos: u.pedidos_processados ?? 0 } : null;
          })
          .filter(Boolean)
          .sort((a: any, b: any) => b.pedidos - a.pedidos)
          .slice(0, 5) as TenantTopo[];
        setTopTenants(top);

        // Excedentes a cobrar
        const valorExcMap = new Map<string, number>();
        const cobradoMap = new Map<string, string | null>();
        (configs ?? []).forEach((c: any) => {
          if (c.chave === "valor_excedente") valorExcMap.set(c.tenant_id, parseFloat(c.valor ?? "0") || 0);
          if (c.chave === "excedente_cobrado_em") cobradoMap.set(c.tenant_id, c.valor);
        });

        const exc: Excedente[] = [];
        usoList.forEach((u: any) => {
          const t: any = tenantMap.get(u.tenant_id);
          if (!t) return;
          const limite = t.limite_pedidos_mes ?? 0;
          const pedidos = u.pedidos_processados ?? 0;
          if (limite > 0 && pedidos > limite) {
            const cob = cobradoMap.get(t.id);
            const cobradoEsteMes = cob?.startsWith(ano_mes) ?? false;
            if (cobradoEsteMes) return;
            const excQtd = pedidos - limite;
            const valorUnit = valorExcMap.get(t.id) ?? 0;
            exc.push({
              id: t.id,
              nome: t.nome,
              slug: t.slug,
              pedidos,
              limite,
              excedente: excQtd,
              valorUnitario: valorUnit,
              valorACobrar: excQtd * valorUnit,
            });
          }
        });
        exc.sort((a, b) => b.valorACobrar - a.valorACobrar);
        setExcedentes(exc);

        // Mensalidades a vencer (próximos 5 dias) ou vencidas
        const venc: VencimentoProximo[] = [];
        tenantsList.forEach((t: any) => {
          if (!t.ativo) return;
          const v = calcularStatusVencimento(t.dia_vencimento);
          if (v.tipo === "a-vencer" || v.tipo === "vence-hoje" || v.tipo === "vencido") {
            const diasRestantes = v.tipo === "a-vencer" ? v.diasRestantes : v.tipo === "vence-hoje" ? 0 : -v.diasAtraso;
            venc.push({
              id: t.id,
              nome: t.nome,
              slug: t.slug,
              diaVencimento: t.dia_vencimento,
              diasRestantes,
              vencido: v.tipo === "vencido",
              valorMensal: t.valor_mensal != null ? Number(t.valor_mensal) : null,
              emailFinanceiro: t.email_financeiro ?? null,
            });
          }
        });
        venc.sort((a, b) => a.diasRestantes - b.diasRestantes);
        setVencimentos(venc);
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
    { titulo: "Crescimento", valor: `${metricas.tenantsAtivos > 0 ? Math.round(metricas.pedidosMes / metricas.tenantsAtivos) : 0}`, sub: "Pedidos / cliente (média)", icon: TrendingUp, cor: "text-primary", bg: "bg-primary-soft" },
  ];

  const totalACobrar = excedentes.reduce((s, e) => s + e.valorACobrar, 0);

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

          {/* Excedentes a cobrar */}
          <div className="mt-8 rounded-xl border border-border bg-card shadow-softeum-sm">
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
                  <AlertCircle className="h-4 w-4" />
                </span>
                <div>
                  <h2 className="text-base font-semibold text-foreground">Excedentes a cobrar</h2>
                  <p className="text-xs text-muted-foreground">Clientes que ultrapassaram o limite no mês atual</p>
                </div>
              </div>
              {excedentes.length > 0 && (
                <div className="text-right">
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">Total a cobrar</p>
                  <p className="text-lg font-bold text-destructive">{brl(totalACobrar)}</p>
                </div>
              )}
            </div>
            {excedentes.length === 0 ? (
              <div className="px-6 py-12 text-center text-sm text-muted-foreground">Nenhum excedente pendente este mês. 🎉</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-5 py-2.5 text-left font-medium">Cliente</th>
                    <th className="px-5 py-2.5 text-right font-medium">Pedidos / limite</th>
                    <th className="px-5 py-2.5 text-right font-medium">Excedente</th>
                    <th className="px-5 py-2.5 text-right font-medium">Valor unitário</th>
                    <th className="px-5 py-2.5 text-right font-medium">A cobrar</th>
                    <th className="px-5 py-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {excedentes.map((e) => (
                    <tr key={e.id} className="hover:bg-muted/30">
                      <td className="px-5 py-3">
                        <p className="font-medium text-foreground">{e.nome}</p>
                        <p className="text-xs text-muted-foreground">{e.slug}</p>
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums text-foreground">{num(e.pedidos)} / {num(e.limite)}</td>
                      <td className="px-5 py-3 text-right">
                        <span className="inline-flex items-center rounded-full bg-destructive/15 px-2 py-0.5 text-xs font-semibold text-destructive">
                          +{num(e.excedente)}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">{brl(e.valorUnitario)}</td>
                      <td className="px-5 py-3 text-right tabular-nums font-semibold text-foreground">{brl(e.valorACobrar)}</td>
                      <td className="px-5 py-3 text-right">
                        <Link to={`/admin/tenants/${e.id}`} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                          Ver <ArrowRight className="h-3 w-3" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Mensalidades a vencer */}
          <div className="mt-8 rounded-xl border border-border bg-card shadow-softeum-sm">
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-warning/15 text-warning">
                  <CalendarClock className="h-4 w-4" />
                </span>
                <div>
                  <h2 className="text-base font-semibold text-foreground">Mensalidades a vencer</h2>
                  <p className="text-xs text-muted-foreground">Clientes com vencimento nos próximos 5 dias ou já vencidos</p>
                </div>
              </div>
              {vencimentos.length > 0 && (
                <span className="inline-flex items-center rounded-full bg-warning/15 px-2.5 py-0.5 text-xs font-semibold text-warning">
                  {num(vencimentos.length)} {vencimentos.length === 1 ? "cliente" : "clientes"}
                </span>
              )}
            </div>
            {vencimentos.length === 0 ? (
              <div className="px-6 py-12 text-center text-sm text-muted-foreground">Nenhuma mensalidade próxima do vencimento. ✅</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-5 py-2.5 text-left font-medium">Cliente</th>
                    <th className="px-5 py-2.5 text-center font-medium">Dia venc.</th>
                    <th className="px-5 py-2.5 text-left font-medium">Status</th>
                    <th className="px-5 py-2.5 text-right font-medium">Valor mensal</th>
                    <th className="px-5 py-2.5 text-left font-medium">E-mail financeiro</th>
                    <th className="px-5 py-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {vencimentos.map((v) => (
                    <tr key={v.id} className="hover:bg-muted/30">
                      <td className="px-5 py-3">
                        <p className="font-medium text-foreground">{v.nome}</p>
                        <p className="text-xs text-muted-foreground">{v.slug}</p>
                      </td>
                      <td className="px-5 py-3 text-center tabular-nums text-foreground">dia {v.diaVencimento}</td>
                      <td className="px-5 py-3">
                        {v.vencido ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-destructive/15 px-2 py-0.5 text-xs font-semibold text-destructive">
                            <AlertTriangle className="h-3 w-3" /> Vencido há {Math.abs(v.diasRestantes)} {Math.abs(v.diasRestantes) === 1 ? "dia" : "dias"}
                          </span>
                        ) : v.diasRestantes === 0 ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-xs font-semibold text-warning">
                            <CalendarClock className="h-3 w-3" /> Vence hoje
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-xs font-semibold text-warning">
                            <CalendarClock className="h-3 w-3" /> Vence em {v.diasRestantes} {v.diasRestantes === 1 ? "dia" : "dias"}
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums font-medium text-foreground">
                        {v.valorMensal != null ? brl(v.valorMensal) : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-5 py-3 text-muted-foreground">{v.emailFinanceiro ?? "—"}</td>
                      <td className="px-5 py-3 text-right">
                        <Link to={`/admin/tenants/${v.id}`} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                          Ver <ArrowRight className="h-3 w-3" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
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
