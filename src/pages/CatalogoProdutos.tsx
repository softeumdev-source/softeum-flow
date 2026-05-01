import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { Boxes, Download, Pencil, Plus, Power, Search, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

type CatalogoRow = {
  id: string;
  tenant_id: string;
  codigo_erp: string;
  descricao: string;
  ean: string | null;
  categoria: string | null;
  fator_conversao: number;
  ativo: boolean;
  created_at: string;
  updated_at: string;
};

type LinhaImport = {
  codigo_erp: string;
  descricao: string;
  ean: string;
  categoria: string;
  fator_conversao: string;
  erros: string[];
};

const TEMPLATE_HEADERS = ["codigo_erp", "descricao", "ean", "categoria", "fator_conversao"] as const;

const PAGE_SIZE = 50;

interface FormState {
  codigo_erp: string;
  descricao: string;
  ean: string;
  categoria: string;
  fator_conversao: string;
  ativo: boolean;
}

const FORM_INICIAL: FormState = {
  codigo_erp: "",
  descricao: "",
  ean: "",
  categoria: "",
  fator_conversao: "1",
  ativo: true,
};

export default function CatalogoProdutos() {
  const { tenantId, papel, isSuperAdmin } = useAuth();
  const isAdmin = papel === "admin" || isSuperAdmin;
  const sb = supabase as any;

  const [rows, setRows] = useState<CatalogoRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const [busca, setBusca] = useState("");
  const [filtroCategoria, setFiltroCategoria] = useState<string>("__all");
  const [categorias, setCategorias] = useState<string[]>([]);
  const [pagina, setPagina] = useState(0);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(FORM_INICIAL);
  const [salvando, setSalvando] = useState(false);

  const [excluirId, setExcluirId] = useState<string | null>(null);

  const [arquivoImport, setArquivoImport] = useState<File | null>(null);
  const [preview, setPreview] = useState<LinhaImport[]>([]);
  const [importando, setImportando] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const carregar = async () => {
    if (!tenantId) return;
    setLoading(true);
    let query = sb
      .from("catalogo_produtos")
      .select("*", { count: "exact" })
      .eq("tenant_id", tenantId)
      .order("codigo_erp", { ascending: true });

    if (filtroCategoria !== "__all") {
      query = query.eq("categoria", filtroCategoria);
    }
    const q = busca.trim();
    if (q) {
      const escaped = q.replace(/[%,]/g, "");
      query = query.or(`codigo_erp.ilike.%${escaped}%,descricao.ilike.%${escaped}%,ean.ilike.%${escaped}%`);
    }

    const from = pagina * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const { data, error, count } = await query.range(from, to);
    if (error) {
      toast.error("Falha ao carregar catálogo", { description: error.message });
      setRows([]);
      setTotal(0);
    } else {
      setRows((data ?? []) as CatalogoRow[]);
      setTotal(count ?? 0);
    }
    setLoading(false);
  };

  const carregarCategorias = async () => {
    if (!tenantId) return;
    const { data } = await sb
      .from("catalogo_produtos")
      .select("categoria")
      .eq("tenant_id", tenantId)
      .not("categoria", "is", null);
    const uniq = Array.from(
      new Set(((data ?? []) as { categoria: string | null }[]).map((r) => r.categoria).filter(Boolean) as string[]),
    ).sort();
    setCategorias(uniq);
  };

  useEffect(() => {
    setPagina(0);
  }, [busca, filtroCategoria]);

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, busca, filtroCategoria, pagina]);

  useEffect(() => {
    carregarCategorias();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  const totalPaginas = useMemo(() => Math.max(1, Math.ceil(total / PAGE_SIZE)), [total]);

  const abrirNovo = () => {
    setEditandoId(null);
    setForm(FORM_INICIAL);
    setDialogOpen(true);
  };

  const abrirEdicao = (r: CatalogoRow) => {
    setEditandoId(r.id);
    setForm({
      codigo_erp: r.codigo_erp,
      descricao: r.descricao,
      ean: r.ean ?? "",
      categoria: r.categoria ?? "",
      fator_conversao: String(r.fator_conversao ?? 1),
      ativo: r.ativo,
    });
    setDialogOpen(true);
  };

  const salvar = async () => {
    if (!tenantId || !isAdmin) return;
    const codigo = form.codigo_erp.trim();
    const desc = form.descricao.trim();
    if (!codigo || !desc) {
      toast.error("Código ERP e descrição são obrigatórios.");
      return;
    }
    const fator = Number(form.fator_conversao);
    if (form.fator_conversao && (Number.isNaN(fator) || fator <= 0)) {
      toast.error("Fator de conversão deve ser número positivo.");
      return;
    }
    setSalvando(true);
    const payload = {
      tenant_id: tenantId,
      codigo_erp: codigo,
      descricao: desc,
      ean: form.ean.trim() || null,
      categoria: form.categoria.trim() || null,
      fator_conversao: form.fator_conversao ? fator : 1,
      ativo: form.ativo,
    };
    const { error } = editandoId
      ? await sb.from("catalogo_produtos").update(payload).eq("id", editandoId).eq("tenant_id", tenantId)
      : await sb.from("catalogo_produtos").insert(payload);
    setSalvando(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(editandoId ? "Produto atualizado." : "Produto cadastrado.");
    setDialogOpen(false);
    carregar();
    carregarCategorias();
  };

  const alternarAtivo = async (r: CatalogoRow) => {
    const { error } = await sb.from("catalogo_produtos").update({ ativo: !r.ativo }).eq("id", r.id).eq("tenant_id", tenantId);
    if (error) return toast.error(error.message);
    toast.success(r.ativo ? "Produto desativado." : "Produto ativado.");
    carregar();
  };

  const excluir = async () => {
    if (!excluirId) return;
    const { error } = await sb.from("catalogo_produtos").delete().eq("id", excluirId).eq("tenant_id", tenantId);
    setExcluirId(null);
    if (error) return toast.error(error.message);
    toast.success("Produto excluído.");
    carregar();
    carregarCategorias();
  };

  const baixarTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      [...TEMPLATE_HEADERS],
      ["PROD-001", "Produto exemplo 100ml", "7891234567890", "Cosméticos", 1],
      ["PROD-002", "Caixa com 12 unidades", "", "Bebidas", 12],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Catálogo");
    XLSX.writeFile(wb, "template-catalogo-produtos.xlsx");
  };

  const validarLinha = (linha: Record<string, string>): LinhaImport => {
    const obj: LinhaImport = {
      codigo_erp: (linha.codigo_erp ?? "").trim(),
      descricao: (linha.descricao ?? "").trim(),
      ean: (linha.ean ?? "").trim(),
      categoria: (linha.categoria ?? "").trim(),
      fator_conversao: (linha.fator_conversao ?? "").trim(),
      erros: [],
    };
    if (!obj.codigo_erp) obj.erros.push("codigo_erp obrigatório");
    if (!obj.descricao) obj.erros.push("descricao obrigatória");
    if (obj.fator_conversao) {
      const n = Number(obj.fator_conversao.replace(",", "."));
      if (Number.isNaN(n) || n <= 0) obj.erros.push("fator_conversao inválido");
    }
    return obj;
  };

  const lerArquivo = async (file: File) => {
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: "" });
      const normalizadas = json.map((linha) => {
        const lower: Record<string, string> = {};
        for (const k of Object.keys(linha)) {
          lower[k.toLowerCase().trim()] = String(linha[k] ?? "").trim();
        }
        return validarLinha(lower);
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

  const linhasValidas = useMemo(() => preview.filter((p) => p.erros.length === 0), [preview]);
  const linhasInvalidas = useMemo(() => preview.filter((p) => p.erros.length > 0), [preview]);

  const confirmarImportacao = async () => {
    if (!tenantId || !isAdmin || linhasValidas.length === 0) return;
    setImportando(true);
    const registros = linhasValidas.map((p) => ({
      tenant_id: tenantId,
      codigo_erp: p.codigo_erp,
      descricao: p.descricao,
      ean: p.ean || null,
      categoria: p.categoria || null,
      fator_conversao: p.fator_conversao ? Number(p.fator_conversao.replace(",", ".")) : 1,
      ativo: true,
    }));
    const { error } = await sb
      .from("catalogo_produtos")
      .upsert(registros, { onConflict: "tenant_id,codigo_erp" });
    setImportando(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setArquivoImport(null);
    setPreview([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
    toast.success(`${registros.length} produto(s) importado(s).`);
    carregar();
    carregarCategorias();
  };

  return (
    <div className="px-8 py-8">
      <div className="mb-6 flex items-center gap-3">
        <Boxes className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Catálogo de produtos</h1>
          <p className="text-sm text-muted-foreground">
            Cadastre os produtos da sua indústria. A IA usa esse catálogo para sugerir DE-PARA quando
            chega um pedido com código novo.
          </p>
        </div>
      </div>

      {!isAdmin && (
        <p className="mb-4 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
          Somente administradores podem cadastrar ou importar produtos.
        </p>
      )}

      <Tabs defaultValue="produtos" className="w-full">
        <TabsList>
          <TabsTrigger value="produtos">Produtos</TabsTrigger>
          <TabsTrigger value="importar">Importar planilha</TabsTrigger>
        </TabsList>

        <TabsContent value="produtos" className="mt-4 space-y-4">
          <Card>
            <CardContent className="grid grid-cols-1 gap-3 p-4 md:grid-cols-4">
              <div className="relative md:col-span-2">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-9"
                  placeholder="Buscar por código, descrição ou EAN"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                />
              </div>
              <Select value={filtroCategoria} onValueChange={setFiltroCategoria}>
                <SelectTrigger><SelectValue placeholder="Categoria" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all">Todas as categorias</SelectItem>
                  {categorias.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button onClick={abrirNovo} disabled={!isAdmin} className="md:justify-self-end">
                <Plus className="mr-1 h-4 w-4" /> Novo produto
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Código ERP</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead>EAN</TableHead>
                    <TableHead>Categoria</TableHead>
                    <TableHead className="text-right">Fator</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">Carregando...</TableCell></TableRow>
                  ) : rows.length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">Nenhum produto encontrado.</TableCell></TableRow>
                  ) : (
                    rows.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-mono text-sm">{r.codigo_erp}</TableCell>
                        <TableCell className="max-w-[420px] truncate">{r.descricao}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{r.ean ?? "—"}</TableCell>
                        <TableCell className="text-sm">{r.categoria ?? "—"}</TableCell>
                        <TableCell className="text-right text-sm">{r.fator_conversao ?? 1}</TableCell>
                        <TableCell>
                          {r.ativo
                            ? <Badge variant="default">Ativo</Badge>
                            : <Badge variant="outline">Inativo</Badge>}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button size="icon" variant="ghost" onClick={() => abrirEdicao(r)} disabled={!isAdmin} title="Editar">
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button size="icon" variant="ghost" onClick={() => alternarAtivo(r)} disabled={!isAdmin} title={r.ativo ? "Desativar" : "Ativar"}>
                              <Power className="h-4 w-4" />
                            </Button>
                            <Button size="icon" variant="ghost" onClick={() => setExcluirId(r.id)} disabled={!isAdmin} title="Excluir">
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

          {total > 0 && (
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>
                {total} produto(s) · página {pagina + 1} de {totalPaginas}
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setPagina((p) => Math.max(0, p - 1))} disabled={pagina === 0}>
                  Anterior
                </Button>
                <Button variant="outline" size="sm" onClick={() => setPagina((p) => Math.min(totalPaginas - 1, p + 1))} disabled={pagina >= totalPaginas - 1}>
                  Próxima
                </Button>
              </div>
            </div>
          )}
        </TabsContent>

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
                  Colunas: {TEMPLATE_HEADERS.join(", ")} · obrigatórias: <strong>codigo_erp</strong> e <strong>descricao</strong>
                </span>
              </div>

              <div className="rounded-lg border border-dashed p-6 text-center">
                <Upload className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
                <p className="mb-3 text-sm text-muted-foreground">
                  Selecione um arquivo .xlsx, .xls ou .csv. Linhas com o mesmo <code>codigo_erp</code> sobrescrevem o cadastro existente.
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={onSelectArquivo}
                  disabled={!isAdmin}
                  className="mx-auto block text-sm"
                />
                {arquivoImport && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Arquivo: <strong>{arquivoImport.name}</strong> · {preview.length} linha(s) · {linhasValidas.length} válida(s) · {linhasInvalidas.length} com erro
                  </p>
                )}
              </div>

              {preview.length > 0 && (
                <>
                  {linhasInvalidas.length > 0 && (
                    <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                      {linhasInvalidas.length} linha(s) com erro serão ignoradas. Corrija a planilha e importe de novo se quiser incluí-las.
                    </div>
                  )}
                  <div className="overflow-auto rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>#</TableHead>
                          {TEMPLATE_HEADERS.map((h) => <TableHead key={h}>{h}</TableHead>)}
                          <TableHead>Erros</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {preview.slice(0, 100).map((p, i) => (
                          <TableRow key={i} className={p.erros.length ? "bg-destructive/5" : ""}>
                            <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                            {TEMPLATE_HEADERS.map((h) => (
                              <TableCell key={h} className="font-mono text-xs">{p[h]}</TableCell>
                            ))}
                            <TableCell className="text-xs text-destructive">
                              {p.erros.join("; ") || "—"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  {preview.length > 100 && (
                    <p className="text-xs text-muted-foreground">
                      Mostrando 100 de {preview.length} linhas. Todas as válidas serão importadas.
                    </p>
                  )}
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => { setPreview([]); setArquivoImport(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}>
                      Cancelar
                    </Button>
                    <Button onClick={confirmarImportacao} disabled={!isAdmin || importando || linhasValidas.length === 0}>
                      {importando ? "Importando..." : `Confirmar (${linhasValidas.length})`}
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editandoId ? "Editar produto" : "Novo produto"}</DialogTitle>
            <DialogDescription>
              Esses dados são usados pela IA para sugerir DE-PARA quando chega um pedido com código novo.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Código ERP *</Label>
              <Input
                value={form.codigo_erp}
                onChange={(e) => setForm({ ...form, codigo_erp: e.target.value })}
                placeholder="Ex.: PROD-001"
                disabled={!!editandoId}
              />
            </div>
            <div className="space-y-1.5">
              <Label>EAN</Label>
              <Input
                value={form.ean}
                onChange={(e) => setForm({ ...form, ean: e.target.value })}
                placeholder="Código de barras (opcional)"
              />
            </div>

            <div className="space-y-1.5 md:col-span-2">
              <Label>Descrição *</Label>
              <Input
                value={form.descricao}
                onChange={(e) => setForm({ ...form, descricao: e.target.value })}
                placeholder="Como o produto deve ser identificado"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Categoria</Label>
              <Input
                value={form.categoria}
                onChange={(e) => setForm({ ...form, categoria: e.target.value })}
                placeholder="Ex.: Cosméticos, Bebidas..."
              />
            </div>
            <div className="space-y-1.5">
              <Label>Fator de conversão</Label>
              <Input
                type="number"
                step="any"
                min={0}
                value={form.fator_conversao}
                onChange={(e) => setForm({ ...form, fator_conversao: e.target.value })}
                placeholder="Ex.: 12 (caixa para unidade)"
              />
            </div>

            <div className="flex items-end gap-2 md:col-span-2">
              <Switch checked={form.ativo} onCheckedChange={(v) => setForm({ ...form, ativo: v })} id="ativo" />
              <Label htmlFor="ativo">Ativo no catálogo</Label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={salvar} disabled={salvando}>{salvando ? "Salvando..." : "Salvar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!excluirId} onOpenChange={(o) => !o && setExcluirId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir produto?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. A IA deixará de sugerir esse produto em pedidos novos.
            </AlertDialogDescription>
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
