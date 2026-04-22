import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { ArrowLeftRight, Download, Pencil, Plus, Power, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type DeParaRow = {
  id: string;
  tenant_id: string;
  tipo: string;
  cnpj_comprador: string | null;
  nome_comprador: string | null;
  valor_origem: string;
  valor_destino: string;
  descricao: string | null;
  segmento: string | null;
  fator_conversao: number | null;
  ativo: boolean;
  criado_em: string;
};

type ImportacaoRow = {
  id: string;
  quantidade_registros: number;
  usuario_nome: string | null;
  arquivo_nome: string | null;
  criado_em: string;
};

const TIPOS = [
  "PRODUTO_CODIGO",
  "PRODUTO_UNIDADE",
  "PRODUTO_DESCRICAO",
  "CONDICAO_PAGAMENTO",
  "TRANSPORTADORA",
  "CFOP",
  "NATUREZA_OPERACAO",
  "VENDEDOR",
  "DEPOSITO",
  "CENTRO_CUSTO",
  "OUTRO",
];

const SEGMENTOS = [
  "Atacado",
  "Varejo",
  "Indústria",
  "Distribuidor",
  "Food Service",
  "E-commerce",
  "Outro",
];

const TEMPLATE_HEADERS = [
  "tipo",
  "cnpj_comprador",
  "nome_comprador",
  "valor_origem",
  "valor_destino",
  "descricao",
  "segmento",
  "fator_conversao",
];

interface FormState {
  tipo: string;
  cnpj_comprador: string;
  nome_comprador: string;
  valor_origem: string;
  valor_destino: string;
  descricao: string;
  segmento: string;
  fator_conversao: string;
  ativo: boolean;
}

const FORM_INICIAL: FormState = {
  tipo: "PRODUTO_CODIGO",
  cnpj_comprador: "",
  nome_comprador: "",
  valor_origem: "",
  valor_destino: "",
  descricao: "",
  segmento: "",
  fator_conversao: "",
  ativo: true,
};

export default function DePara() {
  const { tenantId, nomeUsuario, user } = useAuth();
  const sb = supabase as any;

  const [rows, setRows] = useState<DeParaRow[]>([]);
  const [historico, setHistorico] = useState<ImportacaoRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Filtros
  const [busca, setBusca] = useState("");
  const [filtroTipo, setFiltroTipo] = useState<string>("__all");
  const [filtroCnpj, setFiltroCnpj] = useState("");
  const [filtroSegmento, setFiltroSegmento] = useState<string>("__all");

  // Modal de criação/edição
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(FORM_INICIAL);
  const [salvando, setSalvando] = useState(false);

  // Exclusão
  const [excluirId, setExcluirId] = useState<string | null>(null);

  // Importação
  const [arquivoImport, setArquivoImport] = useState<File | null>(null);
  const [preview, setPreview] = useState<Record<string, string>[]>([]);
  const [importando, setImportando] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const carregar = async () => {
    if (!tenantId) return;
    setLoading(true);
    const [{ data: dp }, { data: imp }] = await Promise.all([
      sb
        .from("de_para")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("criado_em", { ascending: false }),
      sb
        .from("de_para_importacoes")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("criado_em", { ascending: false })
        .limit(50),
    ]);
    setRows((dp ?? []) as DeParaRow[]);
    setHistorico((imp ?? []) as ImportacaoRow[]);
    setLoading(false);
  };

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return rows.filter((r) => {
      if (filtroTipo !== "__all" && r.tipo !== filtroTipo) return false;
      if (filtroSegmento !== "__all" && (r.segmento ?? "") !== filtroSegmento) return false;
      if (filtroCnpj && !(r.cnpj_comprador ?? "").includes(filtroCnpj)) return false;
      if (q) {
        const alvo = `${r.valor_origem} ${r.valor_destino}`.toLowerCase();
        if (!alvo.includes(q)) return false;
      }
      return true;
    });
  }, [rows, busca, filtroTipo, filtroSegmento, filtroCnpj]);

  const abrirNovo = () => {
    setEditandoId(null);
    setForm(FORM_INICIAL);
    setDialogOpen(true);
  };

  const abrirEdicao = (r: DeParaRow) => {
    setEditandoId(r.id);
    setForm({
      tipo: r.tipo,
      cnpj_comprador: r.cnpj_comprador ?? "",
      nome_comprador: r.nome_comprador ?? "",
      valor_origem: r.valor_origem,
      valor_destino: r.valor_destino,
      descricao: r.descricao ?? "",
      segmento: r.segmento ?? "",
      fator_conversao: r.fator_conversao != null ? String(r.fator_conversao) : "",
      ativo: r.ativo,
    });
    setDialogOpen(true);
  };

  const salvar = async () => {
    if (!tenantId) return;
    if (!form.tipo || !form.valor_origem.trim() || !form.valor_destino.trim()) {
      toast.error("Tipo, valor de origem e valor de destino são obrigatórios.");
      return;
    }
    setSalvando(true);
    const payload = {
      tenant_id: tenantId,
      tipo: form.tipo,
      cnpj_comprador: form.cnpj_comprador.trim() || null,
      nome_comprador: form.nome_comprador.trim() || null,
      valor_origem: form.valor_origem.trim(),
      valor_destino: form.valor_destino.trim(),
      descricao: form.descricao.trim() || null,
      segmento: form.segmento || null,
      fator_conversao: form.fator_conversao ? Number(form.fator_conversao) : null,
      ativo: form.ativo,
    };
    const { error } = editandoId
      ? await sb.from("de_para").update(payload).eq("id", editandoId)
      : await sb.from("de_para").insert({ ...payload, criado_por: user?.id ?? null });
    setSalvando(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(editandoId ? "Mapeamento atualizado." : "Mapeamento criado.");
    setDialogOpen(false);
    carregar();
  };

  const alternarAtivo = async (r: DeParaRow) => {
    const { error } = await sb.from("de_para").update({ ativo: !r.ativo }).eq("id", r.id);
    if (error) return toast.error(error.message);
    toast.success(r.ativo ? "Desativado." : "Ativado.");
    carregar();
  };

  const excluir = async () => {
    if (!excluirId) return;
    const { error } = await sb.from("de_para").delete().eq("id", excluirId);
    setExcluirId(null);
    if (error) return toast.error(error.message);
    toast.success("Mapeamento excluído.");
    carregar();
  };

  // ============== Importação ==============
  const baixarTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      TEMPLATE_HEADERS,
      ["PRODUTO_CODIGO", "12.345.678/0001-90", "Comprador Exemplo", "ABC123", "PROD-001", "Mapeamento exemplo", "Atacado", ""],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "DePara");
    XLSX.writeFile(wb, "template-de-para.xlsx");
  };

  const lerArquivo = async (file: File) => {
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: "" });
      const normalizadas = json.map((linha) => {
        const obj: Record<string, string> = {};
        for (const h of TEMPLATE_HEADERS) {
          const valor = linha[h] ?? linha[h.toUpperCase()] ?? "";
          obj[h] = String(valor ?? "").trim();
        }
        return obj;
      });
      setPreview(normalizadas);
      if (!normalizadas.length) toast.warning("Nenhuma linha encontrada na planilha.");
    } catch (e: any) {
      toast.error("Falha ao ler o arquivo: " + (e?.message ?? "erro desconhecido"));
    }
  };

  const onSelectArquivo = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    setArquivoImport(f);
    setPreview([]);
    if (f) lerArquivo(f);
  };

  const confirmarImportacao = async () => {
    if (!tenantId || !preview.length) return;
    setImportando(true);
    const registros = preview
      .filter((p) => p.tipo && p.valor_origem && p.valor_destino)
      .map((p) => ({
        tenant_id: tenantId,
        tipo: p.tipo,
        cnpj_comprador: p.cnpj_comprador || null,
        nome_comprador: p.nome_comprador || null,
        valor_origem: p.valor_origem,
        valor_destino: p.valor_destino,
        descricao: p.descricao || null,
        segmento: p.segmento || null,
        fator_conversao: p.fator_conversao ? Number(p.fator_conversao) : null,
        ativo: true,
        criado_por: user?.id ?? null,
      }));

    if (!registros.length) {
      setImportando(false);
      toast.error("Nenhuma linha válida (tipo, valor_origem e valor_destino são obrigatórios).");
      return;
    }

    const { error } = await sb.from("de_para").insert(registros);
    if (error) {
      setImportando(false);
      toast.error(error.message);
      return;
    }

    await sb.from("de_para_importacoes").insert({
      tenant_id: tenantId,
      quantidade_registros: registros.length,
      usuario_id: user?.id ?? null,
      usuario_nome: nomeUsuario ?? user?.email ?? null,
      arquivo_nome: arquivoImport?.name ?? null,
    });

    setImportando(false);
    setArquivoImport(null);
    setPreview([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
    toast.success(`${registros.length} registro(s) importado(s).`);
    carregar();
  };

  return (
    <div className="px-8 py-8">
      <div className="mb-6 flex items-center gap-3">
        <ArrowLeftRight className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">DE-PARA</h1>
          <p className="text-sm text-muted-foreground">
            Mapeie códigos e informações vindas dos compradores para os valores corretos no seu ERP.
          </p>
        </div>
      </div>

      <Tabs defaultValue="mapeamentos" className="w-full">
        <TabsList>
          <TabsTrigger value="mapeamentos">Mapeamentos</TabsTrigger>
          <TabsTrigger value="importar">Importar Planilha</TabsTrigger>
          <TabsTrigger value="historico">Histórico</TabsTrigger>
        </TabsList>

        {/* ABA 1 — Mapeamentos */}
        <TabsContent value="mapeamentos" className="mt-4 space-y-4">
          <Card>
            <CardContent className="grid grid-cols-1 gap-3 p-4 md:grid-cols-5">
              <Input
                placeholder="Buscar valor origem ou destino"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
              />
              <Select value={filtroTipo} onValueChange={setFiltroTipo}>
                <SelectTrigger><SelectValue placeholder="Tipo" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all">Todos os tipos</SelectItem>
                  {TIPOS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input
                placeholder="CNPJ do comprador"
                value={filtroCnpj}
                onChange={(e) => setFiltroCnpj(e.target.value)}
              />
              <Select value={filtroSegmento} onValueChange={setFiltroSegmento}>
                <SelectTrigger><SelectValue placeholder="Segmento" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all">Todos os segmentos</SelectItem>
                  {SEGMENTOS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button onClick={abrirNovo} className="md:justify-self-end">
                <Plus className="mr-1 h-4 w-4" /> Novo mapeamento
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Comprador</TableHead>
                    <TableHead>Valor origem</TableHead>
                    <TableHead>Valor destino</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">Carregando...</TableCell></TableRow>
                  ) : filtradas.length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">Nenhum mapeamento encontrado.</TableCell></TableRow>
                  ) : (
                    filtradas.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell><Badge variant="secondary">{r.tipo}</Badge></TableCell>
                        <TableCell>
                          <div className="text-sm">{r.nome_comprador ?? "—"}</div>
                          <div className="text-xs text-muted-foreground">{r.cnpj_comprador ?? ""}</div>
                        </TableCell>
                        <TableCell className="font-mono text-sm">{r.valor_origem}</TableCell>
                        <TableCell className="font-mono text-sm">{r.valor_destino}</TableCell>
                        <TableCell className="max-w-[280px] truncate text-sm text-muted-foreground">{r.descricao ?? "—"}</TableCell>
                        <TableCell>
                          {r.ativo
                            ? <Badge className="bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/15">Ativo</Badge>
                            : <Badge variant="outline">Inativo</Badge>}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button size="icon" variant="ghost" onClick={() => abrirEdicao(r)} title="Editar">
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button size="icon" variant="ghost" onClick={() => alternarAtivo(r)} title={r.ativo ? "Desativar" : "Ativar"}>
                              <Power className="h-4 w-4" />
                            </Button>
                            <Button size="icon" variant="ghost" onClick={() => setExcluirId(r.id)} title="Excluir">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ABA 2 — Importar */}
        <TabsContent value="importar" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Importar planilha</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="outline" onClick={baixarTemplate}>
                  <Download className="mr-1 h-4 w-4" /> Baixar template
                </Button>
                <span className="text-xs text-muted-foreground">
                  Colunas: {TEMPLATE_HEADERS.join(", ")}
                </span>
              </div>

              <div className="rounded-lg border border-dashed p-6 text-center">
                <Upload className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
                <p className="mb-3 text-sm text-muted-foreground">
                  Selecione um arquivo .xlsx ou .csv para iniciar a importação.
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={onSelectArquivo}
                  className="mx-auto block text-sm"
                />
                {arquivoImport && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Arquivo: <strong>{arquivoImport.name}</strong> · {preview.length} linha(s) detectada(s)
                  </p>
                )}
              </div>

              {preview.length > 0 && (
                <>
                  <div className="overflow-auto rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          {TEMPLATE_HEADERS.map((h) => <TableHead key={h}>{h}</TableHead>)}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {preview.slice(0, 50).map((p, i) => (
                          <TableRow key={i}>
                            {TEMPLATE_HEADERS.map((h) => (
                              <TableCell key={h} className="font-mono text-xs">{p[h]}</TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  {preview.length > 50 && (
                    <p className="text-xs text-muted-foreground">
                      Mostrando 50 de {preview.length} linhas. Todas serão importadas.
                    </p>
                  )}
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => { setPreview([]); setArquivoImport(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}>
                      Cancelar
                    </Button>
                    <Button onClick={confirmarImportacao} disabled={importando}>
                      {importando ? "Importando..." : `Confirmar importação (${preview.length})`}
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ABA 3 — Histórico */}
        <TabsContent value="historico" className="mt-4">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Arquivo</TableHead>
                    <TableHead>Registros</TableHead>
                    <TableHead>Usuário</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {historico.length === 0 ? (
                    <TableRow><TableCell colSpan={4} className="py-8 text-center text-muted-foreground">Nenhuma importação realizada.</TableCell></TableRow>
                  ) : (
                    historico.map((h) => (
                      <TableRow key={h.id}>
                        <TableCell>{new Date(h.criado_em).toLocaleString("pt-BR")}</TableCell>
                        <TableCell className="text-sm">{h.arquivo_nome ?? "—"}</TableCell>
                        <TableCell><Badge variant="secondary">{h.quantidade_registros}</Badge></TableCell>
                        <TableCell className="text-sm">{h.usuario_nome ?? "—"}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Dialog de criar/editar */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editandoId ? "Editar mapeamento" : "Novo mapeamento"}</DialogTitle>
            <DialogDescription>
              Defina como um valor recebido do comprador será traduzido para o seu ERP.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Tipo *</Label>
              <Select value={form.tipo} onValueChange={(v) => setForm({ ...form, tipo: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TIPOS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Segmento</Label>
              <Select value={form.segmento || "__none"} onValueChange={(v) => setForm({ ...form, segmento: v === "__none" ? "" : v })}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">— Nenhum —</SelectItem>
                  {SEGMENTOS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>CNPJ do comprador</Label>
              <Input value={form.cnpj_comprador} onChange={(e) => setForm({ ...form, cnpj_comprador: e.target.value })} placeholder="Opcional" />
            </div>
            <div className="space-y-1.5">
              <Label>Nome do comprador</Label>
              <Input value={form.nome_comprador} onChange={(e) => setForm({ ...form, nome_comprador: e.target.value })} placeholder="Opcional" />
            </div>

            <div className="space-y-1.5">
              <Label>Valor origem *</Label>
              <Input value={form.valor_origem} onChange={(e) => setForm({ ...form, valor_origem: e.target.value })} placeholder="Como vem do comprador" />
            </div>
            <div className="space-y-1.5">
              <Label>Valor destino *</Label>
              <Input value={form.valor_destino} onChange={(e) => setForm({ ...form, valor_destino: e.target.value })} placeholder="Como deve ficar no ERP" />
            </div>

            <div className="space-y-1.5">
              <Label>Fator de conversão</Label>
              <Input
                type="number"
                step="any"
                value={form.fator_conversao}
                onChange={(e) => setForm({ ...form, fator_conversao: e.target.value })}
                placeholder="Ex.: 12 (caixa para unidade)"
              />
            </div>
            <div className="flex items-end gap-2">
              <Switch checked={form.ativo} onCheckedChange={(v) => setForm({ ...form, ativo: v })} id="ativo" />
              <Label htmlFor="ativo">Ativo</Label>
            </div>

            <div className="space-y-1.5 md:col-span-2">
              <Label>Descrição</Label>
              <Textarea value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} rows={2} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={salvar} disabled={salvando}>{salvando ? "Salvando..." : "Salvar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmação de exclusão */}
      <AlertDialog open={!!excluirId} onOpenChange={(o) => !o && setExcluirId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir mapeamento?</AlertDialogTitle>
            <AlertDialogDescription>Esta ação não pode ser desfeita.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={excluir}>Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
