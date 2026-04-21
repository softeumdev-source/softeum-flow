import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Search, Building2, Eye, Loader2, X, Plus, Lock, Unlock } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { NovoClienteDialog } from "@/components/admin/NovoClienteDialog";

interface TenantRow {
  id: string;
  nome: string;
  slug: string;
  ativo: boolean;
  limite_pedidos_mes: number | null;
  created_at: string | null;
  bloqueado_em: string | null;
  motivo_bloqueio: string | null;
  membros: number;
  pedidos_mes: number;
  excedente_cobrado_em: string | null;
}

const num = (v: number) => v.toLocaleString("pt-BR");
const dataFmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR") : "-");
const anoMesAtual = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

export default function AdminTenants() {
  const [rows, setRows] = useState<TenantRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState("");
  const [statusFiltro, setStatusFiltro] = useState<string>("todos");
  const [openNovo, setOpenNovo] = useState(false);
  const [bloqueioTarget, setBloqueioTarget] = useState<TenantRow | null>(null);
  const [desbloqueioTarget, setDesbloqueioTarget] = useState<TenantRow | null>(null);
  const [motivo, setMotivo] = useState("");
  const [salvandoBloqueio, setSalvandoBloqueio] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const sb = supabase as any;
      const ano_mes = anoMesAtual();

      const [{ data: tenants, error: errT }, { data: membros, error: errM }, { data: uso, error: errU }, { data: configs, error: errC }] = await Promise.all([
        sb.from("tenants").select("id, nome, slug, ativo, limite_pedidos_mes, created_at, bloqueado_em, motivo_bloqueio").order("created_at", { ascending: false }),
        sb.from("tenant_membros").select("tenant_id").eq("ativo", true),
        sb.from("tenant_uso").select("tenant_id, pedidos_processados").eq("ano_mes", ano_mes),
        sb.from("configuracoes").select("tenant_id, chave, valor").eq("chave", "excedente_cobrado_em"),
      ]);

      if (errT) throw errT;
      if (errM) throw errM;
      if (errU) throw errU;
      if (errC) throw errC;

      const membrosCount = new Map<string, number>();
      (membros ?? []).forEach((m: any) => {
        membrosCount.set(m.tenant_id, (membrosCount.get(m.tenant_id) ?? 0) + 1);
      });
      const usoMap = new Map<string, number>();
      (uso ?? []).forEach((u: any) => usoMap.set(u.tenant_id, u.pedidos_processados ?? 0));
      const cobradoMap = new Map<string, string | null>();
      (configs ?? []).forEach((c: any) => cobradoMap.set(c.tenant_id, c.valor));

      setRows(
        (tenants ?? []).map((t: any) => ({
          ...t,
          membros: membrosCount.get(t.id) ?? 0,
          pedidos_mes: usoMap.get(t.id) ?? 0,
          excedente_cobrado_em: cobradoMap.get(t.id) ?? null,
        })),
      );
    } catch (e: any) {
      toast.error("Erro ao carregar clientes: " + (e?.message ?? e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const filtrados = useMemo(() => {
    return rows.filter((r) => {
      if (statusFiltro === "ativos" && (!r.ativo || r.bloqueado_em)) return false;
      if (statusFiltro === "inativos" && r.ativo) return false;
      if (statusFiltro === "bloqueados" && !r.bloqueado_em) return false;
      if (busca) {
        const b = busca.toLowerCase();
        if (!r.nome.toLowerCase().includes(b) && !r.slug.toLowerCase().includes(b)) return false;
      }
      return true;
    });
  }, [rows, busca, statusFiltro]);

  const abrirBloqueio = (r: TenantRow) => {
    setMotivo("");
    setBloqueioTarget(r);
  };

  const confirmarBloqueio = async () => {
    if (!bloqueioTarget) return;
    if (!motivo.trim()) {
      toast.error("Informe o motivo do bloqueio");
      return;
    }
    setSalvandoBloqueio(true);
    try {
      const sb = supabase as any;
      const { error } = await sb
        .from("tenants")
        .update({ bloqueado_em: new Date().toISOString(), motivo_bloqueio: motivo.trim() })
        .eq("id", bloqueioTarget.id);
      if (error) throw error;
      toast.success(`${bloqueioTarget.nome} foi bloqueado`);
      setBloqueioTarget(null);
      await load();
    } catch (e: any) {
      toast.error("Erro ao bloquear: " + (e?.message ?? e));
    } finally {
      setSalvandoBloqueio(false);
    }
  };

  const confirmarDesbloqueio = async () => {
    if (!desbloqueioTarget) return;
    setSalvandoBloqueio(true);
    try {
      const sb = supabase as any;
      const { error } = await sb
        .from("tenants")
        .update({ bloqueado_em: null, motivo_bloqueio: null })
        .eq("id", desbloqueioTarget.id);
      if (error) throw error;
      toast.success(`${desbloqueioTarget.nome} foi desbloqueado`);
      setDesbloqueioTarget(null);
      await load();
    } catch (e: any) {
      toast.error("Erro ao desbloquear: " + (e?.message ?? e));
    } finally {
      setSalvandoBloqueio(false);
    }
  };

  const limparFiltros = () => {
    setBusca("");
    setStatusFiltro("todos");
  };
  const temFiltros = busca !== "" || statusFiltro !== "todos";

  const mesCorrente = anoMesAtual();

  return (
    <div className="mx-auto w-full max-w-[1400px] px-8 py-8">
      <div className="mb-7 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Clientes</h1>
          <p className="mt-1 text-sm text-muted-foreground">Tenants cadastrados na plataforma.</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">{num(filtrados.length)} de {num(rows.length)}</span>
          <Button onClick={() => setOpenNovo(true)} size="sm" className="gap-1.5">
            <Plus className="h-4 w-4" /> Novo cliente
          </Button>
        </div>
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
            <SelectItem value="bloqueados">Apenas bloqueados</SelectItem>
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
                <th className="px-5 py-3 text-left font-medium">Uso do mês</th>
                <th className="px-5 py-3 text-left font-medium">Cadastro</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtrados.map((r) => {
                const limite = r.limite_pedidos_mes ?? 0;
                const pct = limite > 0 ? Math.min(100, Math.round((r.pedidos_mes / limite) * 100)) : 0;
                const excedeu = limite > 0 && r.pedidos_mes > limite;
                const qtdExcedente = excedeu ? r.pedidos_mes - limite : 0;
                const cobradoEsteMes = r.excedente_cobrado_em?.startsWith(mesCorrente) ?? false;
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
                      {r.bloqueado_em ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-destructive/15 px-2.5 py-0.5 text-xs font-semibold text-destructive">
                          <Lock className="h-3 w-3" /> Bloqueado
                        </span>
                      ) : r.ativo ? (
                        <span className="inline-flex items-center rounded-full bg-success-soft px-2.5 py-0.5 text-xs font-medium text-success">Ativo</span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">Inativo</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-right tabular-nums text-foreground">{num(r.membros)}</td>
                    <td className="px-5 py-3.5">
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center gap-2">
                          <span className="tabular-nums font-medium text-foreground">
                            {num(r.pedidos_mes)}/{limite > 0 ? num(limite) : "∞"}
                          </span>
                          {excedeu && !cobradoEsteMes && (
                            <span className="inline-flex items-center rounded-full bg-destructive/15 px-2 py-0.5 text-xs font-semibold text-destructive">
                              +{num(qtdExcedente)} excedente
                            </span>
                          )}
                          {excedeu && cobradoEsteMes && (
                            <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                              cobrado
                            </span>
                          )}
                        </div>
                        {limite > 0 && (
                          <span className="h-1 w-32 overflow-hidden rounded-full bg-muted">
                            <span
                              className={`block h-full ${pct >= 100 ? "bg-destructive" : pct >= 80 ? "bg-warning" : "bg-success"}`}
                              style={{ width: `${pct}%` }}
                            />
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-muted-foreground">{dataFmt(r.created_at)}</td>
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

      <NovoClienteDialog open={openNovo} onOpenChange={setOpenNovo} onCreated={load} />

      {/* Modal: bloquear */}
      <AlertDialog open={!!bloqueioTarget} onOpenChange={(o) => !o && setBloqueioTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Bloquear cliente</AlertDialogTitle>
            <AlertDialogDescription>
              Ao bloquear <strong className="text-foreground">{bloqueioTarget?.nome}</strong>, todos os usuários
              desta empresa não conseguirão mais acessar o sistema. O super admin continuará tendo acesso ao painel.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="motivo-bloqueio">Motivo do bloqueio</Label>
            <Textarea
              id="motivo-bloqueio"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ex: Inadimplência — fatura de set/2025 em aberto"
              rows={3}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={salvandoBloqueio}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                confirmarBloqueio();
              }}
              disabled={salvandoBloqueio || !motivo.trim()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {salvandoBloqueio && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
              Bloquear
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Modal: desbloquear */}
      <AlertDialog open={!!desbloqueioTarget} onOpenChange={(o) => !o && setDesbloqueioTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desbloquear cliente</AlertDialogTitle>
            <AlertDialogDescription>
              Liberar o acesso de <strong className="text-foreground">{desbloqueioTarget?.nome}</strong> ao sistema?
              Os usuários poderão entrar normalmente novamente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={salvandoBloqueio}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                confirmarDesbloqueio();
              }}
              disabled={salvandoBloqueio}
            >
              {salvandoBloqueio && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
              Desbloquear
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
