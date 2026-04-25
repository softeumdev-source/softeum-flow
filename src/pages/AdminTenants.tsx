import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Search, Building2, Eye, Loader2, X, Plus, Lock, Unlock,
  Clock, AlertTriangle, Trash2, Wifi, WifiOff, RefreshCw,
} from "lucide-react";
import { calcularStatusVencimento } from "@/lib/vencimento";
import { ExcluirTenantDialog } from "@/components/admin/ExcluirTenantDialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
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
  valor_mensal: number | null;
  valor_excedente: number | null;
  created_at: string | null;
  bloqueado_em: string | null;
  motivo_bloqueio: string | null;
  dia_vencimento: number | null;
  membros: number;
  pedidos_mes: number;
  valor_mes: number;
  excedente_cobrado_em: string | null;
  mensalidade_paga_em: string | null;
  gmail_ativo: boolean;
  gmail_email: string | null;
}

const num = (v: number) => v.toLocaleString("pt-BR");
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
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
  const [pagamentoFiltro, setPagamentoFiltro] = useState<string>("todos");
  const [openNovo, setOpenNovo] = useState(false);
  const [bloqueioTarget, setBloqueioTarget] = useState<TenantRow | null>(null);
  const [desbloqueioTarget, setDesbloqueioTarget] = useState<TenantRow | null>(null);
  const [exclusaoTarget, setExclusaoTarget] = useState<TenantRow | null>(null);
  const [motivo, setMotivo] = useState("");
  const [salvandoBloqueio, setSalvandoBloqueio] = useState(false);

  const mesCorrente = anoMesAtual();
  const ano = parseInt(mesCorrente.slice(0, 4));
  const mes = parseInt(mesCorrente.slice(5, 7));
  const inicioMes = `${mesCorrente}-01T00:00:00.000Z`;
  const proximoMes = mes === 12
    ? `${ano + 1}-01-01T00:00:00.000Z`
    : `${ano}-${String(mes + 1).padStart(2, "0")}-01T00:00:00.000Z`;

  const load = async () => {
    setLoading(true);
    try {
      const sb = supabase as any;

      const [
        { data: tenants, error: errT },
        { data: membros, error: errM },
        { data: configs, error: errC },
        { data: gmails },
        { data: pedidosMes },
      ] = await Promise.all([
        sb.from("tenants")
          .select("id, nome, slug, ativo, limite_pedidos_mes, valor_mensal, valor_excedente, created_at, bloqueado_em, motivo_bloqueio, dia_vencimento")
          .order("created_at", { ascending: false }),
        sb.from("tenant_membros").select("tenant_id").eq("ativo", true),
        sb.from("configuracoes")
          .select("tenant_id, chave, valor")
          .in("chave", ["excedente_cobrado_em", "mensalidade_paga_em"]),
        sb.from("tenant_gmail_config").select("tenant_id, email, ativo"),
        sb.from("pedidos")
          .select("tenant_id, valor_total")
          .gte("created_at", inicioMes)
          .lt("created_at", proximoMes),
      ]);

      if (errT) throw errT;
      if (errM) throw errM;
      if (errC) throw errC;

      // Membros por tenant
      const membrosCount = new Map<string, number>();
      (membros ?? []).forEach((m: any) => {
        membrosCount.set(m.tenant_id, (membrosCount.get(m.tenant_id) ?? 0) + 1);
      });

      // Pedidos do mês por tenant
      const pedidosMap = new Map<string, { count: number; valor: number }>();
      (pedidosMes ?? []).forEach((p: any) => {
        const cur = pedidosMap.get(p.tenant_id) ?? { count: 0, valor: 0 };
        cur.count += 1;
        cur.valor += Number(p.valor_total ?? 0);
        pedidosMap.set(p.tenant_id, cur);
      });

      // Configs
      const cobradoMap = new Map<string, string | null>();
      const pagoMap = new Map<string, string | null>();
      (configs ?? []).forEach((c: any) => {
        if (c.chave === "excedente_cobrado_em") cobradoMap.set(c.tenant_id, c.valor);
        if (c.chave === "mensalidade_paga_em") pagoMap.set(c.tenant_id, c.valor);
      });

      // Gmail por tenant
      const gmailMap = new Map<string, { email: string; ativo: boolean }>();
      (gmails ?? []).forEach((g: any) => {
        gmailMap.set(g.tenant_id, { email: g.email, ativo: g.ativo });
      });

      setRows(
        (tenants ?? []).map((t: any) => {
          const pedidos = pedidosMap.get(t.id) ?? { count: 0, valor: 0 };
          const gmail = gmailMap.get(t.id);
          return {
            ...t,
            membros: membrosCount.get(t.id) ?? 0,
            pedidos_mes: pedidos.count,
            valor_mes: pedidos.valor,
            excedente_cobrado_em: cobradoMap.get(t.id) ?? null,
            mensalidade_paga_em: pagoMap.get(t.id) ?? null,
            gmail_ativo: gmail?.ativo ?? false,
            gmail_email: gmail?.email ?? null,
          };
        }),
      );
    } catch (e: any) {
      toast.error("Erro ao carregar clientes: " + (e?.message ?? e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const filtrados = useMemo(() => {
    return rows.filter((r) => {
      if (statusFiltro === "ativos" && (!r.ativo || r.bloqueado_em)) return false;
      if (statusFiltro === "inativos" && r.ativo) return false;
      if (statusFiltro === "bloqueados" && !r.bloqueado_em) return false;
      if (pagamentoFiltro === "pagos" && !r.mensalidade_paga_em?.startsWith(mesCorrente)) return false;
      if (pagamentoFiltro === "vencidos") {
        const v = calcularStatusVencimento(r.dia_vencimento);
        if (v.tipo !== "vencido") return false;
      }
      if (pagamentoFiltro === "excedente") {
        const limite = r.limite_pedidos_mes ?? 0;
        if (!(limite > 0 && r.pedidos_mes > limite)) return false;
      }
      if (busca) {
        const b = busca.toLowerCase();
        if (!r.nome.toLowerCase().includes(b) && !r.slug.toLowerCase().includes(b)) return false;
      }
      return true;
    });
  }, [rows, busca, statusFiltro, pagamentoFiltro, mesCorrente]);

  // Totais
  const totalMRR = rows.filter(r => r.ativo && !r.bloqueado_em).reduce((acc, r) => acc + Number(r.valor_mensal ?? 0), 0);
  const totalExcedentes = rows.filter(r => {
    const limite = r.limite_pedidos_mes ?? 0;
    return limite > 0 && r.pedidos_mes > limite && !r.excedente_cobrado_em?.startsWith(mesCorrente);
  }).length;
  const totalInadimplentes = rows.filter(r => {
    if (r.mensalidade_paga_em?.startsWith(mesCorrente)) return false;
    const v = calcularStatusVencimento(r.dia_vencimento);
    return v.tipo === "vencido";
  }).length;

  const abrirBloqueio = (r: TenantRow) => { setMotivo(""); setBloqueioTarget(r); };

  const confirmarBloqueio = async () => {
    if (!bloqueioTarget || !motivo.trim()) { toast.error("Informe o motivo do bloqueio"); return; }
    setSalvandoBloqueio(true);
    try {
      const sb = supabase as any;
      const { error } = await sb.from("tenants")
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
      const { error } = await sb.from("tenants")
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

  const limparFiltros = () => { setBusca(""); setStatusFiltro("todos"); setPagamentoFiltro("todos"); };
  const temFiltros = busca !== "" || statusFiltro !== "todos" || pagamentoFiltro !== "todos";

  return (
    <div className="mx-auto w-full max-w-[1400px] px-8 py-8">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Clientes</h1>
          <p className="mt-1 text-sm text-muted-foreground">Tenants cadastrados na plataforma.</p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-1.5">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
          <span className="text-sm text-muted-foreground">{num(filtrados.length)} de {num(rows.length)}</span>
          <Button onClick={() => setOpenNovo(true)} size="sm" className="gap-1.5">
            <Plus className="h-4 w-4" /> Novo cliente
          </Button>
        </div>
      </div>

      {/* Cards de resumo */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-4 shadow-softeum-sm">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">MRR do mês</p>
          <p className="mt-2 text-2xl font-bold text-foreground">{brl(totalMRR)}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{rows.filter(r => r.ativo && !r.bloqueado_em).length} clientes ativos</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 shadow-softeum-sm">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Excedentes a cobrar</p>
          <p className={`mt-2 text-2xl font-bold ${totalExcedentes > 0 ? "text-destructive" : "text-foreground"}`}>{num(totalExcedentes)}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">Clientes que ultrapassaram o limite</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 shadow-softeum-sm">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Inadimplentes</p>
          <p className={`mt-2 text-2xl font-bold ${totalInadimplentes > 0 ? "text-destructive" : "text-foreground"}`}>{num(totalInadimplentes)}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">Vencimento já passou</p>
        </div>
      </div>

      {/* Filtros */}
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4 shadow-softeum-sm">
        <div className="relative min-w-[260px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome ou slug…" className="pl-9" />
        </div>
        <Select value={statusFiltro} onValueChange={setStatusFiltro}>
          <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os status</SelectItem>
            <SelectItem value="ativos">Apenas ativos</SelectItem>
            <SelectItem value="inativos">Apenas inativos</SelectItem>
            <SelectItem value="bloqueados">Apenas bloqueados</SelectItem>
          </SelectContent>
        </Select>
        <Select value={pagamentoFiltro} onValueChange={setPagamentoFiltro}>
          <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os pagamentos</SelectItem>
            <SelectItem value="pagos">Pagos no mês</SelectItem>
            <SelectItem value="vencidos">Vencidos</SelectItem>
            <SelectItem value="excedente">Com excedente</SelectItem>
          </SelectContent>
        </Select>
        {temFiltros && (
          <button onClick={limparFiltros} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <X className="h-3.5 w-3.5" /> Limpar
          </button>
        )}
      </div>

      {/* Tabela */}
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
                <th className="px-5 py-3 text-left font-medium">Gmail</th>
                <th className="px-5 py-3 text-right font-medium">Membros</th>
                <th className="px-5 py-3 text-left font-medium">Uso do mês</th>
                <th className="px-5 py-3 text-right font-medium">Mensalidade</th>
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
                const pagoEsteMes = r.mensalidade_paga_em?.startsWith(mesCorrente) ?? false;
                const statusVenc = calcularStatusVencimento(r.dia_vencimento);

                return (
                  <tr key={r.id} className="transition-colors hover:bg-muted/30">
                    {/* Cliente */}
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-soft text-primary">
                          <Building2 className="h-4 w-4" />
                        </span>
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-medium text-foreground">{r.nome}</p>
                            {pagoEsteMes && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 text-[11px] font-semibold text-success">Pago</span>
                            )}
                            {!pagoEsteMes && statusVenc.tipo === "a-vencer" && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-semibold text-warning">
                                <Clock className="h-3 w-3" /> {statusVenc.diasRestantes}d
                              </span>
                            )}
                            {!pagoEsteMes && statusVenc.tipo === "vence-hoje" && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-semibold text-warning">
                                <Clock className="h-3 w-3" /> Hoje
                              </span>
                            )}
                            {!pagoEsteMes && statusVenc.tipo === "vencido" && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-destructive/15 px-2 py-0.5 text-[11px] font-semibold text-destructive">
                                <AlertTriangle className="h-3 w-3" /> Vencido
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">{r.slug}</p>
                        </div>
                      </div>
                    </td>

                    {/* Status */}
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

                    {/* Gmail */}
                    <td className="px-5 py-3.5">
                      {r.gmail_email ? (
                        <div className="flex items-center gap-1.5">
                          {r.gmail_ativo ? (
                            <Wifi className="h-3.5 w-3.5 text-success" />
                          ) : (
                            <WifiOff className="h-3.5 w-3.5 text-destructive" />
                          )}
                          <span className="text-xs text-muted-foreground truncate max-w-[140px]">{r.gmail_email}</span>
                        </div>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground/60 italic">
                          <WifiOff className="h-3 w-3" /> Não configurado
                        </span>
                      )}
                    </td>

                    {/* Membros */}
                    <td className="px-5 py-3.5 text-right tabular-nums text-foreground">{num(r.membros)}</td>

                    {/* Uso do mês */}
                    <td className="px-5 py-3.5">
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center gap-2">
                          <span className="tabular-nums font-medium text-foreground">
                            {num(r.pedidos_mes)}/{limite > 0 ? num(limite) : "∞"}
                          </span>
                          {excedeu && !cobradoEsteMes && (
                            <span className="inline-flex items-center rounded-full bg-destructive/15 px-2 py-0.5 text-xs font-semibold text-destructive">
                              +{num(qtdExcedente)}
                            </span>
                          )}
                          {excedeu && cobradoEsteMes && (
                            <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">cobrado</span>
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

                    {/* Mensalidade */}
                    <td className="px-5 py-3.5 text-right">
                      <p className="text-sm font-semibold tabular-nums text-foreground">
                        {r.valor_mensal != null ? brl(Number(r.valor_mensal)) : "—"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {r.dia_vencimento ? `Dia ${r.dia_vencimento}` : "—"}
                      </p>
                    </td>

                    {/* Cadastro */}
                    <td className="px-5 py-3.5 text-muted-foreground text-xs">{dataFmt(r.created_at)}</td>

                    {/* Ações */}
                    <td className="px-5 py-3.5 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {r.bloqueado_em ? (
                          <button onClick={() => setDesbloqueioTarget(r)} className="inline-flex items-center gap-1 rounded-md border border-success/40 bg-success-soft px-2.5 py-1.5 text-xs font-medium text-success transition-colors hover:bg-success/20">
                            <Unlock className="h-3.5 w-3.5" /> Desbloquear
                          </button>
                        ) : (
                          <button onClick={() => abrirBloqueio(r)} className="inline-flex items-center gap-1 rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/20">
                            <Lock className="h-3.5 w-3.5" /> Bloquear
                          </button>
                        )}
                        <Link to={`/admin/tenants/${r.id}`} className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted">
                          <Eye className="h-3.5 w-3.5" /> Ver
                        </Link>
                        <button onClick={() => setExclusaoTarget(r)} className="inline-flex items-center gap-1 rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/20">
                          <Trash2 className="h-3.5 w-3.5" /> Excluir
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <NovoClienteDialog open={openNovo} onOpenChange={setOpenNovo} onCreated={load} />

      <ExcluirTenantDialog
        open={!!exclusaoTarget}
        onOpenChange={(o) => !o && setExclusaoTarget(null)}
        tenantId={exclusaoTarget?.id ?? null}
        tenantNome={exclusaoTarget?.nome ?? null}
        onExcluido={load}
      />

      <AlertDialog open={!!bloqueioTarget} onOpenChange={(o) => !o && setBloqueioTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Bloquear cliente</AlertDialogTitle>
            <AlertDialogDescription>
              Ao bloquear <strong className="text-foreground">{bloqueioTarget?.nome}</strong>, todos os usuários desta empresa não conseguirão mais acessar o sistema.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="motivo-bloqueio">Motivo do bloqueio</Label>
            <Textarea id="motivo-bloqueio" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex: Inadimplência — fatura de set/2025 em aberto" rows={3} />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={salvandoBloqueio}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); confirmarBloqueio(); }} disabled={salvandoBloqueio || !motivo.trim()} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {salvandoBloqueio && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />} Bloquear
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!desbloqueioTarget} onOpenChange={(o) => !o && setDesbloqueioTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desbloquear cliente</AlertDialogTitle>
            <AlertDialogDescription>
              Liberar o acesso de <strong className="text-foreground">{desbloqueioTarget?.nome}</strong> ao sistema?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={salvandoBloqueio}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); confirmarDesbloqueio(); }} disabled={salvandoBloqueio}>
              {salvandoBloqueio && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />} Desbloquear
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
