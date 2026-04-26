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
  Brain,
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

const SUPABASE_URL = "https://arihejdirnhmcwuhkzde.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFyaWhlamRpcm5obWN3dWhremRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3Mzk5MzAsImV4cCI6MjA5MjMxNTkzMH0.JNcv6mm_eNS__TvctUCalot1OcKxIUZPAtkslRya1Cg";

interface ErpCfg {
  id?: string;
  tipo_erp: string;
  endpoint: string;
  api_key: string;
  ativo: boolean;
  layout_arquivo: string | null;
  layout_filename: string | null;
  layout_mime: string | null;
  mapeamento_campos: any | null;
}

interface PedidoFila {
  id: string;
  numero: string;
  numero_pedido_cliente: string | null;
  empresa: string | null;
  valor_total: number | null;
  total_previsto: number | null;
  updated_at: string | null;
  exportacao_tentativas: number;
  exportacao_erro: string | null;
  exportado: boolean;
  exportacao_metodo: string | null;
  exportado_em: string | null;
  status: string | null;
  tenant_id: string;
}

const TIPOS_ERP = [
  { value: "sap", label: "SAP" },
  { value: "totvs_protheus", label: "TOTVS Protheus" },
  { value: "totvs_winthor", label: "TOTVS Winthor" },
  { value: "sankhya", label: "Sankhya" },
  { value: "oracle_netsuite", label: "Oracle NetSuite" },
  { value: "bling", label: "Bling" },
  { value: "outro", label: "Outro" },
];

const ACCEPTED_EXT = ".xml,.csv,.json,.txt,.xlsx,.edi";

