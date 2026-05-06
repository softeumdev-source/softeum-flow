import { useEffect, useMemo, useRef, useState } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
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

type Origem = "manual" | "ia" | "importacao";

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
  criado_por: string | null;
  origem: Origem;
};

const tipoExigeFatorConversao = (tipo: string) => tipo.startsWith("PRODUTO_");

const ORIGEM_META: Record<Origem, { label: string; classe: string }> = {
  manual: { label: "Manual", classe: "border-slate-300 bg-slate-50 text-slate-700" },
  ia: { label: "IA", classe: "border-blue-300 bg-blue-50 text-blue-700" },
  importacao: { label: "Importação", classe: "border-violet-300 bg-violet-50 text-violet-700" },
};
const dataHora = (iso: string) => new Date(iso).toLocaleString("pt-BR", {
  day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
});

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
  const isMobile = useIsMobile();
  const sb = supabase as any;

  const [rows, setRows] = useState<DeParaRow[]>([]);
  const [historico, setHistorico] = useState<ImportacaoRow[]>([]);
  const [nomesUsuarios, setNomesUsuarios] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  // Filtros
  const [busca, setBusca] = useState("");
  const [filtroTipo, setFiltroTipo] = useState<string>("__all");
  const [filtroCnpj, setFiltroCnpj] = useState<string>("__all");
  const [filtroSegmento, setFiltroSegmento] = useState<string>("__all");
  const [filtroOrigem, setFiltroOrigem] = useState<string>("__all");
  const [filtroDataIni, setFiltroDataIni] = useState<string>("");
  const [filtroDataFim, setFiltroDataFim] = useState<string>("");

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
  const [importacaoEditando, setImportacaoEditando] = useState<ImportacaoRow | null>(null);
  const [arquivoNomeEdit, setArquivoNomeEdit] = useState("");
  const [salvandoImportacao, setSalvandoImportacao] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const salvarImportacao = async () => {
    if (!importacaoEditando || !tenantId) return;
    setSalvandoImportacao(true);
    const { error } = await sb
      .from("de_para_importacoes")
      .update({ arquivo_nome: arquivoNomeEdit.trim() || null })
      .eq("id", importacaoEditando.id)
      .eq("tenant_id", tenantId);
    setSalvandoImportacao(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Importação atualizada.");
    setImportacaoEditando(null);
    carregar();
  };

  const carregar = async () => {
    if (!tenantId) return;
    setLoading(true);
    const [{ data: dp }, { data: imp }, { data: membros }] = await Promise.all([
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
      sb
        .from("tenant_membros")
        .select("user_id, nome")
        .eq("tenant_id", tenantId),
    ]);
    setRows((dp ?? []) as DeParaRow[]);
    setHistorico((imp ?? []) as ImportacaoRow[]);
    const mapa: Record<string, string> = {};
    for (const m of (membros ?? []) as Array<{ user_id: string; nome: string | null }>) {
      if (m.user_id) mapa[m.user_id] = m.nome ?? "";
    }
    setNomesUsuarios(mapa);
    setLoading(false);
  };

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  const compradoresUnicos = useMemo(() => {
    const map = new Map<string, string>(); // cnpj -> nome
    for (const r of rows) {
      const cnpj = (r.cnpj_comprador ?? "").trim();
      if (!cnpj) continue;
      if (!map.has(cnpj)) map.set(cnpj, r.nome_comprador ?? cnpj);
    }
    return Array.from(map.entries())
      .map(([cnpj, nome]) => ({ cnpj, nome }))
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  }, [rows]);

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const dataIni = filtroDataIni ? new Date(filtroDataIni + "T00:00:00").getTime() : null;
    const dataFim = filtroDataFim ? new Date(filtroDataFim + "T23:59:59").getTime() : null;
    return rows.filter((r) => {
      if (filtroTipo !== "__all" && r.tipo !== filtroTipo) return false;
      if (filtroSegmento !== "__all" && (r.segmento ?? "") !== filtroSegmento) return false;
      if (filtroCnpj !== "__all" && (r.cnpj_comprador ?? "") !== filtroCnpj) return false;
      if (filtroOrigem !== "__all" && r.origem !== filtroOrigem) return false;
      if (dataIni !== null) {
        const t = new Date(r.criado_em).getTime();
        if (t < dataIni) return false;
      }
      if (dataFim !== null) {
        const t = new Date(r.criado_em).getTime();
        if (t > dataFim) return false;
      }
      if (q) {
        const alvo = [
          r.valor_origem,
          r.valor_destino,
          r.descricao ?? "",
          r.nome_comprador ?? "",
          r.cnpj_comprador ?? "",
        ].join(" ").toLowerCase();
        if (!alvo.includes(q)) return false;
      }
      return true;
    });
  }, [rows, busca, filtroTipo, filtroSegmento, filtroCnpj, filtroOrigem, filtroDataIni, filtroDataFim]);

  const resumo = useMemo(() => {
    const total = rows.length;
    let ativos = 0;
    let inativos = 0;
    const porTipo: Record<string, number> = {};
    for (const r of rows) {
      if (r.ativo) ativos++; else inativos++;
      porTipo[r.tipo] = (porTipo[r.tipo] ?? 0) + 1;
    }
    const tipoMaior = Object.entries(porTipo).sort((a, b) => b[1] - a[1])[0] ?? null;
    return { total, ativos, inativos, tipoMaior };
  }, [rows]);

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
      fator_conversao: tipoExigeFatorConversao(form.tipo) && form.fator_conversao
        ? Number(form.fator_conversao)
        : null,
      ativo: form.ativo,
    };
    const { error } = editandoId
      ? await sb.from("de_para").update(payload).eq("id", editandoId).eq("tenant_id", tenantId)
      : await sb.from("de_para").insert({ ...payload, criado_por: user?.id ?? null, origem: "manual" });
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
    const { error } = await sb.from("de_para").update({ ativo: !r.ativo }).eq("id", r.id).eq("tenant_id", tenantId);
    if (error) return toast.error(error.message);
    toast.success(r.ativo ? "Desativado." : "Ativado.");
    carregar();
  };

  const excluir = async () => {
    if (!excluirId) return;
    const { error } = await sb.from("de_para").delete().eq("id", excluirId).eq("tenant_id", tenantId);
    setExcluirId(null);
    if (error) return toast.error(error.message);
    toast.success("Mapeamento excluído.");
    carregar();
  };

  // ============== Importação ==============
  const baixarTemplate = () => {
    const headers = TEMPLATE_HEADERS;
    const exemplos = [
      [
        "PROD-001", "Caneta Esferográfica Azul 1.0mm cx 50un", "7891234567890",
        "CAN-AZ-001", "PRODUTO_CODIGO", "cliente_erp", "geral", "", "", "true"
      ],
      [
        "PROD-002", "Papel A4 75g 500 folhas", "7899876543210",
        "PAP-A4-500", "PRODUTO_CODIGO", "cliente_erp", "geral", "", "", "true"
      ],
      [
        "EMP-SP-001", "Empresa ABC Ltda", "",
        "12345678000190", "EMPRESA_CNPJ", "cliente_erp", "geral", "", "", "true"
      ],
    ];
    const linhas = [headers, ...exemplos]
      .map((l) => l.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const bom = "﻿";
    const blob = new Blob([bom + linhas], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "template_de_para.csv";
    a.click();
    URL.revokeObjectURL(url);
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
        origem: "importacao",
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
    <div className="px-4 py-6 sm:px-8 sm:py-8">
      <div className="mb-6 flex items-center gap-3">
        <ArrowLeftRight className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Mapeamento de códigos</h1>
          <p className="text-sm text-muted-foreground">
            Traduza códigos e informações que vêm dos compradores para os valores corretos no seu ERP.
          </p>
        </div>
      </div>

      <div className="mb-6 grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(130px,100%),1fr))" }}>
        <Card>
          <CardContent className="p-4">
            <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Total</div>
            <div className="mt-1 text-2xl font-semibold">{resumo.total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Ativos</div>
            <div className="mt-1 text-2xl font-semibold text-emerald-700">{resumo.ativos}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Inativos</div>
            <div className="mt-1 text-2xl font-semibold text-muted-foreground">{resumo.inativos}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Tipo mais usado</div>
            <div className="mt-1 break-words text-sm font-semibold leading-snug">
              {resumo.tipoMaior ? (
                <span className="font-mono">{resumo.tipoMaior[0]} <span className="text-muted-foreground">({resumo.tipoMaior[1]})</span></span>
              ) : "—"}
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="mapeamentos" className="w-full">
        <div className="overflow-x-auto">
          <TabsList className="w-max">
            <TabsTrigger value="mapeamentos">Mapeamentos</TabsTrigger>
            <TabsTrigger value="importar">Importar Planilha</TabsTrigger>
            <TabsTrigger value="historico">Histórico</TabsTrigger>
          </TabsList>
        </div>

        {/* ABA 1 — Mapeamentos */}
        <TabsContent value="mapeamentos" className="mt-4 space-y-4">
          <Card>
            <CardContent className="grid grid-cols-1 gap-3 p-4 md:grid-cols-12">
              <div className="md:col-span-4">
                <Input
                  placeholder={isMobile ? "Buscar..." : "Buscar por código, descrição, comprador ou CNPJ"}
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                />
              </div>
              <div className="md:col-span-2">
                <Select value={filtroTipo} onValueChange={setFiltroTipo}>
                  <SelectTrigger><SelectValue placeholder="Tipo" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all">Todos os tipos</SelectItem>
                    {TIPOS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="md:col-span-3">
                <Select value={filtroCnpj} onValueChange={setFiltroCnpj}>
                  <SelectTrigger><SelectValue placeholder="Comprador" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all">Todos os compradores</SelectItem>
                    {compradoresUnicos.map((c) => (
                      <SelectItem key={c.cnpj} value={c.cnpj}>
                        {c.nome} <span className="text-xs text-muted-foreground">— {c.cnpj}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="md:col-span-2">
                <Select value={filtroSegmento} onValueChange={setFiltroSegmento}>
                  <SelectTrigger><SelectValue placeholder="Segmento" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all">Todos os segmentos</SelectItem>
                    {SEGMENTOS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="md:col-span-1 md:justify-self-end">
                <Button onClick={abrirNovo} className="w-full md:w-auto">
                  <Plus className="mr-1 h-4 w-4" /> Novo
                </Button>
              </div>

              <div className="md:col-span-2">
                <Label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Origem</Label>
                <Select value={filtroOrigem} onValueChange={setFiltroOrigem}>
                  <SelectTrigger><SelectValue placeholder="Origem" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all">Todas as origens</SelectItem>
                    <SelectItem value="manual">Manual</SelectItem>
                    <SelectItem value="ia">IA</SelectItem>
                    <SelectItem value="importacao">Importação</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="md:col-span-3">
                <Label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Criado de</Label>
                <Input type="date" value={filtroDataIni} onChange={(e) => setFiltroDataIni(e.target.value)} />
              </div>
              <div className="md:col-span-3">
                <Label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">até</Label>
                <Input type="date" value={filtroDataFim} onChange={(e) => setFiltroDataFim(e.target.value)} />
              </div>
              <div className="flex items-end md:col-span-2">
                {(busca || filtroTipo !== "__all" || filtroCnpj !== "__all" || filtroSegmento !== "__all" || filtroOrigem !== "__all" || filtroDataIni || filtroDataFim) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setBusca("");
                      setFiltroTipo("__all");
                      setFiltroCnpj("__all");
                      setFiltroSegmento("__all");
                      setFiltroOrigem("__all");
                      setFiltroDataIni("");
                      setFiltroDataFim("");
                    }}
                  >
                    Limpar filtros
                  </Button>
                )}
              </div>
              <div className="flex items-end md:col-span-2 md:justify-self-end">
                <span className="text-xs text-muted-foreground">
                  {filtradas.length} de {rows.length} {rows.length === 1 ? "registro" : "registros"}
                </span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Origem</TableHead>
                    <TableHead>Comprador</TableHead>
                    <TableHead>Valor origem</TableHead>
                    <TableHead>Valor destino</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead>Criado por</TableHead>
                    <TableHead>Em</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow><TableCell colSpan={10} className="py-8 text-center text-muted-foreground">Carregando...</TableCell></TableRow>
                  ) : filtradas.length === 0 ? (
                    <TableRow><TableCell colSpan={10} className="py-8 text-center text-muted-foreground">Nenhum mapeamento encontrado.</TableCell></TableRow>
                  ) : (
                    filtradas.map((r) => {
                      const origemMeta = ORIGEM_META[r.origem] ?? ORIGEM_META.manual;
                      return (
                      <TableRow key={r.id}>
                        <TableCell><Badge variant="secondary">{r.tipo}</Badge></TableCell>
                        <TableCell>
                          <Badge variant="outline" className={origemMeta.classe}>{origemMeta.label}</Badge>
                        </TableCell>
                        <TableCell>
                          <div className="text-sm">{r.nome_comprador ?? "—"}</div>
                          <div className="text-xs text-muted-foreground">{r.cnpj_comprador ?? ""}</div>
                        </TableCell>
                        <TableCell className="font-mono text-sm">{r.valor_origem}</TableCell>
                        <TableCell className="font-mono text-sm">{r.valor_destino}</TableCell>
                        <TableCell className="max-w-[280px] truncate text-sm text-muted-foreground">{r.descricao ?? "—"}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {r.criado_por ? (nomesUsuarios[r.criado_por] || "—") : "—"}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                          {dataHora(r.criado_em)}
                        </TableCell>
                        <TableCell>
                          {r.ativo
                            ? <Badge variant="default">Ativo</Badge>
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
                    );
                    })
                  )}
                </TableBody>
              </Table>
              </div>
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
                <label className="inline-flex cursor-pointer flex-col items-center gap-1.5">
                  <span className="flex items-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent">
                    <Upload className="h-4 w-4" />
                    {arquivoImport ? "Trocar arquivo" : "Escolher arquivo"}
                  </span>
                  <span className="max-w-[240px] break-all text-xs text-muted-foreground">
                    {arquivoImport ? arquivoImport.name : "Nenhum arquivo selecionado"}
                  </span>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    onChange={onSelectArquivo}
                    className="hidden"
                  />
                </label>
                {arquivoImport && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {preview.length} linha(s) detectada(s)
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
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {historico.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">Nenhuma importação realizada.</TableCell></TableRow>
                  ) : (
                    historico.map((h) => (
                      <TableRow key={h.id}>
                        <TableCell>{new Date(h.criado_em).toLocaleString("pt-BR")}</TableCell>
                        <TableCell className="text-sm">{h.arquivo_nome ?? "—"}</TableCell>
                        <TableCell><Badge variant="secondary">{h.quantidade_registros}</Badge></TableCell>
                        <TableCell className="text-sm">{h.usuario_nome ?? "—"}</TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="icon" variant="ghost" title="Editar"
                            onClick={() => { setImportacaoEditando(h); setArquivoNomeEdit(h.arquivo_nome ?? ""); }}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        </TableCell>
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

            {tipoExigeFatorConversao(form.tipo) ? (
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
            ) : (
              <div />
            )}
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

      {/* Editar importação */}
      <Dialog open={!!importacaoEditando} onOpenChange={(o) => !o && setImportacaoEditando(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Editar importação</DialogTitle>
            <DialogDescription>
              {importacaoEditando?.quantidade_registros ?? 0} registro(s) · {importacaoEditando ? new Date(importacaoEditando.criado_em).toLocaleString("pt-BR") : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="arquivo-nome-edit">Nome do arquivo</Label>
            <Input
              id="arquivo-nome-edit"
              value={arquivoNomeEdit}
              onChange={(e) => setArquivoNomeEdit(e.target.value)}
              placeholder="Ex.: pedidos_jan2025.xlsx"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportacaoEditando(null)}>Cancelar</Button>
            <Button onClick={salvarImportacao} disabled={salvandoImportacao}>
              {salvandoImportacao ? "Salvando..." : "Salvar"}
            </Button>
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
