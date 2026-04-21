import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Search, Building2, Eye, Loader2, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface TenantRow {
  id: string;
  nome: string;
  slug: string;
  ativo: boolean;
  limite_pedidos_mes: number | null;
  created_at: string | null;
  membros: number;
  pedidos_mes: number;
}

const num = (v: number) => v.toLocaleString("pt-BR");
const data = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR") : "-");
const mesAnoAtual = () => {
  const d = new Date();
  return { mes: d.getMonth() + 1, ano: d.getFullYear() };
};

export default function AdminTenants() {
  const [rows, setRows] = useState<TenantRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState("");
  const [statusFiltro, setStatusFiltro] = useState<string>("todos");

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const sb = supabase as any;
        const { mes, ano } = mesAnoAtual();

        const [{ data: tenants, error: errT }, { data: membros, error: errM }, { data: uso, error: errU }] = await Promise.all([
          sb.from("tenants").select("id, nome, slug, ativo, limite_pedidos_mes, created_at").order("created_at", { ascending: false }),
          sb.from("tenant_membros").select("tenant_id").eq("ativo", true),
          sb.from("tenant_uso").select("tenant_id, total_pedidos").eq("mes", mes).eq("ano", ano),
        ]);

        if (errT) throw errT;
        if (errM) throw errM;
        if (errU) throw errU;

        const membrosCount = new Map<string, number>();
        (membros ?? []).forEach((m: any) => {
          membrosCount.set(m.tenant_id, (membrosCount.get(m.tenant_id) ?? 0) + 1);
        });
        const usoMap = new Map<string, number>();
        (uso ?? []).forEach((u: any) => usoMap.set(u.tenant_id, u.total_pedidos ?? 0));

        setRows(
          (tenants ?? []).map((t: any) => ({
            ...t,
            membros: membrosCount.get(t.id) ?? 0,
            pedidos_mes: usoMap.get(t.id) ?? 0,
          })),
        );
      } catch (e: any) {
        toast.error("Erro ao carregar clientes: " + (e?.message ?? e));
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const filtrados = useMemo(() => {
    return rows.filter((r) => {
      if (statusFiltro === "ativos" && !r.ativo) return false;
      if (statusFiltro === "inativos" && r.ativo) return false;
      if (busca) {
        const b = busca.toLowerCase();
        if (!r.nome.toLowerCase().includes(b) && !r.slug.toLowerCase().includes(b)) return false;
      }
      return true;
    });
  }, [rows, busca, statusFiltro]);

  const limparFiltros = () => {
    setBusca("");
    setStatusFiltro("todos");
  };
  const temFiltros = busca !== "" || statusFiltro !== "todos";

  return (
    <div className="mx-auto w-full max-w-[1400px] px-8 py-8">
      <div className="mb-7 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Clientes</h1>
          <p className="mt-1 text-sm text-muted-foreground">Tenants cadastrados na plataforma.</p>
        </div>
        <span className="text-sm text-muted-foreground">{num(filtrados.length)} de {num(rows.length)}</span>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4 shadow-softeum-sm">
        <div className="relative min-w-[260px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome ou slug…" className="pl-9" />
        </div>
        <Select value={statusFiltro} onValueChange={setStatusFiltro}>
          <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os status</SelectItem>
            <SelectItem value="ativos">Apenas ativos</SelectItem>
            <SelectItem value="inativos">Apenas inativos</SelectItem>
          </SelectContent>
        </Select>
        {temFiltros && (
          <button onClick={limparFiltros} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <X className="h-3.5 w-3.5" /> Limpar
          </button>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-softeum-sm">
        {loading ? (
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : filtrados.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <Building2 className="mx-auto h-10 w-10 text-muted-foreground/60" />
            <p className="mt-3 text-sm font-medium text-foreground">Nenhum cliente encontrado</p>
            <p className="mt-1 text-xs text-muted-foreground">Ajuste os filtros e tente novamente.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-5 py-3 text-left font-medium">Cliente</th>
                <th className="px-5 py-3 text-left font-medium">Status</th>
                <th className="px-5 py-3 text-right font-medium">Membros</th>
                <th className="px-5 py-3 text-right font-medium">Pedidos no mês</th>
                <th className="px-5 py-3 text-right font-medium">Limite</th>
                <th className="px-5 py-3 text-left font-medium">Cadastro</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtrados.map((r) => {
                const limite = r.limite_pedidos_mes ?? 0;
                const pct = limite > 0 ? Math.min(100, Math.round((r.pedidos_mes / limite) * 100)) : 0;
                return (
                  <tr key={r.id} className="transition-colors hover:bg-muted/30">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-soft text-primary">
                          <Building2 className="h-4 w-4" />
                        </span>
                        <div>
                          <p className="font-medium text-foreground">{r.nome}</p>
                          <p className="text-xs text-muted-foreground">{r.slug}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      {r.ativo ? (
                        <span className="inline-flex items-center rounded-full bg-success-soft px-2.5 py-0.5 text-xs font-medium text-success">Ativo</span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">Inativo</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-right tabular-nums text-foreground">{num(r.membros)}</td>
                    <td className="px-5 py-3.5 text-right">
                      <div className="inline-flex flex-col items-end gap-1">
                        <span className="tabular-nums font-medium text-foreground">{num(r.pedidos_mes)}</span>
                        {limite > 0 && (
                          <span className="h-1 w-20 overflow-hidden rounded-full bg-muted">
                            <span className={`block h-full ${pct >= 90 ? "bg-destructive" : pct >= 70 ? "bg-warning" : "bg-success"}`} style={{ width: `${pct}%` }} />
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-right tabular-nums text-muted-foreground">{limite > 0 ? num(limite) : "-"}</td>
                    <td className="px-5 py-3.5 text-muted-foreground">{data(r.created_at)}</td>
                    <td className="px-5 py-3.5 text-right">
                      <Link to={`/admin/tenants/${r.id}`} className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted">
                        <Eye className="h-3.5 w-3.5" /> Ver
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