const brl = (v: number | null | undefined) =>
  (v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const dataHora = (iso: string | null) => {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
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
    mapeamento_campos: null,
  });
  const [savingErp, setSavingErp] = useState(false);
  const [savingLayout, setSavingLayout] = useState(false);
  const [analisando, setAnalisando] = useState(false);
  const [testando, setTestando] = useState(false);
  const [pendingFile, setPendingFile] = useState<{
    name: string; mime: string; content: string;
  } | null>(null);

  const [fila, setFila] = useState<PedidoFila[]>([]);
  const [historico, setHistorico] = useState<PedidoFila[]>([]);
  const [loadingPedidos, setLoadingPedidos] = useState(false);
  const [baixandoId, setBaixandoId] = useState<string | null>(null);

  const [filtroPeriodoIni, setFiltroPeriodoIni] = useState("");
  const [filtroPeriodoFim, setFiltroPeriodoFim] = useState("");
  const [filtroMetodo, setFiltroMetodo] = useState<string>("todos");

  // Carregamento
  useEffect(() => {
    if (authLoading || !user || !tenantId) { setLoading(false); return; }
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
            mapeamento_campos: erpRow.mapeamento_campos ?? null,
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
          .select("id, numero, numero_pedido_cliente, empresa, valor_total, total_previsto, updated_at, exportacao_tentativas, exportacao_erro, exportado, exportacao_metodo, exportado_em, status, tenant_id")
          .eq("tenant_id", tenantId)
          .eq("status", "aprovado")
          .eq("exportado", false)
          .order("updated_at", { ascending: false }),
        sb
          .from("pedidos")
          .select("id, numero, numero_pedido_cliente, empresa, valor_total, total_previsto, updated_at, exportacao_tentativas, exportacao_erro, exportado, exportacao_metodo, exportado_em, status, tenant_id")
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
      .on("postgres_changes", { event: "*", schema: "public", table: "pedidos", filter: `tenant_id=eq.${tenantId}` }, () => loadPedidos())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [tenantId]);

  // Upload arquivo
  const handleFile = async (file: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      setPendingFile({ name: file.name, mime: file.type || "application/octet-stream", content: result });
      toast.success("Arquivo carregado", { description: `${file.name} pronto para salvar.` });
    };
    reader.onerror = () => toast.error("Erro ao ler arquivo");
    const isBinary = /\.(xlsx|xls|edi)$/i.test(file.name);
    if (isBinary) { reader.readAsDataURL(file); } else { reader.readAsText(file); }
  };

  // Salvar layout E analisar automaticamente
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
            mapeamento_campos: null,
          },
          { onConflict: "tenant_id" },
        );
      if (error) throw error;

      setErp((prev) => ({
        ...prev,
        layout_arquivo: pendingFile.content,
        layout_filename: pendingFile.name,
        layout_mime: pendingFile.mime,
        mapeamento_campos: null,
      }));
      setPendingFile(null);
      toast.success("Layout salvo! Analisando com IA...");

      // Chamar analisar-layout-erp automaticamente
      await analisarLayout(tenantId);

    } catch (err: any) {
      toast.error("Erro ao salvar layout", { description: err.message });
    } finally {
      setSavingLayout(false);
    }
  };

  // Analisar layout com IA e SALVAR no banco
  const analisarLayout = async (tid?: string) => {
    const tId = tid ?? tenantId;
    if (!tId) return;
    setAnalisando(true);
    try {
      const res = await fetch(
        `${SUPABASE_URL}/functions/v1/analisar-layout-erp`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
          },
          body: JSON.stringify({ tenant_id: tId }),
        },
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao analisar layout");

      const mapeamento = json.mapeamento;

      // SALVA o mapeamento no banco — correção do bug principal
      const { error: updateError } = await sb
        .from("tenant_erp_config")
        .update({ mapeamento_campos: mapeamento })
        .eq("tenant_id", tId);

      if (updateError) throw updateError;

      setErp((prev) => ({ ...prev, mapeamento_campos: mapeamento }));
      toast.success("Layout analisado e salvo com sucesso!", {
        description: `${mapeamento?.colunas?.length ?? 0} colunas mapeadas pela IA.`,
      });
    } catch (err: any) {
      toast.error("Erro ao analisar layout", { description: err.message });
    } finally {
      setAnalisando(false);
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
    if (!erp.endpoint) { toast.error("Informe a URL da API antes de testar"); return; }
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

  // Baixar pedido
  const baixarPedido = async (p: PedidoFila) => {
    if (!erp.mapeamento_campos?.colunas?.length) {
      toast.error("Mapeamento do ERP não encontrado. Salve o layout novamente para a IA analisar.");
      return;
    }

    setBaixandoId(p.id);
    try {
      const res = await fetch(
        `${SUPABASE_URL}/functions/v1/exportar-pedido`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
          },
          body: JSON.stringify({ pedido_id: p.id, tenant_id: p.tenant_id }),
        },
      );

      const json = await res.json();

      if (!res.ok) {
        throw new Error(json.error ?? "Erro ao exportar pedido");
      }

      // Decodificar base64 e baixar
      const base64 = json.arquivo;
      const byteChars = atob(base64);
      const byteNumbers = new Uint8Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) {
        byteNumbers[i] = byteChars.charCodeAt(i);
      }
      const blob = new Blob([byteNumbers], { type: json.mime_type });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = json.filename;
      a.click();
      URL.revokeObjectURL(url);

      toast.success("Pedido exportado com sucesso!", {
        description: `${json.total_itens} itens · ${json.filename}`,
      });

      loadPedidos();
    } catch (err: any) {
      toast.error("Erro ao exportar pedido", { description: err.message });
    } finally {
      setBaixandoId(null);
    }
  };

  const tentarApiNovamente = async (p: PedidoFila) => {
    if (!erp.ativo || !erp.endpoint) { toast.error("Integração via API não está ativa"); return; }
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
        await sb.from("pedidos").update({ exportado: true, exportado_em: new Date().toISOString(), exportacao_metodo: "api", exportacao_tentativas: novasTent, exportacao_erro: null }).eq("id", p.id);
        toast.success("Pedido enviado via API");
      } else {
        await sb.from("pedidos").update({ exportacao_tentativas: novasTent, exportacao_erro: `HTTP ${res.status}` }).eq("id", p.id);
        toast.error("Falha no envio", { description: `HTTP ${res.status}` });
      }
      loadPedidos();
    } catch (err: any) {
      const novasTent = (p.exportacao_tentativas ?? 0) + 1;
      await sb.from("pedidos").update({ exportacao_tentativas: novasTent, exportacao_erro: err.message }).eq("id", p.id);
      toast.error("Falha no envio", { description: err.message });
      loadPedidos();
    }
  };

  const historicoFiltrado = useMemo(() => {
    return historico.filter((h) => {
      if (filtroMetodo !== "todos" && h.exportacao_metodo !== filtroMetodo) return false;
      if (filtroPeriodoIni && h.exportado_em && new Date(h.exportado_em) < new Date(filtroPeriodoIni)) return false;
      if (filtroPeriodoFim && h.exportado_em && new Date(h.exportado_em) > new Date(filtroPeriodoFim)) return false;
      return true;
    });
  }, [historico, filtroMetodo, filtroPeriodoIni, filtroPeriodoFim]);

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
          <TabsTrigger value="exportacoes" className="gap-2">
            <Download className="h-4 w-4" />
            Exportações
            {fila.length > 0 && (
              <span className="ml-1 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground">
                {fila.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="api" className="gap-2">
            <Plug className="h-4 w-4" />
            Integração via API
          </TabsTrigger>
          <TabsTrigger value="historico" className="gap-2">
            <History className="h-4 w-4" />
            Histórico
          </TabsTrigger>
        </TabsList>

        {/* ABA 1: Layout do ERP */}
        <TabsContent value="layout" className="mt-6 space-y-6">
          <section className="rounded-xl border border-border bg-card p-6 shadow-softeum-sm">
            <div className="mb-5 flex items-start gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <FileText className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <h2 className="text-base font-semibold text-foreground">Layout do arquivo</h2>
                <p className="text-xs text-muted-foreground">
                  Envie um arquivo de exemplo do seu ERP. A IA analisa automaticamente e mapeia todas as colunas.
                </p>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="tipo-erp">Tipo de ERP</Label>
                <Select value={erp.tipo_erp} onValueChange={(v) => setErp({ ...erp, tipo_erp: v })} disabled={!isAdmin}>
                  <SelectTrigger id="tipo-erp">
                    <SelectValue placeholder="Selecione o ERP" />
                  </SelectTrigger>
                  <SelectContent>
                    {TIPOS_ERP.map((t) => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
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
                <div className="mt-3 rounded-lg border border-border bg-muted/20 px-4 py-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <FileText className="h-5 w-5 text-primary" />
                      <div>
                        <p className="text-sm font-medium text-foreground">{erp.layout_filename}</p>
                        <p className="text-xs text-muted-foreground">Layout atual salvo</p>
                      </div>
                    </div>
                    {erp.mapeamento_campos?.colunas?.length ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 border border-green-200 px-2.5 py-0.5 text-xs font-medium text-green-700">
                        <CheckCircle2 className="h-3 w-3" />
                        {erp.mapeamento_campos.colunas.length} colunas mapeadas
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 border border-amber-200 px-2.5 py-0.5 text-xs font-medium text-amber-700">
                        <AlertCircle className="h-3 w-3" />
                        Não analisado
                      </span>
                    )}
                  </div>

                  {!erp.mapeamento_campos?.colunas?.length && (
                    <div className="mt-3">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => analisarLayout()}
                        disabled={analisando}
                        className="gap-2"
                      >
                        {analisando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Brain className="h-4 w-4" />}
                        Analisar com IA
                      </Button>
                    </div>
                  )}
                </div>
              )}

              <div className="mt-3 flex items-center gap-3">
                <label className={`inline-flex cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent ${!isAdmin ? "pointer-events-none opacity-50" : ""}`}>
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
                    <Button variant="ghost" size="icon" onClick={() => setPendingFile(null)} title="Cancelar">
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
                <div className="mt-4 flex items-center gap-2 justify-end">
                  <p className="text-xs text-muted-foreground">
                    Ao salvar, a IA analisará automaticamente o layout.
                  </p>
                  <Button onClick={salvarLayout} disabled={!isAdmin || savingLayout || analisando} className="gap-2">
                    {savingLayout || analisando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    {savingLayout ? "Salvando..." : analisando ? "Analisando com IA..." : "Salvar e analisar"}
                  </Button>
                </div>
              )}
            </div>

            {/* Mapeamento gerado */}
            {erp.mapeamento_campos?.colunas?.length > 0 && (
              <div className="mt-6 rounded-lg border border-green-200 bg-green-50 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Brain className="h-4 w-4 text-green-700" />
                    <span className="text-sm font-semibold text-green-800">
                      Mapeamento da IA — {erp.mapeamento_campos.colunas.length} colunas
                    </span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => analisarLayout()}
                    disabled={analisando}
                    className="gap-2 text-xs"
                  >
                    {analisando ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                    Reanalisar
                  </Button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-green-200 text-green-700">
                        <th className="pb-2 text-left font-medium">Coluna no arquivo</th>
                        <th className="pb-2 text-left font-medium">Campo do sistema</th>
                        <th className="pb-2 text-left font-medium">Tipo</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-green-100">
                      {erp.mapeamento_campos.colunas.map((col: any, idx: number) => (
                        <tr key={idx}>
                          <td className="py-1.5 font-medium text-green-900">{col.nome_coluna}</td>
                          <td className="py-1.5 text-green-700">{col.campo_sistema}</td>
                          <td className="py-1.5 text-green-600 capitalize">{col.tipo}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>
        </TabsContent>

        {/* ABA 2: Exportações */}
        <TabsContent value="exportacoes" className="mt-6">
          <div className="rounded-xl border border-border bg-card shadow-softeum-sm">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <h2 className="text-base font-semibold text-foreground">Fila de exportação</h2>
                <p className="text-xs text-muted-foreground">
                  Pedidos aprovados aguardando exportação — {fila.length} pedido(s)
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={loadPedidos} disabled={loadingPedidos} className="gap-2">
                {loadingPedidos ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Atualizar
              </Button>
            </div>

            {!erp.mapeamento_campos?.colunas?.length && (
              <div className="mx-5 mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                <AlertCircle className="mr-2 inline h-4 w-4" />
                Nenhum layout configurado. Vá em <strong>Layout do ERP</strong> e envie um arquivo modelo para habilitar as exportações.
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/20 text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-5 py-3 text-left font-medium">Nº Pedido</th>
                    <th className="px-5 py-3 text-left font-medium">Empresa</th>
                    <th className="px-5 py-3 text-right font-medium">Valor Total</th>
                    <th className="px-5 py-3 text-left font-medium">Aprovado em</th>
                    <th className="px-5 py-3 text-left font-medium">Status</th>
                    <th className="px-5 py-3 text-left font-medium">Tentativas</th>
                    <th className="px-5 py-3 text-left font-medium">Erro</th>
                    <th className="px-5 py-3 text-center font-medium">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {fila.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-5 py-16 text-center text-sm text-muted-foreground">
                        Nenhum pedido aguardando exportação.
                      </td>
                    </tr>
                  ) : (
                    fila.map((p) => (
                      <tr key={p.id} className="hover:bg-muted/20">
                        <td className="px-5 py-3.5 font-semibold text-foreground">
                          {p.numero_pedido_cliente ?? p.numero}
                        </td>
                        <td className="px-5 py-3.5 text-foreground">{p.empresa || "-"}</td>
                        <td className="px-5 py-3.5 text-right tabular-nums font-semibold text-foreground">
                          {brl(p.valor_total ?? p.total_previsto)}
                        </td>
                        <td className="px-5 py-3.5 text-muted-foreground tabular-nums">
                          {dataHora(p.updated_at)}
                        </td>
                        <td className="px-5 py-3.5">
                          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700">
                            Aguardando
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-muted-foreground">
                          {p.exportacao_tentativas ?? 0}x
                        </td>
                        <td className="px-5 py-3.5 text-xs text-destructive">
                          {p.exportacao_erro ?? "-"}
                        </td>
                        <td className="px-5 py-3.5 text-center">
                          <div className="flex items-center justify-center gap-2">
                            <Button
                              size="sm"
                              onClick={() => baixarPedido(p)}
                              disabled={baixandoId === p.id || !erp.mapeamento_campos?.colunas?.length}
                              className="gap-2"
                            >
                              {baixandoId === p.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Download className="h-4 w-4" />
                              )}
                              Baixar arquivo
                            </Button>
                            {erp.ativo && erp.endpoint && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => tentarApiNovamente(p)}
                                className="gap-2"
                              >
                                <RefreshCw className="h-4 w-4" />
                                Tentar API
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>

        {/* ABA 3: Integração via API */}
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
              <Switch checked={erp.ativo} onCheckedChange={(v) => setErp({ ...erp, ativo: v })} disabled={!isAdmin} />
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" onClick={testarConexao} disabled={testando || !erp.endpoint} className="gap-2">
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

        {/* ABA 4: Histórico */}
        <TabsContent value="historico" className="mt-6">
          <div className="rounded-xl border border-border bg-card shadow-softeum-sm">
            <div className="flex flex-col gap-3 border-b border-border px-5 py-4 md:flex-row md:items-end md:justify-between">
              <div>
                <h2 className="text-base font-semibold text-foreground">Histórico de exportações</h2>
                <p className="text-xs text-muted-foreground">{historicoFiltrado.length} registro(s)</p>
              </div>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                <Input type="date" value={filtroPeriodoIni} onChange={(e) => setFiltroPeriodoIni(e.target.value)} className="bg-card" />
                <Input type="date" value={filtroPeriodoFim} onChange={(e) => setFiltroPeriodoFim(e.target.value)} className="bg-card" />
                <Select value={filtroMetodo} onValueChange={setFiltroMetodo}>
                  <SelectTrigger className="bg-card"><SelectValue placeholder="Método" /></SelectTrigger>
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
                    historicoFiltrado.map((p) => (
                      <tr key={p.id} className="transition-colors hover:bg-muted/30">
                        <td className="px-5 py-3.5 font-semibold text-foreground">{p.numero_pedido_cliente ?? p.numero}</td>
                        <td className="px-5 py-3.5 text-foreground">{p.empresa || "-"}</td>
                        <td className="px-5 py-3.5 text-right tabular-nums font-semibold text-foreground">
                          {brl(p.valor_total ?? p.total_previsto)}
                        </td>
                        <td className="px-5 py-3.5 capitalize text-muted-foreground">
                          {p.exportacao_metodo === "api" ? "API" : p.exportacao_metodo === "arquivo" ? "Arquivo" : "-"}
                        </td>
                        <td className="px-5 py-3.5">
                          {!p.exportacao_erro ? (
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-green-200 bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700">
                              <CheckCircle2 className="h-3 w-3" />Sucesso
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-xs font-medium text-red-700">
                              <AlertCircle className="h-3 w-3" />Erro
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3.5 tabular-nums text-muted-foreground">{dataHora(p.exportado_em)}</td>
                      </tr>
                    ))
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
