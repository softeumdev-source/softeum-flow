import { useEffect, useRef, useState } from "react";
import { FileText, Upload, Download, Trash2, Loader2, FileIcon } from "lucide-react";
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
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Documento {
  id: string;
  nome_arquivo: string;
  storage_path: string;
  tipo: string | null;
  tamanho: number | null;
  criado_em: string;
}

interface Props {
  tenantId: string;
}

const BUCKET = "documentos-clientes";

const formatBytes = (b: number | null) => {
  if (b == null) return "—";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(2)} MB`;
};

const formatData = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

const tipoLabel = (mime: string | null, nome: string) => {
  if (mime?.includes("pdf")) return "PDF";
  if (mime?.includes("image")) return "Imagem";
  if (mime?.includes("word") || mime?.includes("officedocument.word")) return "Word";
  if (mime?.includes("sheet") || mime?.includes("excel")) return "Planilha";
  const ext = nome.split(".").pop()?.toUpperCase();
  return ext || "Arquivo";
};

export function DocumentosTenant({ tenantId }: Props) {
  const [docs, setDocs] = useState<Documento[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [excluirDoc, setExcluirDoc] = useState<Documento | null>(null);
  const [excluindo, setExcluindo] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const carregar = async () => {
    setLoading(true);
    try {
      const sb = supabase as any;
      const { data, error } = await sb
        .from("tenant_documentos")
        .select("id, nome_arquivo, storage_path, tipo, tamanho, criado_em")
        .eq("tenant_id", tenantId)
        .order("criado_em", { ascending: false });
      if (error) throw error;
      setDocs(data ?? []);
    } catch (e: any) {
      toast.error("Erro ao carregar documentos: " + (e?.message ?? e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  const onSelectFile = () => inputRef.current?.click();

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // reset input
    if (!file) return;

    if (file.size > 25 * 1024 * 1024) {
      toast.error("Arquivo muito grande (máx 25 MB)");
      return;
    }

    setUploading(true);
    try {
      const sb = supabase as any;
      const ts = Date.now();
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const storagePath = `${tenantId}/${ts}-${safeName}`;

      const { error: errUp } = await sb.storage.from(BUCKET).upload(storagePath, file, {
        cacheControl: "3600",
        upsert: false,
        contentType: file.type || undefined,
      });
      if (errUp) throw errUp;

      const { data: userData } = await sb.auth.getUser();
      const { error: errIns } = await sb.from("tenant_documentos").insert({
        tenant_id: tenantId,
        nome_arquivo: file.name,
        storage_path: storagePath,
        tipo: file.type || null,
        tamanho: file.size,
        criado_por: userData?.user?.id ?? null,
      });
      if (errIns) {
        // rollback do storage
        await sb.storage.from(BUCKET).remove([storagePath]);
        throw errIns;
      }

      toast.success("Documento enviado");
      carregar();
    } catch (e: any) {
      toast.error("Erro no upload: " + (e?.message ?? e));
    } finally {
      setUploading(false);
    }
  };

  const baixar = async (doc: Documento) => {
    try {
      const sb = supabase as any;
      const { data, error } = await sb.storage
        .from(BUCKET)
        .createSignedUrl(doc.storage_path, 60);
      if (error) throw error;
      // dispara download em nova aba
      const a = document.createElement("a");
      a.href = data.signedUrl;
      a.download = doc.nome_arquivo;
      a.target = "_blank";
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e: any) {
      toast.error("Erro ao baixar: " + (e?.message ?? e));
    }
  };

  const confirmarExcluir = async () => {
    if (!excluirDoc) return;
    setExcluindo(true);
    try {
      const sb = supabase as any;
      const { error: errStorage } = await sb.storage
        .from(BUCKET)
        .remove([excluirDoc.storage_path]);
      if (errStorage) throw errStorage;
      const { error: errDb } = await sb
        .from("tenant_documentos")
        .delete()
        .eq("id", excluirDoc.id);
      if (errDb) throw errDb;
      toast.success("Documento excluído");
      setDocs((prev) => prev.filter((d) => d.id !== excluirDoc.id));
      setExcluirDoc(null);
    } catch (e: any) {
      toast.error("Erro ao excluir: " + (e?.message ?? e));
    } finally {
      setExcluindo(false);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card shadow-softeum-sm">
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-muted-foreground" />
          <div>
            <h2 className="text-base font-semibold text-foreground">Documentos do cliente</h2>
            <p className="text-xs text-muted-foreground">
              Contratos, propostas, documentos fiscais e outros arquivos
            </p>
          </div>
        </div>
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          onChange={handleUpload}
          accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.txt,.csv"
        />
        <Button onClick={onSelectFile} disabled={uploading} size="sm" className="gap-1.5">
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          {uploading ? "Enviando..." : "Enviar arquivo"}
        </Button>
      </div>

      {loading ? (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : docs.length === 0 ? (
        <div className="px-6 py-12 text-center">
          <FileIcon className="mx-auto h-8 w-8 text-muted-foreground/50" />
          <p className="mt-3 text-sm font-medium text-foreground">Nenhum documento enviado</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Clique em "Enviar arquivo" para adicionar o primeiro documento.
          </p>
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-5 py-2.5 text-left font-medium">Nome do arquivo</th>
              <th className="px-5 py-2.5 text-left font-medium">Tipo</th>
              <th className="px-5 py-2.5 text-right font-medium">Tamanho</th>
              <th className="px-5 py-2.5 text-left font-medium">Data de upload</th>
              <th className="px-5 py-2.5 text-right font-medium">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {docs.map((d) => (
              <tr key={d.id} className="hover:bg-muted/30">
                <td className="px-5 py-3">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium text-foreground">{d.nome_arquivo}</span>
                  </div>
                </td>
                <td className="px-5 py-3 text-muted-foreground">{tipoLabel(d.tipo, d.nome_arquivo)}</td>
                <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">
                  {formatBytes(d.tamanho)}
                </td>
                <td className="px-5 py-3 text-muted-foreground">{formatData(d.criado_em)}</td>
                <td className="px-5 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      onClick={() => baixar(d)}
                      variant="ghost"
                      size="sm"
                      className="h-8 gap-1.5 text-primary hover:bg-primary-soft hover:text-primary"
                    >
                      <Download className="h-3.5 w-3.5" />
                      Baixar
                    </Button>
                    <Button
                      onClick={() => setExcluirDoc(d)}
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                      aria-label="Excluir documento"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <AlertDialog open={!!excluirDoc} onOpenChange={(o) => !excluindo && !o && setExcluirDoc(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir documento</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir{" "}
              <strong className="text-foreground">{excluirDoc?.nome_arquivo}</strong>? Esta ação
              não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={excluindo}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                confirmarExcluir();
              }}
              disabled={excluindo}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {excluindo && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
