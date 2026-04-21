import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Building2,
  FileText,
  AlertTriangle,
  TrendingUp,
  Loader2,
  ArrowRight,
  AlertCircle,
  CalendarClock,
  Wallet,
  Receipt,
  Repeat,
  Banknote,
  CheckCircle2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { calcularStatusVencimento } from "@/lib/vencimento";

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

interface Vencimento {
  id: string;
  nome: string;
  slug: string;
  diaVencimento: number;
  diasRestantes: number; // 0 hoje, negativo = vencido
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
  const [topTenants, setTopTenants] = useState<TenantTopo[]>([]);
  const [excedentes, setExcedentes] = useState<Excedente[]>([]);
  const [vencimentos, setVencimentos] = useState<Vencimento[]>([]);
  const [tenantsAtivos, setTenantsAtivos] = useState(0);
  const [mrrTotal, setMrrTotal] = useState(0);
  const [setupMes, setSetupMes] = useState(0);
  const [pagandoId, setPagandoId] = useState<string | null>(null);

  const carregar = async () => {
    setLoading(true);
    try {
      const sb = supabase as any;
      const ano_mes = anoMesAtual();

      const [
        { data: tenants, error: errT },
        { data: uso, error: errU },
        { data: configs, error: errC },
      ] = await Promise.all([
        sb.from("tenants").select("id, nome, slug, ativo, limite_pedidos_mes, dia_vencimento, valor_mensal, valor_setup, email_financeiro, created_at"),
        sb.from("tenant_uso").select("tenant_id, pedidos_processados").eq("ano_mes", ano_mes),
        sb.from("configuracoes").select("tenant_id, chave, valor").in("chave", ["valor_excedente", "excedente_cobrado_em", "mensalidade_paga_em"]),
      ]);
      if (errT) throw errT;
      if (errU) throw errU;
      if (errC) throw errC;

      const tenantsList = tenants ?? [];
      const usoList = uso ?? [];
      const configsList = configs ?? [];

      const valorExcMap = new Map<string, number>();
      const cobradoExcMap = new Map<string, string | null>();
      const pagoMensMap = new Map<string, string | null>();
      configsList.forEach((c: any) => {
        if (c.chave === "valor_excedente") valorExcMap.set(c.tenant_id, parseFloat(c.valor ?? "0") || 0);
        if (c.chave === "excedente_cobrado_em") cobradoExcMap.set(c.tenant_id, c.valor);
        if (c.chave === "mensalidade_paga_em") pagoMensMap.set(c.tenant_id, c.valor);
      });

      const ativos = tenantsList.filter((t: any) => t.ativo);
      setTenantsAtivos(ativos.length);
      setMrrTotal(ativos.reduce((s: number, t: any) => s + Number(t.valor_mensal ?? 0), 0));
      setSetupMes(
        tenantsList
          .filter((t: any) => t.created_at && t.created_at.startsWith(ano_mes))
          .reduce((s: number, t: any) => s + Number(t.valor_setup ?? 0), 0),
      );

      // Top 5 clientes por pedidos
      const tenantMap = new Map(tenantsList.map((t: any) => [t.id, t]));
      const top = usoList
        .map((u: any) => {
          const t: any = tenantMap.get(u.tenant_id);
          return t ? { id: t.id, nome: t.nome, slug: t.slug, pedidos: u.pedidos_processados ?? 0 } : null;
        })
        .filter(Boolean)
        .sort((a: any, b: any) => b.pedidos - a.pedidos)
        .slice(0, 5) as TenantTopo[];
      setTopTenants(top);

      // Excedentes
      const exc: Excedente[] = [];
      usoList.forEach((u: any) => {
        const t: any = tenantMap.get(u.tenant_id);
        if (!t) return;
        const limite = t.limite_pedidos_mes ?? 0;
        const pedidos = u.pedidos_processados ?? 0;
        if (limite > 0 && pedidos > limite) {
          const cob = cobradoExcMap.get(t.id);
          if (cob?.startsWith(ano_mes)) return;
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

      // Vencimentos (próx. 5 dias e vencidos) — exclui quem já pagou no mês
      const venc: Vencimento[] = [];
      ativos.forEach((t: any) => {
        const v = calcularStatusVencimento(t.dia_vencimento);
        if (v.tipo !== "a-vencer" && v.tipo !== "vence-hoje" && v.tipo !== "vencido") return;
        const pago = pagoMensMap.get(t.id);
        if (pago?.startsWith(ano_mes)) return;
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
      });
      venc.sort((a, b) => a.diasRestantes - b.diasRestantes);
      setVencimentos(venc);
    } catch (e: any) {
      toast.error("Erro ao carregar painel: " + (e?.message ?? e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregar();
  }, []);

  const marcarComoPago = async (tenantId: string, nome: string) => {
    setPagandoId(tenantId);
    try {
      const sb = supabase as any;
      const hojeIso = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

      // Verifica se já existe a config para este tenant
      const { data: existente, error: errSel } = await sb
        .from("configuracoes")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("chave", "mensalidade_paga_em")
        .maybeSingle();
      if (errSel) throw errSel;

      if (existente?.id) {
        const { error } = await sb
          .from("configuracoes")
          .update({ valor: hojeIso })
          .eq("id", existente.id);
        if (error) throw error;
      } else {
        const { error } = await sb
          .from("configuracoes")
          .insert({
            tenant_id: tenantId,
            chave: "mensalidade_paga_em",
            valor: hojeIso,
            descricao: "Data do último pagamento de mensalidade registrado pelo super admin",
          });
        if (error) throw error;
      }

      setVencimentos((prev) => prev.filter((v) => v.id !== tenantId));
      toast.success(`${nome} marcado como pago`);
    } catch (e: any) {
      toast.error("Erro ao registrar pagamento: " + (e?.message ?? e));
    } finally {
      setPagandoId(null);
    }
  };

  const inadimplentes = vencimentos.filter((v) => v.vencido);
  const aVencer = vencimentos.filter((v) => !v.vencido);
  const totalACobrarExc = excedentes.reduce((s, e) => s + e.valorACobrar, 0);

  const cardsFinanceiros = [
    { titulo: "Receita mensal (MRR)", valor: brl(mrrTotal), sub: `${num(tenantsAtivos)} clientes ativos`, icon: Repeat, cor: "text-success", bg: "bg-success-soft" },
    { titulo: "Setup do mês", valor: brl(setupMes), sub: "Novos clientes", icon: Receipt, cor: "text-primary", bg: "bg-primary-soft" },
    {
      titulo: "Inadimplentes",
      valor: num(inadimplentes.length),
      sub: "Vencimento já passou",
      icon: AlertTriangle,
      cor: "text-destructive",
      bg: "bg-destructive/10",
      destaque: inadimplentes.length > 0,
    },
    { titulo: "Excedentes a cobrar", valor: num(excedentes.length), sub: `Total ${brl(totalACobrarExc)}`, icon: Banknote, cor: "text-warning", bg: "bg-warning/15" },
    { titulo: "Mensalidades vencendo", valor: num(aVencer.length), sub: "Próximos 5 dias", icon: CalendarClock, cor: "text-warning", bg: "bg-warning/15" },
  ];

  return (
    <div className="mx-auto w-full max-w-[1400px] px-8 py-8">
      <div className="mb-7">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Painel Admin</h1>
        <p className="mt-1 text-sm text-muted-foreground">Visão geral financeira da plataforma Softeum.</p>
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : (
        <div className="space-y-8">
          {/* SEÇÃO 1 — Visão financeira */}
          <section>
            <div className="mb-4 flex items-end justify-between">
              <div>
                <h2 className="text-base font-semibold text-foreground">Visão financeira</h2>
                <p className="text-xs text-muted-foreground">Indicadores principais do mês corrente</p>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
              {cardsFinanceiros.map((c) => {
                const Icon = c.icon;
                return (
                  <div
                    key={c.titulo}
                    className={`rounded-xl border bg-card p-5 shadow-softeum-sm ${
                      c.destaque ? "border-destructive/40 ring-1 ring-destructive/20" : "border-border"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{c.titulo}</span>
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
          </section>

          {/* SEÇÃO 2 — Inadimplentes */}
          <section>
            <div className="rounded-xl border border-border bg-card shadow-softeum-sm">
              <div className="flex items-center justify-between border-b border-border px-6 py-4">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
                    <AlertTriangle className="h-4 w-4" />
                  </span>
                  <div>
                    <h2 className="text-base font-semibold text-foreground">Clientes com mensalidade vencida</h2>
                    <p className="text-xs text-muted-foreground">Pagamentos em atraso no mês corrente</p>
                  </div>
                </div>
                {inadimplentes.length > 0 && (
                  <span className="inline-flex items-center rounded-full bg-destructive/15 px-2.5 py-0.5 text-xs font-semibold text-destructive">
                    {num(inadimplentes.length)} {inadimplentes.length === 1 ? "inadimplente" : "inadimplentes"}
                  </span>
                )}
              </div>
              {inadimplentes.length === 0 ? (
                <div className="px-6 py-12 text-center text-sm text-muted-foreground">Nenhum cliente em atraso. ✅</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                      <tr>
                        <th className="px-5 py-2.5 text-left font-medium">Cliente</th>
                        <th className="px-5 py-2.5 text-right font-medium">Valor mensal</th>
                        <th className="px-5 py-2.5 text-center font-medium">Dia de vencimento</th>
                        <th className="px-5 py-2.5 text-center font-medium">Dias em atraso</th>
                        <th className="px-5 py-2.5 text-right font-medium">Ações</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {inadimplentes.map((v) => (
                        <tr key={v.id} className="hover:bg-muted/30">
                          <td className="px-5 py-3">
                            <p className="font-medium text-foreground">{v.nome}</p>
                            <p className="text-xs text-muted-foreground">{v.slug}</p>
                          </td>
                          <td className="px-5 py-3 text-right tabular-nums font-medium text-foreground">
                            {v.valorMensal != null ? brl(v.valorMensal) : <span className="text-muted-foreground">—</span>}
                          </td>
                          <td className="px-5 py-3 text-center tabular-nums text-foreground">dia {v.diaVencimento}</td>
                          <td className="px-5 py-3 text-center">
                            <span className="inline-flex items-center gap-1 rounded-full bg-destructive/15 px-2 py-0.5 text-xs font-semibold text-destructive">
                              {Math.abs(v.diasRestantes)} {Math.abs(v.diasRestantes) === 1 ? "dia" : "dias"}
                            </span>
                          </td>
                          <td className="px-5 py-3">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                onClick={() => marcarComoPago(v.id, v.nome)}
                                disabled={pagandoId === v.id}
                                className="inline-flex items-center gap-1.5 rounded-md border border-success/40 bg-success-soft px-2.5 py-1.5 text-xs font-medium text-success transition-colors hover:bg-success/20 disabled:opacity-60"
                              >
                                {pagandoId === v.id ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                )}
                                Marcar como pago
                              </button>
                              <Link
                                to={`/admin/tenants/${v.id}`}
                                className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
                              >
                                Ver <ArrowRight className="h-3 w-3" />
                              </Link>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>

          {/* Mensalidades a vencer (próximos 5 dias) */}
          <section>
            <div className="rounded-xl border border-border bg-card shadow-softeum-sm">
              <div className="flex items-center justify-between border-b border-border px-6 py-4">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-warning/15 text-warning">
                    <CalendarClock className="h-4 w-4" />
                  </span>
                  <div>
                    <h2 className="text-base font-semibold text-foreground">Mensalidades a vencer</h2>
                    <p className="text-xs text-muted-foreground">Próximos 5 dias</p>
                  </div>
                </div>
                {aVencer.length > 0 && (
                  <span className="text-xs text-muted-foreground">
                    Total: <span className="font-semibold text-foreground">{brl(aVencer.reduce((s, v) => s + (v.valorMensal ?? 0), 0))}</span>
                  </span>
                )}
              </div>
              {aVencer.length === 0 ? (
                <div className="px-6 py-12 text-center text-sm text-muted-foreground">Nenhuma mensalidade próxima do vencimento.</div>
              ) : (
                <ul className="divide-y divide-border">
                  {aVencer.map((v) => (
                    <li key={v.id}>
                      <Link to={`/admin/tenants/${v.id}`} className="flex items-center justify-between px-6 py-3 transition-colors hover:bg-muted/40">
                        <div className="flex items-center gap-3">
                          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-warning/15 text-xs font-semibold text-warning">
                            {v.diaVencimento}
                          </span>
                          <div>
                            <p className="text-sm font-medium text-foreground">{v.nome}</p>
                            <p className="text-xs text-muted-foreground">
                              {v.diasRestantes === 0 ? "Vence hoje" : `Vence em ${v.diasRestantes} ${v.diasRestantes === 1 ? "dia" : "dias"}`} · dia {v.diaVencimento}
                            </p>
                          </div>
                        </div>
                        <span className="text-sm font-semibold text-foreground">
                          {v.valorMensal != null ? brl(v.valorMensal) : "—"}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          {/* Excedentes a cobrar */}
          <section>
            <div className="rounded-xl border border-border bg-card shadow-softeum-sm">
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
                    <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Total a cobrar</p>
                    <p className="text-lg font-bold text-destructive">{brl(totalACobrarExc)}</p>
                  </div>
                )}
              </div>
              {excedentes.length === 0 ? (
                <div className="px-6 py-12 text-center text-sm text-muted-foreground">Nenhum excedente pendente este mês. 🎉</div>
              ) : (
                <div className="overflow-x-auto">
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
                </div>
              )}
            </div>
          </section>

          {/* Top clientes do mês */}
          <section>
            <div className="rounded-xl border border-border bg-card shadow-softeum-sm">
              <div className="flex items-center justify-between border-b border-border px-6 py-4">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-soft text-primary">
                    <TrendingUp className="h-4 w-4" />
                  </span>
                  <div>
                    <h2 className="text-base font-semibold text-foreground">Top clientes do mês</h2>
                    <p className="text-xs text-muted-foreground">Por volume de pedidos processados</p>
                  </div>
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
                        <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-foreground">
                          <FileText className="h-3.5 w-3.5 text-muted-foreground" /> {num(t.pedidos)} pedidos
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          {/* Bloco compacto: total de clientes ativos (rodapé visual) */}
          <section className="flex items-center justify-center pb-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-muted/30 px-4 py-1.5 text-xs text-muted-foreground">
              <Building2 className="h-3.5 w-3.5" />
              <span>{num(tenantsAtivos)} clientes ativos · MRR {brl(mrrTotal)} · Setup do mês {brl(setupMes)}</span>
              <Wallet className="h-3.5 w-3.5" />
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
