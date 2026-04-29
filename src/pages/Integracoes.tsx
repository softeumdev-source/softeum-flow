import { useEffect, useState } from "react";
import {
  Loader2, Upload, Save, FileText, RefreshCw, Trash2, CheckCircle2, AlertCircle, Brain,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const SUPABASE_URL = "https://arihejdirnhmcwuhkzde.supabase.co";

interface ErpCfg {
  id?: string;
  tipo_erp: string;
  layout_arquivo: string | null;
  layout_filename: string | null;
  layout_mime: string | null;
  mapeamento_campos: any | null;
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

export default function LayoutErp() {
  const { user, tenantId, papel, isSuperAdmin, loading: authLoading } = useAuth();
  const isAdmin = papel === "admin" || isSuperAdmin;
  const sb = supabase as any;

  const [loading, setLoading] = useState(true);
  const [erp, setErp] = useState<ErpCfg>({
    tipo_erp: "outro",
    layout_arquivo: null,
    layout_filename: null,
    layout_mime: null,
    mapeamento_campos: null,
  });
  const [savingLayout, setSavingLayout] = useState(false);
  const [analisando, setAnalisando] = useState(false);
  const [pendingFile, setPendingFile] = useState<{ name: string; mime: string; content: string } | null>(null);

  useEffect(() => {
    if (authLoading || !user || !tenantId) { setLoading(false); return; }
    const load = async () => {
      setLoading(true);
      try {
        const { data: erpRow } = await sb
          .from("tenant_erp_config")
          .select("id, tipo_erp, layout_arquivo, layout_filename, layout_mime, mapeamento_campos")
          .eq("tenant_id", tenantId)
          .maybeSingle();
        if (erpRow) {
          setErp({
            id: erpRow.id,
            tipo_erp: erpRow.tipo_erp ?? "outro",
            layout_arquivo: erpRow.layout_arquivo ?? null,
            layout_filename: erpRow.layout_filename ?? null,
            layout_mime: erpRow.layout_mime ?? null,
            mapeamento_campos: erpRow.mapeamento_campos ?? null,
          });
        }
      } catch (err: any) {
        toast.error("Erro ao carregar layout", { description: err.message });
      } finally {
        setLoading(false);
      }
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user, tenantId]);

  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const result = ev.target?.result as string;
      const base64 = result.split(",")[1] ?? "";
      setPendingFile({ name: file.name, mime: file.type || "application/octet-stream", content: base64 });
    };
    reader.readAsDataURL(file);
  };

  const analisarLayout = async () => {
    if (!tenantId) return;
    setAnalisando(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      const res = await fetch(`${SUPABASE_URL}/functions/v1/analisar-layout-erp`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ tenant_id: tenantId }),
      });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error || "Erro ao analisar layout");
      setErp((curr) => ({ ...curr, mapeamento_campos: json.mapeamento ?? curr.mapeamento_campos }));
      toast.success("Layout analisado com sucesso");
    } catch (err: any) {
      toast.error("Falha ao analisar layout", { description: err.message });
    } finally {
      setAnalisando(false);
    }
  };

  const salvarLayout = async () => {
    if (!tenantId || !pendingFile) return;
    setSavingLayout(true);
    try {
      const payloadBase = {
        tenant_id: tenantId,
        tipo_erp: erp.tipo_erp,
        layout_arquivo: pendingFile.content,
        layout_filename: pendingFile.name,
        layout_mime: pendingFile.mime,
      };
      const { error } = erp.id
        ? await sb.from("tenant_erp_config").update(payloadBase).eq("id", erp.id)
        : await sb.from("tenant_erp_config").insert(payloadBase);
      if (error) throw error;
      setErp((curr) => ({
        ...curr,
        layout_arquivo: pendingFile.content,
        layout_filename: pendingFile.name,
        layout_mime: pendingFile.mime,
      }));
      setPendingFile(null);
      toast.success("Layout salvo. Analisando com IA...");
      await analisarLayout();
    } catch (err: any) {
      toast.error("Erro ao salvar layout", { description: err.message });
    } finally {
      setSavingLayout(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-[1100px] px-8 py-8">
        <div className="flex items-center justify-center rounded-xl border border-border bg-card py-20 text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Carregando layout...
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1100px] px-8 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Layout do ERP</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Envie um arquivo modelo do seu ERP. A IA analisa e mapeia as colunas para que os pedidos aprovados sejam exportados no formato certo.
        </p>
        {!isAdmin && (
          <p className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
            Somente administradores podem alterar o layout.
          </p>
        )}
      </div>

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
          <p className="mt-0.5 text-xs text-muted-foreground">Aceita XML, CSV, JSON, TXT, XLSX e EDI.</p>

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

          {pendingFile && (
            <div className="mt-4 flex items-center gap-2 justify-end">
              <p className="text-xs text-muted-foreground">Ao salvar, a IA analisará automaticamente o layout.</p>
              <Button onClick={salvarLayout} disabled={!isAdmin || savingLayout || analisando} className="gap-2">
                {savingLayout || analisando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {savingLayout ? "Salvando..." : analisando ? "Analisando com IA..." : "Salvar e analisar"}
              </Button>
            </div>
          )}
        </div>

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
    </div>
  );
}
