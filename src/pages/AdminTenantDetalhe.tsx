import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Building2, Users, FileText, DollarSign, AlertTriangle, Loader2, Mail, Shield, User as UserIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Tenant {
  id: string;
  nome: string;
  slug: string;
  ativo: boolean;
  limite_pedidos_mes: number | null;
  notas: string | null;
  created_at: string | null;
}

interface UsoMes {
  ano_mes: string;
  pedidos_processados: number;
  total_previsto_processado: number;
  erros_ia: number;
}

interface Membro {
  id: string;
  nome: string | null;
  papel: "admin" | "operador";
  ativo: boolean;
  user_id: string;
}

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const num = (v: number) => v.toLocaleString("pt-BR");
const dataFmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR") : "-");
const formatAnoMes = (am: string) => {
  const [a, m] = am.split("-");
  const meses = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  return `${meses[parseInt(m, 10) - 1]}/${a}`;
};

export default function AdminTenantDetalhe() {
  const { id } = useParams<{ id: string }>();
  const [loading, setLoading] = useState(true);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [uso, setUso] = useState<UsoMes[]>([]);
  const [membros, setMembros] = useState<Membro[]>([]);

  useEffect(() => {
    if (!id) return;
    const load = async () => {
      setLoading(true);
      try {
        const sb = supabase as any;
        const [{ data: t, error: e1 }, { data: u, error: e2 }, { data: m, error: e3 }] = await Promise.all([
          sb.from("tenants").select("id, nome, slug, ativo, limite_pedidos_mes, notas, created_at").eq("id", id).maybeSingle(),
          sb.from("tenant_uso").select("ano_mes, pedidos_processados, total_previsto_processado, erros_ia").eq("tenant_id", id).order("ano_mes", { ascending: false }).limit(12),
          sb.from("tenant_membros").select("id, nome, papel, ativo, user_id").eq("tenant_id", id).order("papel"),
        ]);
        if (e1) throw e1;
        if (e2) throw e2;
        if (e3) throw e3;
        setTenant(t);
        setUso(u ?? []);
        setMembros(m ?? []);
      } catch (e: any) {
        toast.error("Erro ao carregar tenant: " + (e?.message ?? e));
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [id]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!tenant) {
    return (
      <div className="mx-auto w-full max-w-[1400px] px-8 py-8">
        <Link to="/admin/tenants" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Voltar
        </Link>
        <div className="mt-6 rounded-xl border border-dashed border-border bg-card p-12 text-center">
          <p className="text-sm font-medium text-foreground">Cliente não encontrado.</p>
        </div>
      </div>
    );
  }

  const usoAtual = uso[0];
  const limite = tenant.limite_pedidos_mes ?? 0;
  const pedidosMes = usoAtual?.pedidos_processados ?? 0;
  const valorMes = Number(usoAtual?.total_previsto_processado ?? 0);
  const errosMes = usoAtual?.erros_ia ?? 0;
  const pct = limite > 0 ? Math.min(100, Math.round((pedidosMes / limite) * 100)) : 0;

  return (
    <div className="mx-auto w-full max-w-[1400px] px-8 py-8">
      <Link to="/admin/tenants" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Voltar para clientes
      </Link>

      <div className="mb-7 flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary-soft text-primary">
            <Building2 className="h-5 w-5" />
          </span>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight text-foreground">{tenant.nome}</h1>
              {tenant.ativo ? (
                <span className="inline-flex items-center rounded-full bg-success-soft px-2.5 py-0.5 text-xs font-medium text-success">Ativo</span>
              ) : (
                <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">Inativo</span>
              )}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">slug: <span className="font-mono">{tenant.slug}</span> · cadastrado em {dataFmt(tenant.created_at)}</p>
          </div>
        </div>
      </div>

      {/* Métricas do mês */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card titulo="Pedidos no mês" valor={num(pedidosMes)} sub={limite > 0 ? `de ${num(limite)} permitidos` : "Sem limite definido"} icon={FileText} cor="text-primary" bg="bg-primary-soft" />
        <Card titulo="Volume processado" valor={brl(valorMes)} sub="Soma do mês atual" icon={DollarSign} cor="text-success" bg="bg-success-soft" />
        <Card titulo="Erros de IA" valor={num(errosMes)} sub="Pedidos com falha" icon={AlertTriangle} cor="text-destructive" bg="bg-destructive/10" />
        <Card titulo="Membros" valor={num(membros.filter((m) => m.ativo).length)} sub={`${num(membros.length)} no total`} icon={Users} cor="text-info" bg="bg-info/10" />
      </div>

      {limite > 0 && (
        <div className="mt-4 rounded-xl border border-border bg-card p-5 shadow-softeum-sm">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="font-medium text-foreground">Uso do plano</span>
            <span className="tabular-nums text-muted-foreground">{num(pedidosMes)} / {num(limite)} ({pct}%)</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div className={`h-full ${pct >= 90 ? "bg-destructive" : pct >= 70 ? "bg-warning" : "bg-success"}`} style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Histórico de uso */}
        <div className="rounded-xl border border-border bg-card shadow-softeum-sm">
          <div className="border-b border-border px-6 py-4">
            <h2 className="text-base font-semibold text-foreground">Histórico de uso</h2>
            <p className="text-xs text-muted-foreground">Últimos 12 meses</p>
          </div>
          {uso.length === 0 ? (
            <div className="px-6 py-12 text-center text-sm text-muted-foreground">Sem histórico de uso.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-5 py-2.5 text-left font-medium">Mês</th>
                  <th className="px-5 py-2.5 text-right font-medium">Pedidos</th>
                  <th className="px-5 py-2.5 text-right font-medium">Volume</th>
                  <th className="px-5 py-2.5 text-right font-medium">Erros</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {uso.map((u) => (
                  <tr key={u.ano_mes} className="hover:bg-muted/30">
                    <td className="px-5 py-2.5 capitalize text-foreground">{formatAnoMes(u.ano_mes)}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums text-foreground">{num(u.pedidos_processados ?? 0)}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums text-muted-foreground">{brl(Number(u.total_previsto_processado ?? 0))}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums text-muted-foreground">{num(u.erros_ia ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Membros */}
        <div className="rounded-xl border border-border bg-card shadow-softeum-sm">
          <div className="border-b border-border px-6 py-4">
            <h2 className="text-base font-semibold text-foreground">Membros</h2>
            <p className="text-xs text-muted-foreground">{num(membros.length)} usuário(s) vinculado(s)</p>
          </div>
          {membros.length === 0 ? (
            <div className="px-6 py-12 text-center text-sm text-muted-foreground">Nenhum membro cadastrado.</div>
          ) : (
            <ul className="divide-y divide-border">
              {membros.map((m) => (
                <li key={m.id} className="flex items-center justify-between px-6 py-3.5">
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-muted-foreground">
                      <UserIcon className="h-4 w-4" />
                    </span>
                    <div>
                      <p className="text-sm font-medium text-foreground">{m.nome ?? "Sem nome"}</p>
                      <p className="text-xs text-muted-foreground font-mono">{m.user_id.slice(0, 8)}…</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {m.papel === "admin" ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-primary-soft px-2.5 py-0.5 text-xs font-medium text-primary">
                        <Shield className="h-3 w-3" /> Admin
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">Operador</span>
                    )}
                    {!m.ativo && (
                      <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">Inativo</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {tenant.notas && (
        <div className="mt-6 rounded-xl border border-border bg-card p-5 shadow-softeum-sm">
          <div className="mb-2 flex items-center gap-2">
            <Mail className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground">Notas internas</h3>
          </div>
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">{tenant.notas}</p>
        </div>
      )}
    </div>
  );
}

function Card({ titulo, valor, sub, icon: Icon, cor, bg }: { titulo: string; valor: string; sub: string; icon: any; cor: string; bg: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-softeum-sm">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{titulo}</span>
        <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${bg}`}>
          <Icon className={`h-4 w-4 ${cor}`} />
        </span>
      </div>
      <p className="mt-3 text-2xl font-bold text-foreground">{valor}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>
    </div>
  );
}
