import { useEffect, useMemo, useState } from "react";
import {
  Loader2,
  Upload,
  Save,
  FileText,
  RefreshCw,
  Download,
  Cog,
  Plug,
  History,
  Trash2,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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

interface ErpCfg {
  id?: string;
  tipo_erp: string;
  endpoint: string;
  api_key: string;
  ativo: boolean;
  layout_arquivo: string | null;
  layout_filename: string | null;
  layout_mime: string | null;
}

interface PedidoFila {
  id: string;
  numero: string;
  empresa: string | null;
  total_previsto: number | null;
  updated_at: string | null;
  exportacao_tentativas: number;
  exportacao_erro: string | null;
  exportado: boolean;
  exportacao_metodo: string | null;
  exportado_em: string | null;
  status: string | null;
}

const TIPOS_ERP = [
  { value: "sap", label: "SAP" },
  { value: "totvs_protheus", label: "TOTVS Protheus" },
  { value: "sankhya", label: "Sankhya" },
  { value: "oracle_netsuite", label: "Oracle NetSuite" },
  { value: "outro", label: "Outro" },
];

const ACCEPTED_EXT = ".xml,.csv,.json,.txt,.xlsx,.edi";

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

export default function Integracoes() {
  const { user, tenantId, papel, isSuperAdmin, loading: authLoading } = useAuth();
  const isAdmin = papel === "admin" || isSuperAdmin;
  const sb = supabase as any;

  const [loading, setLoading] = useState(true);
  const [erp, setErp] = useState<ErpCfg>({
    tipo_erp: "outro",
    endpoint: "",
    api_key: "",
    ativo: false,
    layout_arquivo: null,
    layout_filename: null,
    layout_mime: null,
  });
  const [savingErp, setSavingErp] = useState(false);
  const [savingLayout, setSavingLayout] = useState(false);
  const [testando, setTestando] = useState(false);
  const [pendingFile, setPendingFile] = useState<{
    name: string;
    mime: string;
    content: string;
  } | null>(null);

  const [fila, setFila] = useState<PedidoFila[]>([]);
  const [historico, setHistorico] = useState<PedidoFila[]>([]);
  const [loadingPedidos, setLoadingPedidos] = useState(false);

  const [filtroPeriodoIni, setFiltroPeriodoIni] = useState("");
  const [filtroPeriodoFim, setFiltroPeriodoFim] = useState("");
  const [filtroMetodo, setFiltroMetodo] = useState<string>("todos");

  // ===== Carregamento =====
  useEffect(() => {
    if (authLoading || !user || !tenantId) {
      setLoading(false);
      return;
    }
    const load = async () => {
      setLoading(true);
      try {
        const { data: erpRow } = await sb
          .from("tenant_erp_config")
          .select("*")
          .eq("tenant_id", tenantId)
          .maybeSingle();
        if (erpRow) {
          setErp({
            id: erpRow.id,
            tipo_erp: erpRow.tipo_erp ?? "outro",
            endpoint: erpRow.endpoint ?? "",
            api_key: erpRow.api_key ?? "",
            ativo: !!erpRow.ativo,
            layout_arquivo: erpRow.layout_arquivo ?? null,
            layout_filename: erpRow.layout_filename ?? null,
            layout_mime: erpRow.layout_mime ?? null,
          });
        }
      } catch (err: any) {
        toast.error("Erro ao carregar integrações", { description: err.message });
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [user, authLoading, tenantId]);

  const loadPedidos = async () => {
    if (!tenantId) return;
    setLoadingPedidos(true);
    try {
      const [filaRes, histRes] = await Promise.all([
        sb
          .from("pedidos")
          .select(
            "id, numero, empresa, total_previsto, updated_at, exportacao_tentativas, exportacao_erro, exportado, exportacao_metodo, exportado_em, status",
          )
          .eq("tenant_id", tenantId)
          .eq("status", "aprovado")
          .eq("exportado", false)
          .order("updated_at", { ascending: false }),
        sb
          .from("pedidos")
          .select(
            "id, numero, empresa, total_previsto, updated_at, exportacao_tentativas, exportacao_erro, exportado, exportacao_metodo, exportado_em, status",
          )
          .eq("tenant_id", tenantId)
          .eq("exportado", true)
          .order("exportado_em", { ascending: false })
          .limit(500),
      ]);
      setFila((filaRes.data as PedidoFila[]) ?? []);
      setHistorico((histRes.data as PedidoFila[]) ?? []);
    } catch (err: any) {
      toast.error("Erro ao carregar pedidos", { description: err.message });
    } finally {
      setLoadingPedidos(false);
    }
  };

  useEffect(() => {
    if (!tenantId) return;
    loadPedidos();
    const channel = supabase
      .channel(`integracoes-${tenantId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pedidos", filter: `tenant_id=eq.${tenantId}` },
        () => loadPedidos(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  // ===== Upload arquivo de exemplo =====
  const handleFile = async (file: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Para xlsx/binários: armazenamos como base64 data URL
      setPendingFile({
        name: file.name,
        mime: file.type || "application/octet-stream",
        content: result,
      });
      toast.success("Arquivo carregado", {
        description: `${file.name} pronto para salvar.`,
      });
    };
    reader.onerror = () => toast.error("Erro ao ler arquivo");
    // texto puro para formatos legíveis, base64 para binários
    const isBinary = /\.(xlsx|xls|edi)$/i.test(file.name);
    if (isBinary) {
      reader.readAsDataURL(file);
    } else {
      reader.readAsText(file);
    }
  };

  const salvarLayout = async () => {
    if (!tenantId || !isAdmin || !pendingFile) return;
    setSavingLayout(true);
    try {
      const { error } = await sb
        .from("tenant_erp_config")
        .upsert(
          {
            id: erp.id,
            tenant_id: tenantId,
            tipo_erp: erp.tipo_erp,
            endpoint: erp.endpoint,
            api_key: erp.api_key,
            ativo: erp.ativo,
            layout_arquivo: pendingFile.content,
            layout_filename: pendingFile.name,
            layout_mime: pendingFile.mime,
          },
          { onConflict: "tenant_id" },
        );
      if (error) throw error;
      setErp((prev) => ({
        ...prev,
        layout_arquivo: pendingFile.content,
        layout_filename: pendingFile.name,
        layout_mime: pendingFile.mime,
      }));
      setPendingFile(null);
      toast.success("Layout salvo");
    } catch (err: any) {
      toast.error("Erro ao salvar layout", { description: err.message });
    } finally {
      setSavingLayout(false);
    }
  };

  const salvarErp = async () => {
    if (!tenantId || !isAdmin) return;
    setSavingErp(true);
    try {
      const { error } = await sb
        .from("tenant_erp_config")
        .upsert(
          {
            id: erp.id,
            tenant_id: tenantId,
            tipo_erp: erp.tipo_erp,
            endpoint: erp.endpoint,
            api_key: erp.api_key,
            ativo: erp.ativo,
          },
          { onConflict: "tenant_id" },
        );
      if (error) throw error;
      toast.success("Configuração salva");
    } catch (err: any) {
      toast.error("Erro ao salvar", { description: err.message });
    } finally {
      setSavingErp(false);
    }
  };

  const testarConexao = async () => {
    if (!erp.endpoint) {
      toast.error("Informe a URL da API antes de testar");
      return;
    }
    setTestando(true);
    try {
      const res = await fetch(erp.endpoint, {
        method: "HEAD",
        headers: erp.api_key ? { Authorization: `Bearer ${erp.api_key}` } : undefined,
      });
      if (res.ok || res.status === 405) {
        toast.success("Conexão estabelecida", { description: `HTTP ${res.status}` });
      } else {
        toast.error("Falha na conexão", { description: `HTTP ${res.status}` });
      }
    } catch (err: any) {
      toast.error("Não foi possível conectar", { description: err.message });
    } finally {
      setTestando(false);
    }
  };

  // ===== Download arquivo do layout salvo =====
  const baixarPedido = async (p: PedidoFila) => {
    if (!erp.layout_arquivo || !erp.layout_filename) {
      toast.error("Salve um layout antes de exportar");
      return;
    }
    try {
      // Gera download usando o conteúdo do layout salvo como template
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

      // Marca como exportado e registra log
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
      toast.success("Pedido baixado e movido para o histórico");
      loadPedidos();
    } catch (err: any) {
      toast.error("Erro ao baixar", { description: err.message });
    }
  };

  const tentarApiNovamente = async (p: PedidoFila) => {
    if (!erp.ativo || !erp.endpoint) {
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
      loadPedidos();
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
      loadPedidos();
    }
  };

  // ===== Filtros do histórico =====
  const historicoFiltrado = useMemo(() => {
    return historico.filter((h) => {
      if (filtroMetodo !== "todos" && h.exportacao_metodo !== filtroMetodo) return false;
      if (filtroPeriodoIni && h.exportado_em && new Date(h.exportado_em) < new Date(filtroPeriodoIni))
        return false;
      if (filtroPeriodoFim && h.exportado_em && new Date(h.exportado_em) > new Date(filtroPeriodoFim))
        return false;
      return true;
    });
  }, [historico, filtroMetodo, filtroPeriodoIni, filtroPeriodoFim]);

  // ===== Render =====
  if (loading) {
    return (
      <div className="mx-auto w-full max-w-[1200px] px-8 py-8">
        <div className="flex items-center justify-center rounded-xl border border-border bg-card py-20 text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Carregando integrações...
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1200px] px-8 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Integrações</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure o layout do seu ERP, acompanhe a fila de exportação e o histórico de envios.
        </p>
        {!isAdmin && (
          <p className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
            Somente administradores podem alterar as configurações de integração.
          </p>
        )}
      </div>

      <Tabs defaultValue="layout" className="w-full">
        <TabsList>
          <TabsTrigger value="layout" className="gap-2">
            <Cog className="h-4 w-4" />
            Layout do ERP
          </TabsTrigger>
          <TabsTrigger value="api" className="gap-2">
            <Plug className="h-4 w-4" />
            Integração via API
          </TabsTrigger>
          <TabsTrigger value="historico" className="gap-2">
            <History className="h-4 w-4" />
            Histórico de envios
          </TabsTrigger>
        </TabsList>

        {/* ====== ABA 1: Layout do ERP ====== */}
        <TabsContent value="layout" className="mt-6 space-y-6">
          <section className="rounded-xl border border-border bg-card p-6 shadow-softeum-sm">
            <div className="mb-5 flex items-start gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <FileText className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <h2 className="text-base font-semibold text-foreground">Layout do arquivo</h2>
                <p className="text-xs text-muted-foreground">
                  Envie um arquivo de exemplo do seu ERP. Esse layout será usado como modelo nas
                  exportações por arquivo.
                </p>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="tipo-erp">Tipo de ERP</Label>
                <Select
                  value={erp.tipo_erp}
                  onValueChange={(v) => setErp({ ...erp, tipo_erp: v })}
                  disabled={!isAdmin}
                >
                  <SelectTrigger id="tipo-erp">
                    <SelectValue placeholder="Selecione o ERP" />
                  </SelectTrigger>
                  <SelectContent>
                    {TIPOS_ERP.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="mt-5">
              <Label className="text-sm">Arquivo de exemplo</Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Aceita XML, CSV, JSON, TXT, XLSX e EDI.
              </p>

              {erp.layout_filename && !pendingFile && (
                <div className="mt-3 flex items-center justify-between rounded-lg border border-border bg-muted/20 px-4 py-3">
                  <div className="flex items-center gap-3">
                    <FileText className="h-5 w-5 text-primary" />
                    <div>
                      <p className="text-sm font-medium text-foreground">{erp.layout_filename}</p>
                      <p className="text-xs text-muted-foreground">Layout atual salvo</p>
                    </div>
                  </div>
                </div>
              )}

              <div className="mt-3 flex items-center gap-3">
                <label
                  className={`inline-flex cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent ${
                    !isAdmin ? "pointer-events-none opacity-50" : ""
                  }`}
                >
                  <Upload className="h-4 w-4" />
                  {erp.layout_filename ? "Substituir arquivo" : "Enviar arquivo"}
                  <input
                    type="file"
                    accept={ACCEPTED_EXT}
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleFile(f);
                      e.target.value = "";
                    }}
                  />
                </label>
                {pendingFile && (
                  <>
                    <span className="text-sm text-muted-foreground">{pendingFile.name}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setPendingFile(null)}
                      title="Cancelar"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </>
                )}
              </div>

              {pendingFile && !pendingFile.content.startsWith("data:") && (
                <div className="mt-4">
                  <Label className="text-xs text-muted-foreground">Pré-visualização</Label>
                  <pre className="mt-1.5 max-h-64 overflow-auto rounded-lg border border-border bg-muted/30 p-3 text-xs text-foreground">
                    {pendingFile.content.slice(0, 4000)}
                    {pendingFile.content.length > 4000 ? "\n…" : ""}
                  </pre>
                </div>
              )}

              {pendingFile && (
                <div className="mt-4 flex justify-end">
                  <Button onClick={salvarLayout} disabled={!isAdmin || savingLayout} className="gap-2">
                    {savingLayout ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                    Salvar layout
                  </Button>
                </div>
              )}
            </div>
          </section>
        </TabsContent>

        {/* ====== ABA 2: Integração via API ====== */}
        <TabsContent value="api" className="mt-6 space-y-6">
          <section className="rounded-xl border border-border bg-card p-6 shadow-softeum-sm">
            <div className="mb-5 flex items-start gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Plug className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <h2 className="text-base font-semibold text-foreground">Integração via API</h2>
                <p className="text-xs text-muted-foreground">
                  Envio automático dos pedidos aprovados para o endpoint do seu ERP.
                </p>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="erp-url">URL da API</Label>
                <Input
                  id="erp-url"
                  value={erp.endpoint}
                  onChange={(e) => setErp({ ...erp, endpoint: e.target.value })}
                  placeholder="https://erp.suaempresa.com/api/pedidos"
                  disabled={!isAdmin}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="erp-token">Token de autenticação</Label>
                <Input
                  id="erp-token"
                  type="password"
                  value={erp.api_key}
                  onChange={(e) => setErp({ ...erp, api_key: e.target.value })}
                  placeholder="••••••••"
                  disabled={!isAdmin}
                />
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between gap-4 rounded-lg border border-border bg-muted/20 px-4 py-3">
              <div>
                <div className="text-sm font-medium text-foreground">Integração ativa</div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Quando ligado, o sistema tenta enviar os pedidos aprovados para a API automaticamente.
                </p>
              </div>
              <Switch
                checked={erp.ativo}
                onCheckedChange={(v) => setErp({ ...erp, ativo: v })}
                disabled={!isAdmin}
              />
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={testarConexao}
                disabled={testando || !erp.endpoint}
                className="gap-2"
              >
                {testando ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Testar conexão
              </Button>
              <Button onClick={salvarErp} disabled={!isAdmin || savingErp} className="gap-2">
                {savingErp ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Salvar
              </Button>
            </div>
          </section>
        </TabsContent>

        {/* ====== ABA 3: Histórico ====== */}
        <TabsContent value="historico" className="mt-6">
          <div className="rounded-xl border border-border bg-card shadow-softeum-sm">
            <div className="flex flex-col gap-3 border-b border-border px-5 py-4 md:flex-row md:items-end md:justify-between">
              <div>
                <h2 className="text-base font-semibold text-foreground">Histórico de exportações</h2>
                <p className="text-xs text-muted-foreground">
                  {historicoFiltrado.length} registro(s)
                </p>
              </div>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                <Input
                  type="date"
                  value={filtroPeriodoIni}
                  onChange={(e) => setFiltroPeriodoIni(e.target.value)}
                  className="bg-card"
                />
                <Input
                  type="date"
                  value={filtroPeriodoFim}
                  onChange={(e) => setFiltroPeriodoFim(e.target.value)}
                  className="bg-card"
                />
                <Select value={filtroMetodo} onValueChange={setFiltroMetodo}>
                  <SelectTrigger className="bg-card">
                    <SelectValue placeholder="Método" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todos os métodos</SelectItem>
                    <SelectItem value="api">API</SelectItem>
                    <SelectItem value="arquivo">Arquivo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/20 text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-5 py-3 text-left font-medium">Nº Pedido</th>
                    <th className="px-5 py-3 text-left font-medium">Empresa</th>
                    <th className="px-5 py-3 text-right font-medium">Valor Total</th>
                    <th className="px-5 py-3 text-left font-medium">Método</th>
                    <th className="px-5 py-3 text-left font-medium">Status</th>
                    <th className="px-5 py-3 text-left font-medium">Data</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {historicoFiltrado.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-5 py-16 text-center text-sm text-muted-foreground">
                        Nenhuma exportação no período.
                      </td>
                    </tr>
                  ) : (
                    historicoFiltrado.map((p) => {
                      const sucesso = !p.exportacao_erro;
                      return (
                        <tr key={p.id} className="transition-colors hover:bg-muted/30">
                          <td className="px-5 py-3.5 font-semibold text-foreground">{p.numero}</td>
                          <td className="px-5 py-3.5 text-foreground">{p.empresa || "-"}</td>
                          <td className="px-5 py-3.5 text-right tabular-nums font-semibold text-foreground">
                            {brl(p.total_previsto)}
                          </td>
                          <td className="px-5 py-3.5 capitalize text-muted-foreground">
                            {p.exportacao_metodo === "api"
                              ? "API"
                              : p.exportacao_metodo === "arquivo"
                              ? "Arquivo"
                              : "-"}
                          </td>
                          <td className="px-5 py-3.5">
                            {sucesso ? (
                              <span className="inline-flex items-center gap-1.5 rounded-full border border-green-200 bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700">
                                <CheckCircle2 className="h-3 w-3" />
                                Sucesso
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-xs font-medium text-red-700">
                                <AlertCircle className="h-3 w-3" />
                                Erro
                              </span>
                            )}
                          </td>
                          <td className="px-5 py-3.5 tabular-nums text-muted-foreground">
                            {dataHora(p.exportado_em)}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
