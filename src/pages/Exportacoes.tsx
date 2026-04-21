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
  total_previsto: number | null;
  updated_at: string | null;
  exportado_em: string | null;
  exportacao_tentativas: number;
  exportacao_erro: string | null;
  exportacao_metodo: string | null;
  exportado: boolean;
  status: string | null;
}

interface ErpCfg {
  endpoint: string | null;
  api_key: string | null;
  ativo: boolean | null;
  layout_arquivo: string | null;
  layout_filename: string | null;
  layout_mime: string | null;
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

export default function Exportacoes() {
  const { user, tenantId, papel, loading: authLoading } = useAuth();
  const isAdmin = papel === "admin";
  const sb = supabase as any;

  const [loading, setLoading] = useState(true);
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [erp, setErp] = useState<ErpCfg | null>(null);

  const [filtroStatus, setFiltroStatus] = useState<string>("todos");
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
            "id, numero, empresa, total_previsto, updated_at, exportado_em, exportacao_tentativas, exportacao_erro, exportacao_metodo, exportado, status",
          )
          .eq("tenant_id", tenantId)
          .eq("status", "aprovado")
          .eq("exportado", false)
          .order("updated_at", { ascending: false })
          .limit(500),
        sb
          .from("tenant_erp_config")
          .select("endpoint, api_key, ativo, layout_arquivo, layout_filename, layout_mime")
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
      const ref = p.exportado_em ?? p.updated_at;
      if (filtroIni && ref && new Date(ref) < new Date(filtroIni)) return false;
      if (filtroFim && ref && new Date(ref) > new Date(filtroFim + "T23:59:59")) return false;
      return true;
    });
  }, [pedidos, filtroStatus, filtroIni, filtroFim]);

  // ===== Ações =====
  const baixar = async (p: Pedido) => {
    if (!erp?.layout_arquivo || !erp?.layout_filename) {
      toast.error("Salve um layout em Integrações antes de exportar");
      return;
    }
    try {
      const ext = erp.layout_filename.split(".").pop()?.toLowerCase() || "txt";
      const isBinary = /^(xlsx|xls|edi)$/i.test(ext);
      const filename = `${p.numero}.${ext}`;

      let blob: Blob;
      if (isBinary && erp.layout_arquivo.startsWith("data:")) {
        const res = await fetch(erp.layout_arquivo);
        blob = await res.blob();
      } else {
        blob = new Blob([erp.layout_arquivo], {
          type: erp.layout_mime || "text/plain",
        });
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);

      const nowIso = new Date().toISOString();
      await sb
        .from("pedidos")
        .update({
          exportado: true,
          exportado_em: nowIso,
          exportacao_metodo: "arquivo",
        })
        .eq("id", p.id);

      if (tenantId) {
        await sb.from("pedido_logs").insert({
          pedido_id: p.id,
          tenant_id: tenantId,
          campo: "exportacao",
          valor_anterior: "fila",
          valor_novo: `arquivo:${filename}`,
          alterado_por: user?.id ?? null,
        });
      }
      toast.success("Pedido baixado");
      load();
    } catch (err: any) {
      toast.error("Erro ao baixar", { description: err.message });
    }
  };

  const tentarApi = async (p: Pedido) => {
    if (!erp?.ativo || !erp?.endpoint) {
      toast.error("Integração via API não está ativa");
      return;
    }
    try {
      const res = await fetch(erp.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(erp.api_key ? { Authorization: `Bearer ${erp.api_key}` } : {}),
        },
        body: JSON.stringify({ pedido_id: p.id, numero: p.numero }),
      });
      const novasTent = (p.exportacao_tentativas ?? 0) + 1;
      if (res.ok) {
        await sb
          .from("pedidos")
          .update({
            exportado: true,
            exportado_em: new Date().toISOString(),
            exportacao_metodo: "api",
            exportacao_tentativas: novasTent,
            exportacao_erro: null,
          })
          .eq("id", p.id);
        toast.success("Pedido enviado via API");
      } else {
        await sb
          .from("pedidos")
          .update({
            exportacao_tentativas: novasTent,
            exportacao_erro: `HTTP ${res.status}`,
          })
          .eq("id", p.id);
        toast.error("Falha no envio", { description: `HTTP ${res.status}` });
      }
      load();
    } catch (err: any) {
      const novasTent = (p.exportacao_tentativas ?? 0) + 1;
      await sb
        .from("pedidos")
        .update({
          exportacao_tentativas: novasTent,
          exportacao_erro: err.message,
        })
        .eq("id", p.id);
      toast.error("Falha no envio", { description: err.message });
      load();
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

  if (!tenantId) {
    return (
      <div className="mx-auto w-full max-w-[1200px] px-8 py-8">
        <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          Sua conta ainda não está vinculada a um tenant.
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
        <CardKpi
          icone={Clock}
          titulo="Aguardando download"
          valor={cards.aguardando}
          tone="amber"
        />
        <CardKpi icone={AlertCircle} titulo="Falha na API" valor={cards.falha} tone="red" />
        <CardKpi
          icone={CheckCircle2}
          titulo="Exportados hoje"
          valor={cards.exportadosHoje}
          tone="green"
        />
      </div>

      {/* Filtros */}
      <section className="mb-4 rounded-xl border border-border bg-card p-4">
        <div className="grid gap-3 md:grid-cols-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Status</Label>
            <Select value={filtroStatus} onValueChange={setFiltroStatus}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                <SelectItem value="aguardando">Aguardando</SelectItem>
                <SelectItem value="falha">Falha API</SelectItem>
                <SelectItem value="baixado">Baixado</SelectItem>
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
          <div className="flex items-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setFiltroStatus("todos");
                setFiltroIni("");
                setFiltroFim("");
              }}
            >
              Limpar filtros
            </Button>
          </div>
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
                return (
                  <tr key={p.id} className="hover:bg-muted/20">
                    <td className="px-4 py-3 font-medium text-foreground">{p.numero}</td>
                    <td className="px-4 py-3 text-muted-foreground">{p.empresa ?? "-"}</td>
                    <td className="px-4 py-3 text-right font-medium">{brl(p.total_previsto)}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {dataHora(p.updated_at)}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={s} erro={p.exportacao_erro} />
                    </td>
                    <td className="px-4 py-3 text-center text-xs">
                      {p.exportacao_tentativas ?? 0}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        {s !== "baixado" && (
                          <Button
                            size="sm"
                            onClick={() => baixar(p)}
                            disabled={!isAdmin}
                            className="gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90"
                          >
                            <Download className="h-3.5 w-3.5" />
                            Baixar arquivo
                          </Button>
                        )}
                        {s === "falha" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => tentarApi(p)}
                            disabled={!isAdmin}
                            className="gap-1.5"
                          >
                            <RefreshCw className="h-3.5 w-3.5" />
                            Tentar API
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

function CardKpi({
  icone: Icone,
  titulo,
  valor,
  tone,
}: {
  icone: typeof Clock;
  titulo: string;
  valor: number;
  tone: "amber" | "red" | "green";
}) {
  const styles = {
    amber: { bg: "bg-amber-500/10", text: "text-amber-600", border: "border-amber-500/20" },
    red: { bg: "bg-red-500/10", text: "text-red-600", border: "border-red-500/20" },
    green: { bg: "bg-emerald-500/10", text: "text-emerald-600", border: "border-emerald-500/20" },
  }[tone];
  return (
    <div className={`rounded-xl border ${styles.border} bg-card p-5 shadow-sm`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {titulo}
          </p>
          <p className="mt-2 text-3xl font-bold text-foreground">{valor}</p>
        </div>
        <div
          className={`flex h-12 w-12 items-center justify-center rounded-lg ${styles.bg} ${styles.text}`}
        >
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
        <CheckCircle2 className="h-3 w-3" />
        Baixado
      </span>
    );
  }
  if (status === "falha") {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2.5 py-0.5 text-xs font-medium text-red-700"
        title={erro ?? undefined}
      >
        <AlertCircle className="h-3 w-3" />
        Falha API
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-medium text-amber-700">
      <Clock className="h-3 w-3" />
      Aguardando
    </span>
  );
}
