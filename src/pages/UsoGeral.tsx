import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Loader2, AlertTriangle, CheckCircle2,
  ArrowRight, RefreshCw, Building2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface TenantUso {
  id: string;
  nome: string;
  slug: string;
  limite: number;
  pedidos: number;
  pct: number;
  excedeu: boolean;
  proxLimite: boolean;
}

const num = (v: number) => v.toLocaleString("pt-BR");
const anoMesAtual = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

export default function UsoGeral() {
  const [loading, setLoading] = useState(true);
  const [tenants, setTenants] = useState<TenantUso[]>([]);
  const [totalPedidos, setTotalPedidos] = useState(0);

  const mesCorrente = anoMesAtual();
  const ano = parseInt(mesCorrente.slice(0, 4));
  const mes = parseInt(mesCorrente.slice(5, 7));
  const inicioMes = `${mesCorrente}-01T00:00:00.000Z`;
  const proximoMes = mes === 12
    ? `${ano + 1}-01-01T00:00:00.000Z`
    : `${ano}-${String(mes + 1).padStart(2, "0")}-01T00:00:00.000Z`;

  const carregar = async () => {
    setLoading(true);
    try {
      const sb = supabase as any;
      const [
        { data: tenantsList, error: errT },
        { data: pedidosMes, error: errP },
      ] = await Promise.all([
        sb.from("tenants")
          .select("id, nome, slug, ativo, limite_pedidos_mes")
          .eq("ativo", true)
          .order("nome", { ascending: true }),
        sb.from("pedidos")
          .select("tenant_id")
          .gte("created_at", inicioMes)
          .lt("created_at", proximoMes),
      ]);

      if (errT) throw errT;
      if (errP) throw errP;

      const pedidosMap = new Map<string, number>();
      (pedidosMes ?? []).forEach((p: any) => {
        pedidosMap.set(p.tenant_id, (pedidosMap.get(p.tenant_id) ?? 0) + 1);
      });

      setTotalPedidos(pedidosMes?.length ?? 0);

      const lista: TenantUso[] = (tenantsList ?? []).map((t: any) => {
        const limite = t.limite_pedidos_mes ?? 0;
        const pedidos = pedidosMap.get(t.id) ?? 0;
        const pct = limite > 0 ? Math.round((pedidos / limite) * 100) : 0;
        return {
          id: t.id, nome: t.nome, slug: t.slug,
          limite, pedidos, pct,
          excedeu: limite > 0 && pedidos > limite,
          proxLimite: !(limite > 0 && pedidos > limite) && limite > 0 && pct >= 80,
        };
      });

      lista.sort((a, b) => {
        if (a.excedeu && !b.excedeu) return -1;
        if (!a.excedeu && b.excedeu) return 1;
        if (a.proxLimite && !b.proxLimite) return -1;
        if (!a.proxLimite && b.proxLimite) return 1;
        return b.pct - a.pct;
      });

      setTenants(lista);
    } catch (e: any) {
      toast.error("Erro ao carregar uso: " + (e?.message ?? e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { carregar(); }, []);

  const excedentes = tenants.filter(t => t.excedeu);
  const proxLimite = tenants.filter(t => t.proxLimite);
  const normais = tenants.filter(t => !t.excedeu && !t.proxLimite);

  return (
    <div className="mx-auto w-full max-w-[1400px] px-8 py-8">
      <div className="mb-7 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Uso geral</h1>
          <p className="mt-1 text-sm text-muted-foreground">Consumo de todos os clientes no mês corrente.</p>
        </div>
        <Button variant="outline" size="sm" onClick={carregar} disabled={loading} className="gap-1.5">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Atualizar
        </Button>
      </div>

      {/* Cards resumo */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-4">
        <div className="rounded-xl border border-border bg-card p-4 shadow-softeum-sm">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Clientes ativos</p>
          <p className="mt-2 text-2xl font-bold text-foreground">{num(tenants.length)}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 shadow-softeum-sm">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Total de pedidos</p>
          <p className="mt-2 text-2xl font-bold text-foreground">{num(totalPedidos)}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">no mês atual</p>
        </div>
        <div className={`rounded-xl border bg-card p-4 shadow-softeum-sm ${excedentes.length > 0 ? "border-destructive/40" : "border-border"}`}>
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Excederam o limite</p>
          <p className={`mt-2 text-2xl font-bold ${excedentes.length > 0 ? "text-destructive" : "text-foreground"}`}>{num(excedentes.length)}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">clientes</p>
        </div>
        <div className={`rounded-xl border bg-card p-4 shadow-softeum-sm ${proxLimite.length > 0 ? "border-warning/40" : "border-border"}`}>
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Próximos do limite</p>
          <p className={`mt-2 text-2xl font-bold ${proxLimite.length > 0 ? "text-warning" : "text-foreground"}`}>{num(proxLimite.length)}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">acima de 80%</p>
        </div>
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : (
        <div className="space-y-6">
          {excedentes.length > 0 && (
            <div className="rounded-xl border border-destructive/30 bg-card shadow-softeum-sm">
              <div className="flex items-center gap-3 border-b border-destructive/20 bg-destructive/5 px-6 py-4 rounded-t-xl">
                <AlertTriangle className="h-4 w-4 text-destructive" />
                <h2 className="text-sm font-semibold text-destructive">Excederam o limite ({excedentes.length})</h2>
              </div>
              <div className="divide-y divide-border">
                {excedentes.map(t => <TenantUsoRow key={t.id} t={t} />)}
              </div>
            </div>
          )}

          {proxLimite.length > 0 && (
            <div className="rounded-xl border border-warning/30 bg-card shadow-softeum-sm">
              <div className="flex items-center gap-3 border-b border-warning/20 bg-warning/5 px-6 py-4 rounded-t-xl">
                <AlertTriangle className="h-4 w-4 text-warning" />
                <h2 className="text-sm font-semibold text-warning">Próximos do limite — acima de 80% ({proxLimite.length})</h2>
              </div>
              <div className="divide-y divide-border">
                {proxLimite.map(t => <TenantUsoRow key={t.id} t={t} />)}
              </div>
            </div>
          )}

          <div className="rounded-xl border border-border bg-card shadow-softeum-sm">
            <div className="flex items-center gap-3 border-b border-border px-6 py-4">
              <CheckCircle2 className="h-4 w-4 text-success" />
              <h2 className="text-sm font-semibold text-foreground">Uso normal ({normais.length})</h2>
            </div>
            {normais.length === 0 ? (
              <div className="px-6 py-12 text-center text-sm text-muted-foreground">Nenhum cliente em uso normal.</div>
            ) : (
              <div className="divide-y divide-border">
                {normais.map(t => <TenantUsoRow key={t.id} t={t} />)}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function TenantUsoRow({ t }: { t: TenantUso }) {
  const pctBar = Math.min(100, t.pct);
  const corBarra = t.excedeu ? "bg-destructive" : t.proxLimite ? "bg-warning" : "bg-success";
  return (
    <div className="flex items-center gap-4 px-6 py-4 hover:bg-muted/30 transition-colors">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
        <Building2 className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-sm font-medium text-foreground truncate">{t.nome}</p>
          <div className="flex items-center gap-3 ml-4 shrink-0">
            <span className="tabular-nums text-sm text-foreground font-medium">
              {num(t.pedidos)} / {t.limite > 0 ? num(t.limite) : "∞"}
            </span>
            <span className={`text-xs font-semibold tabular-nums w-12 text-right ${t.excedeu ? "text-destructive" : t.proxLimite ? "text-warning" : "text-muted-foreground"}`}>
              {t.pct}%
            </span>
          </div>
        </div>
        {t.limite > 0 ? (
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div className={`h-full ${corBarra} transition-all`} style={{ width: `${pctBar}%` }} />
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Sem limite definido</p>
        )}
      </div>
      <Link to={`/admin/tenants/${t.id}`} className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
        Ver <ArrowRight className="h-3 w-3" />
      </Link>
    </div>
  );
}
