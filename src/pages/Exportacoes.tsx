import { useEffect, useMemo, useState } from "react";
import {
  Loader2,
  Download,
  RefreshCw,
  Clock,
  AlertCircle,
  CheckCircle2,
  PackageCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

interface Pedido {
  id: string;
  numero: string;
  empresa: string | null;
  valor_total: number | null;
  created_at: string | null;
  exportado_em: string | null;
  exportacao_tentativas: number;
  exportacao_erro: string | null;
  exportacao_metodo: string | null;
  exportado: boolean;
  status: string | null;
}

interface ErpCfg {
  layout_arquivo: string | null;
  layout_filename: string | null;
  layout_mime: string | null;
  mapeamento_campos: any | null;
}

const brl = (v: number | null | undefined) =>
  (v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const dataHora = (iso: string | null) => {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

type StatusFila = "aguardando" | "falha" | "baixado";
const statusDoPedido = (p: Pedido): StatusFila => {
  if (p.exportado) return "baixado";
  if ((p.exportacao_tentativas ?? 0) > 0 && p.exportacao_erro) return "falha";
  return "aguardando";
};

const SUPABASE_URL = "https://arihejdirnhmcwuhkzde.supabase.co";

export default function Exportacoes() {
  const { user, tenantId, papel, isSuperAdmin, loading: authLoading } = useAuth();
  const isAdmin = papel === "admin" || isSuperAdmin;
  const sb = supabase as any;

  const [loading, setLoading] = useState(true);
  const [baixando, setBaixando] = useState<string | null>(null);
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [erp, setErp] = useState<ErpCfg | null>(null);

  const [filtroStatus, setFiltroStatus] = useState<string>("todos");
  const [filtroMetodo, setFiltroMetodo] = useState<string>("todos");
  const [filtroDataBase, setFiltroDataBase] = useState<"created_at" | "exportado_em">("created_at");
  const [filtroIni, setFiltroIni] = useState("");
  const [filtroFim, setFiltroFim] = useState("");

  const load = async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const [pedidosRes, erpRes] = await Promise.all([
        sb
          .from("pedidos")
          .select(
            "id, numero, empresa, valor_total, created_at, exportado_em, exportacao_tentativas, exportacao_erro, exportacao_metodo, exportado, status",
          )
          .eq("tenant_id", tenantId)
          .eq("status", "aprovado")
          .eq("exportado", false)
          .order("created_at", { ascending: false })
          .limit(500),
        sb
          .from("tenant_erp_config")
          .select("layout_arquivo, layout_filename, layout_mime, mapeamento_campos")
          .eq("tenant_id", tenantId)
          .maybeSingle(),
      ]);
      setPedidos((pedidosRes.data as Pedido[]) ?? []);
      setErp((erpRes.data as ErpCfg) ?? null);
    } catch (err: any) {
      toast.error("Erro ao carregar exportações", { description: err.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (authLoading || !user || !tenantId) {
      setLoading(false);
      return;
    }
    load();
    const channel = supabase
      .channel(`exportacoes-${tenantId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pedidos", filter: `tenant_id=eq.${tenantId}` },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, authLoading, user]);

  // ===== Cards =====
  const cards = useMemo(() => {
    const hojeIso = new Date().toISOString().slice(0, 10);
    let aguardando = 0;
    let falha = 0;
    let exportadosHoje = 0;
    pedidos.forEach((p) => {
      const s = statusDoPedido(p);
      if (s === "aguardando") aguardando++;
      if (s === "falha") falha++;
      if (p.exportado && p.exportado_em && p.exportado_em.slice(0, 10) === hojeIso) {
        exportadosHoje++;
      }
    });
    return { aguardando, falha, exportadosHoje };
  }, [pedidos]);

  // ===== Filtros =====
  const filtrados = useMemo(() => {
    return pedidos.filter((p) => {
      const s = statusDoPedido(p);
      if (filtroStatus !== "todos" && s !== filtroStatus) return false;
      if (filtroMetodo !== "todos" && p.exportacao_metodo !== filtroMetodo) return false;
      const ref = filtroDataBase === "exportado_em" ? p.exportado_em : p.created_at;
      if (filtroIni && ref && new Date(ref) < new Date(filtroIni)) return false;
      if (filtroFim && ref && new Date(ref) > new Date(filtroFim + "T23:59:59")) return false;
      // Quando filtra por exportado_em, pedidos ainda não exportados ficam de
      // fora — comportamento esperado pra recriar o "histórico".
      if ((filtroIni || filtroFim) && filtroDataBase === "exportado_em" && !p.exportado_em) return false;
      return true;
    });
  }, [pedidos, filtroStatus, filtroMetodo, filtroDataBase, filtroIni, filtroFim]);

  // ===== Baixar usando a Edge Function exportar-pedido =====
  const baixar = async (p: Pedido) => {
    if (!erp?.layout_arquivo || !erp?.layout_filename) {
      toast.error("Salve um layout em Integrações antes de exportar");
      return;
    }
    if (!erp?.mapeamento_campos?.colunas?.length) {
      toast.error("Mapeamento do ERP não encontrado. Acesse Integrações e salve o layout novamente.");
      return;
    }

    setBaixando(p.id);
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (!user || userError) {
        toast.error("Sessão expirada. Faça login novamente.");
        return;
      }
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) {
        toast.error("Token de sessão não encontrado. Faça login novamente.");
        return;
      }

      const res = await fetch(`${SUPABASE_URL}/functions/v1/exportar-pedido`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ pedido_id: p.id, tenant_id: tenantId }),
      });

      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || "Erro ao exportar pedido");
      }

      // Decodifica base64 e baixa
      const byteChars = atob(json.arquivo);
      const byteNumbers = Array.from(byteChars).map((c) => c.charCodeAt(0));
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: json.mime_type || "text/csv" });

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = json.filename || `${p.numero}.csv`;
      a.click();
      URL.revokeObjectURL(url);

      toast.success(`Pedido ${p.numero} exportado — ${json.total_itens} itens`);
      load();
    } catch (err: any) {
      toast.error("Erro ao baixar", { description: err.message });
    } finally {
      setBaixando(null);
    }
  };

  const baixarTudo = async () => {
    if (!erp?.layout_arquivo || !erp?.layout_filename) {
      toast.error("Salve um layout em Integrações antes de exportar");
      return;
    }
    if (!erp?.mapeamento_campos?.colunas?.length) {
      toast.error("Mapeamento do ERP não encontrado. Acesse Integrações e salve o layout novamente.");
      return;
    }

    const fila = pedidos.filter((p) => statusDoPedido(p) !== "baixado");
    if (fila.length === 0) {
      toast.info("Nenhum pedido na fila para baixar");
      return;
    }

    setBaixando("__lote__");
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (!user || userError) {
        toast.error("Sessão expirada. Faça login novamente.");
        return;
      }
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) {
        toast.error("Token de sessão não encontrado. Faça login novamente.");
        return;
      }

      const res = await fetch(`${SUPABASE_URL}/functions/v1/exportar-pedidos-lote`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ tenant_id: tenantId, pedido_ids: fila.map((p) => p.id) }),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || "Erro ao exportar lote");
      }

      const byteChars = atob(json.arquivo);
      const byteNumbers = Array.from(byteChars).map((c) => c.charCodeAt(0));
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: json.mime_type || "text/csv" });

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = json.filename || `pedidos_lote.csv`;
      a.click();
      URL.revokeObjectURL(url);

      toast.success(`${json.total_pedidos} pedido(s) exportado(s) em arquivo único — ${json.total_itens} itens`);
      load();
    } catch (err: any) {
      toast.error("Erro ao baixar lote", { description: err.message });
    } finally {
      setBaixando(null);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-[1200px] px-8 py-8">
        <div className="flex items-center justify-center rounded-xl border border-border bg-card py-20 text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Carregando exportações...
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1200px] px-8 py-8">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Exportações</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Pedidos aprovados aguardando envio ao ERP. Atualização em tempo real.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} className="gap-2">
          <RefreshCw className="h-4 w-4" />
          Atualizar
        </Button>
      </div>

      {/* Cards */}
      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <CardKpi icone={Clock} titulo="Aguardando download" valor={cards.aguardando} tone="amber" />
        <CardKpi icone={AlertCircle} titulo="Falha na API" valor={cards.falha} tone="red" />
        <CardKpi icone={CheckCircle2} titulo="Exportados hoje" valor={cards.exportadosHoje} tone="green" />
      </div>

      {/* Filtros */}
      <section className="mb-4 rounded-xl border border-border bg-card p-4">
        <div className="grid gap-3 md:grid-cols-5">
          <div className="space-y-1.5">
            <Label className="text-xs">Status</Label>
            <Select value={filtroStatus} onValueChange={setFiltroStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                <SelectItem value="aguardando">Aguardando</SelectItem>
                <SelectItem value="falha">Falha API</SelectItem>
                <SelectItem value="baixado">Baixado</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Método</Label>
            <Select value={filtroMetodo} onValueChange={setFiltroMetodo}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                <SelectItem value="arquivo">Arquivo individual</SelectItem>
                <SelectItem value="arquivo_lote">Arquivo (lote)</SelectItem>
                <SelectItem value="api">API</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Filtrar por data de</Label>
            <Select value={filtroDataBase} onValueChange={(v) => setFiltroDataBase(v as "created_at" | "exportado_em")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="created_at">Pedido recebido</SelectItem>
                <SelectItem value="exportado_em">Exportação</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">De</Label>
            <Input type="date" value={filtroIni} onChange={(e) => setFiltroIni(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Até</Label>
            <Input type="date" value={filtroFim} onChange={(e) => setFiltroFim(e.target.value)} />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setFiltroStatus("todos");
              setFiltroMetodo("todos");
              setFiltroDataBase("created_at");
              setFiltroIni("");
              setFiltroFim("");
            }}
          >
            Limpar filtros
          </Button>
          <Button
            size="sm"
            onClick={baixarTudo}
            disabled={!isAdmin || baixando === "__lote__" || cards.aguardando + cards.falha === 0}
            className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <PackageCheck className="h-4 w-4" />
            {baixando === "__lote__" ? "Gerando arquivo..." : "Baixar tudo"}
          </Button>
        </div>
      </section>

      {/* Tabela */}
      <section className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-left">Nº Pedido</th>
                <th className="px-4 py-3 text-left">Empresa</th>
                <th className="px-4 py-3 text-right">Valor Total</th>
                <th className="px-4 py-3 text-left">Aprovado em</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-center">Tentativas</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtrados.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-sm text-muted-foreground">
                    <PackageCheck className="mx-auto mb-2 h-8 w-8 opacity-40" />
                    Nenhum pedido na fila.
                  </td>
                </tr>
              )}
              {filtrados.map((p) => {
                const s = statusDoPedido(p);
                const estaBaixando = baixando === p.id;
                return (
                  <tr key={p.id} className="hover:bg-muted/20">
                    <td className="px-4 py-3 font-medium text-foreground">{p.numero}</td>
                    <td className="px-4 py-3 text-muted-foreground">{p.empresa ?? "-"}</td>
                    <td className="px-4 py-3 text-right font-medium">{brl(p.valor_total)}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{dataHora(p.created_at)}</td>
                    <td className="px-4 py-3"><StatusBadge status={s} erro={p.exportacao_erro} /></td>
                    <td className="px-4 py-3 text-center text-xs">{p.exportacao_tentativas ?? 0}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        {s !== "baixado" && (
                          <Button
                            size="sm"
                            onClick={() => baixar(p)}
                            disabled={!isAdmin || estaBaixando}
                            className="h-7 gap-1 px-2 text-xs bg-primary text-primary-foreground hover:bg-primary/90"
                          >
                            {estaBaixando ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Download className="h-3 w-3" />
                            )}
                            {estaBaixando ? "Gerando..." : "Baixar arquivo"}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function CardKpi({ icone: Icone, titulo, valor, tone }: { icone: typeof Clock; titulo: string; valor: number; tone: "amber" | "red" | "green"; }) {
  const styles = {
    amber: { bg: "bg-amber-500/10", text: "text-amber-600", border: "border-amber-500/20" },
    red: { bg: "bg-red-500/10", text: "text-red-600", border: "border-red-500/20" },
    green: { bg: "bg-emerald-500/10", text: "text-emerald-600", border: "border-emerald-500/20" },
  }[tone];
  return (
    <div className={`rounded-xl border ${styles.border} bg-card p-5 shadow-sm`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{titulo}</p>
          <p className="mt-2 text-3xl font-bold text-foreground">{valor}</p>
        </div>
        <div className={`flex h-12 w-12 items-center justify-center rounded-lg ${styles.bg} ${styles.text}`}>
          <Icone className="h-6 w-6" />
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status, erro }: { status: StatusFila; erro: string | null }) {
  if (status === "baixado") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
        <CheckCircle2 className="h-3 w-3" />Baixado
      </span>
    );
  }
  if (status === "falha") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2.5 py-0.5 text-xs font-medium text-red-700" title={erro ?? undefined}>
        <AlertCircle className="h-3 w-3" />Falha API
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-medium text-amber-700">
      <Clock className="h-3 w-3" />Aguardando
    </span>
  );
}

