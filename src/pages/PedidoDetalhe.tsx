import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft, Loader2, Plus, Trash2, CheckCircle2, Clock,
  History, AlertTriangle, XCircle, Download, Boxes, Archive, FileCheck2, Copy,
} from "lucide-react";
import { ResolverCodigosNovosModal } from "@/components/ResolverCodigosNovosModal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfiancaBadge } from "@/components/StatusBadge";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useDebouncedCallback } from "@/hooks/use-debounce";
import { toast } from "sonner";

type StatusPedido =
  | "pendente"
  | "aprovado"
  | "reprovado"
  | "erro"
  | "duplicado"
  | "ignorado"
  | "aguardando_de_para"
  | "aprovado_parcial";

interface Pedido {
  id: string; tenant_id: string; numero: string | null; numero_pedido_cliente: string | null;
  numero_pedido_fornecedor: string | null; numero_edi: string | null; tipo_pedido: string | null;
  canal_venda: string | null; campanha: string | null; numero_contrato: string | null;
  empresa: string | null; nome_fantasia_cliente: string | null; cnpj: string | null;
  inscricao_estadual_cliente: string | null; email_remetente: string | null;
  nome_comprador: string | null; email_comprador: string | null; telefone_comprador: string | null;
  codigo_comprador: string | null; departamento_comprador: string | null;
  razao_social_fornecedor: string | null; cnpj_fornecedor: string | null; codigo_fornecedor: string | null;
  data_emissao: string | null; data_entrega_solicitada: string | null; data_limite_entrega: string | null;
  prazo_entrega_dias: number | null; transportadora: string | null; valor_frete: number | null;
  tipo_frete: string | null; peso_total_bruto: number | null; peso_total_liquido: number | null;
  volume_total: number | null; quantidade_volumes: number | null;
  endereco_entrega: string | null; numero_entrega: string | null; complemento_entrega: string | null;
  bairro_entrega: string | null; cidade_entrega: string | null; estado_entrega: string | null;
  cep_entrega: string | null; local_entrega: string | null;
  condicao_pagamento: string | null; prazo_pagamento_dias: number | null; forma_pagamento: string | null;
  desconto_canal: number | null; desconto_financeiro: number | null; desconto_adicional: number | null;
  numero_acordo: string | null; vendor: string | null; rebate: number | null; valor_entrada: number | null;
  ipi_percentual: number | null; valor_ipi: number | null; icms_st_percentual: number | null;
  valor_icms_st: number | null; base_calculo_st: number | null; mva_percentual: number | null;
  cfop: string | null; natureza_operacao: string | null; ncm: string | null;
  pis_percentual: number | null; cofins_percentual: number | null;
  numero_cotacao: string | null; numero_nf_referencia: string | null;
  codigo_vendedor: string | null; nome_vendedor: string | null;
  centro_custo: string | null; projeto_obra: string | null;
  instrucoes_entrega: string | null; instrucoes_faturamento: string | null;
  validade_proposta: string | null; responsavel_aprovacao: string | null;
  observacoes_gerais: string | null; valor_total: number | null; status: StatusPedido;
  confianca_ia: number | null; motivo_reprovacao: string | null;
  aprovado_por: string | null; aprovado_em: string | null;
  created_at: string | null; pdf_url: string | null;
}

interface PedidoItem {
  id: string; pedido_id: string; tenant_id: string; numero_item: number | null;
  codigo_cliente: string | null; descricao: string | null; referencia: string | null;
  ean: string | null; part_number: string | null; marca: string | null; modelo: string | null;
  cor: string | null; tamanho: string | null; grade: string | null;
  codigo_produto_erp: string | null; unidade_medida: string | null;
  quantidade: number | null; quantidade_minima: number | null; multiplo_venda: number | null;
  data_entrega_item: string | null; preco_unitario: number | null;
  preco_unitario_com_impostos: number | null; desconto: number | null;
  desconto_comercial: number | null; desconto_adicional_item: number | null;
  ipi_item_percentual: number | null; valor_ipi_item: number | null;
  icms_st_item_percentual: number | null; valor_icms_st_item: number | null;
  base_calculo_st_item: number | null; vendor_item: string | null;
  preco_total: number | null; preco_total_com_impostos: number | null;
  peso_bruto_item: number | null; peso_liquido_item: number | null;
  volume_item: number | null; ncm_item: string | null; cfop_item: string | null;
  numero_serie: string | null; lote: string | null; data_validade: string | null;
  registro_anvisa: string | null; aplicacao: string | null;
  cultura_destino: string | null; principio_ativo: string | null;
  concentracao: string | null; registro_mapa: string | null;
  composicao: string | null; shelf_life_dias: number | null;
  temperatura_conservacao: string | null; codigo_marketplace: string | null;
  numero_empenho: string | null; codigo_catmat: string | null;
  observacao_item: string | null;
}

interface PedidoLog {
  id: string; campo: string; valor_anterior: string | null;
  valor_novo: string | null; alterado_por: string | null; created_at: string | null;
}

type SaveState = "idle" | "saving" | "saved" | "error";

const brl = (v: number | null | undefined) =>
  (v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const dataHora = (iso: string | null) => {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
};

// Componente que só renderiza se o valor não for null/vazio
function CampoOpcional({ label, value, children }: { label: string; value: any; children: React.ReactNode }) {
  if (value === null || value === undefined || value === "" || value === 0) return null;
  return <Field label={label}>{children}</Field>;
}

export default function PedidoDetalhe() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, tenantId } = useAuth();

  const [pedido, setPedido] = useState<Pedido | null>(null);
  const [itens, setItens] = useState<PedidoItem[]>([]);
  const [logs, setLogs] = useState<PedidoLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [showReprovacao, setShowReprovacao] = useState(false);
  const [motivoReprovacao, setMotivoReprovacao] = useState("");
  const [showResolverCodigos, setShowResolverCodigos] = useState(false);
  const [pendentesCount, setPendentesCount] = useState(0);

  const serverSnapshotRef = useRef<Pedido | null>(null);

  useEffect(() => {
    if (!id || !user) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const sb = supabase as any;
        const [pedRes, itensRes, logsRes, pendRes] = await Promise.all([
          sb.from("pedidos").select("*").eq("id", id).maybeSingle(),
          sb.from("pedido_itens").select("*").eq("pedido_id", id).order("numero_item", { ascending: true }),
          sb.from("pedido_logs").select("*").eq("pedido_id", id).order("created_at", { ascending: false }).limit(50),
          sb.from("pedido_itens_pendentes_de_para").select("id", { count: "exact", head: true }).eq("pedido_id", id).eq("resolvido", false),
        ]);
        if (cancelled) return;
        if (pedRes.error) throw pedRes.error;
        if (!pedRes.data) { toast.error("Pedido não encontrado"); navigate("/dashboard"); return; }
        const p = pedRes.data as unknown as Pedido;
        setPedido(p);
        serverSnapshotRef.current = p;
        setItens((itensRes.data as unknown as PedidoItem[]) ?? []);
        setLogs((logsRes.data as unknown as PedidoLog[]) ?? []);
        setPendentesCount(pendRes.count ?? 0);
      } catch (err: any) {
        toast.error("Erro ao carregar pedido", { description: err.message });
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [id, user, navigate]);

  const persist = useDebouncedCallback(async (next: Pedido) => {
    if (!user) return;
    setSaveState("saving");
    try {
      const prev = serverSnapshotRef.current;
      const changedFields: { campo: string; valor_anterior: string | null; valor_novo: string | null }[] = [];
      const tracked: (keyof Pedido)[] = [
        "empresa", "cnpj", "email_remetente", "nome_comprador", "email_comprador",
        "telefone_comprador", "data_emissao", "data_entrega_solicitada", "condicao_pagamento",
        "tipo_frete", "observacoes_gerais", "endereco_entrega", "cidade_entrega",
        "estado_entrega", "cep_entrega", "valor_total", "status", "motivo_reprovacao",
      ];
      if (prev) {
        for (const k of tracked) {
          const a = prev[k]; const b = next[k];
          if ((a ?? null) !== (b ?? null)) {
            changedFields.push({ campo: String(k), valor_anterior: a == null ? null : String(a), valor_novo: b == null ? null : String(b) });
          }
        }
      }
      const sb = supabase as any;
      const { error } = await sb.from("pedidos").update({
        empresa: next.empresa, cnpj: next.cnpj, email_remetente: next.email_remetente,
        nome_comprador: next.nome_comprador, email_comprador: next.email_comprador,
        telefone_comprador: next.telefone_comprador, data_emissao: next.data_emissao,
        data_entrega_solicitada: next.data_entrega_solicitada, condicao_pagamento: next.condicao_pagamento,
        tipo_frete: next.tipo_frete, observacoes_gerais: next.observacoes_gerais,
        endereco_entrega: next.endereco_entrega, cidade_entrega: next.cidade_entrega,
        estado_entrega: next.estado_entrega, cep_entrega: next.cep_entrega,
        valor_total: next.valor_total, status: next.status, motivo_reprovacao: next.motivo_reprovacao,
        aprovado_por: next.status === "aprovado" ? user.id : next.aprovado_por,
        aprovado_em: next.status === "aprovado" ? new Date().toISOString() : next.aprovado_em,
      }).eq("id", next.id);
      if (error) throw error;
      if (changedFields.length > 0 && next.tenant_id) {
        await sb.from("pedido_logs").insert(changedFields.map((c) => ({
          pedido_id: next.id, tenant_id: next.tenant_id,
          campo: c.campo, valor_anterior: c.valor_anterior, valor_novo: c.valor_novo, alterado_por: user.id,
        })));
      }
      serverSnapshotRef.current = next;
      setSaveState("saved");
      setTimeout(() => setSaveState((s) => (s === "saved" ? "idle" : s)), 1500);
    } catch (err: any) {
      setSaveState("error");
      toast.error("Erro ao salvar", { description: err.message });
    }
  }, 800);

  const updatePedido = (patch: Partial<Pedido>) => {
    setPedido((curr) => {
      if (!curr) return curr;
      const next = { ...curr, ...patch };
      persist(next);
      return next;
    });
  };

  const recomputeTotalItem = (item: PedidoItem): number => {
    const q = Number(item.quantidade ?? 0);
    const p = Number(item.preco_unitario ?? 0);
    const d = Number(item.desconto ?? 0);
    return Number((q * p * (1 - d / 100)).toFixed(2));
  };

  const updateItemLocal = (itemId: string, patch: Partial<PedidoItem>) => {
    setItens((curr) => curr.map((it) => {
      if (it.id !== itemId) return it;
      const merged = { ...it, ...patch };
      merged.preco_total = recomputeTotalItem(merged);
      return merged;
    }));
  };

  const persistItem = useDebouncedCallback(async (item: PedidoItem) => {
    try {
      const sb = supabase as any;
      const { error } = await sb.from("pedido_itens").update({
        numero_item: item.numero_item, codigo_cliente: item.codigo_cliente,
        descricao: item.descricao, referencia: item.referencia, ean: item.ean,
        part_number: item.part_number, marca: item.marca, modelo: item.modelo,
        cor: item.cor, tamanho: item.tamanho, grade: item.grade,
        codigo_produto_erp: item.codigo_produto_erp, unidade_medida: item.unidade_medida,
        quantidade: item.quantidade, quantidade_minima: item.quantidade_minima,
        multiplo_venda: item.multiplo_venda, data_entrega_item: item.data_entrega_item,
        preco_unitario: item.preco_unitario, desconto: item.desconto,
        desconto_comercial: item.desconto_comercial, desconto_adicional_item: item.desconto_adicional_item,
        ipi_item_percentual: item.ipi_item_percentual, valor_ipi_item: item.valor_ipi_item,
        icms_st_item_percentual: item.icms_st_item_percentual, valor_icms_st_item: item.valor_icms_st_item,
        base_calculo_st_item: item.base_calculo_st_item, vendor_item: item.vendor_item,
        preco_total: item.preco_total, preco_total_com_impostos: item.preco_total_com_impostos,
        peso_bruto_item: item.peso_bruto_item, peso_liquido_item: item.peso_liquido_item,
        volume_item: item.volume_item, ncm_item: item.ncm_item, cfop_item: item.cfop_item,
        numero_serie: item.numero_serie, lote: item.lote, data_validade: item.data_validade,
        registro_anvisa: item.registro_anvisa, aplicacao: item.aplicacao,
        cultura_destino: item.cultura_destino, principio_ativo: item.principio_ativo,
        concentracao: item.concentracao, registro_mapa: item.registro_mapa,
        composicao: item.composicao, shelf_life_dias: item.shelf_life_dias,
        temperatura_conservacao: item.temperatura_conservacao,
        codigo_marketplace: item.codigo_marketplace, numero_empenho: item.numero_empenho,
        codigo_catmat: item.codigo_catmat, observacao_item: item.observacao_item,
      }).eq("id", item.id);
      if (error) throw error;
    } catch (err: any) {
      toast.error("Erro ao salvar item", { description: err.message });
    }
  }, 800);

  const handleItemChange = (itemId: string, patch: Partial<PedidoItem>) => {
    updateItemLocal(itemId, patch);
    const updated = itens.find((it) => it.id === itemId);
    if (updated) {
      const merged = { ...updated, ...patch };
      merged.preco_total = recomputeTotalItem(merged);
      persistItem(merged);
    }
  };

  const handleAddItem = async () => {
    if (!pedido || !tenantId) return;
    try {
      const sb = supabase as any;
      const { data, error } = await sb.from("pedido_itens").insert({
        pedido_id: pedido.id, tenant_id: pedido.tenant_id,
        numero_item: itens.length + 1, descricao: "", quantidade: 1, preco_unitario: 0, preco_total: 0,
      }).select().single();
      if (error) throw error;
      setItens((curr) => [...curr, data as unknown as PedidoItem]);
    } catch (err: any) {
      toast.error("Erro ao adicionar item", { description: err.message });
    }
  };

  const handleRemoveItem = async (itemId: string) => {
    try {
      const { error } = await supabase.from("pedido_itens").delete().eq("id", itemId);
      if (error) throw error;
      setItens((curr) => curr.filter((it) => it.id !== itemId));
    } catch (err: any) {
      toast.error("Erro ao remover item", { description: err.message });
    }
  };

  const totalItens = useMemo(() => itens.reduce((acc, it) => acc + Number(it.preco_total ?? 0), 0), [itens]);

  const handleAprovar = async () => {
    if (!pedido) return;
    updatePedido({ status: "aprovado", aprovado_por: user?.id ?? null, aprovado_em: new Date().toISOString() });
    toast.success("Pedido aprovado com sucesso!");
  };

  const handleArquivarDuplicado = () => {
    if (!pedido) return;
    updatePedido({ status: "ignorado" });
    toast.success("Pedido arquivado como duplicado");
  };

  const handleMarcarComoNovo = () => {
    if (!pedido) return;
    updatePedido({ status: "pendente" });
    toast.success("Pedido voltou para revisão como novo");
  };

  const handleReprovar = async () => {
    if (!pedido) return;
    if (!motivoReprovacao.trim()) { toast.error("Informe o motivo da reprovação"); return; }
    updatePedido({ status: "reprovado", motivo_reprovacao: motivoReprovacao });
    setShowReprovacao(false); setMotivoReprovacao("");
    toast.success("Pedido reprovado");
  };

  const handleBaixarPdf = () => {
    if (!pedido?.pdf_url) { toast.error("PDF original não disponível para este pedido"); return; }
    window.open(pedido.pdf_url, "_blank");
    toast.success("PDF aberto em nova aba");
  };

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!pedido) return null;

  const deParaLogs = logs.filter((l) => l.campo?.startsWith("de_para_aplicado"));

  return (
    <div key={pedido.id} className="mx-auto w-full max-w-[1400px] px-8 py-8">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Link to="/dashboard" className="mb-2 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Voltar ao dashboard
          </Link>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Pedido {pedido.numero_pedido_cliente ?? pedido.numero ?? "-"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Recebido em {dataHora(pedido.created_at)}
            {pedido.email_remetente ? ` · de ${pedido.email_remetente}` : ""}
          </p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-3">
          <SaveIndicator state={saveState} />
          {pedido.confianca_ia != null && <ConfiancaBadge valor={Math.round(Number(pedido.confianca_ia) * 100)} />}
          {pedido.pdf_url && (
            <Button variant="outline" onClick={handleBaixarPdf} className="gap-2">
              <Download className="h-4 w-4" /> Baixar PDF
            </Button>
          )}
          {pendentesCount > 0 && (
            <Button
              variant="outline"
              onClick={() => setShowResolverCodigos(true)}
              className="gap-2 border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"
            >
              <Boxes className="h-4 w-4" />
              Resolver códigos novos ({pendentesCount})
            </Button>
          )}
          {pedido.status === "duplicado" ? (
            <>
              <Button
                variant="outline"
                onClick={handleArquivarDuplicado}
                className="gap-2"
              >
                <Archive className="h-4 w-4" /> Arquivar
              </Button>
              <Button onClick={handleMarcarComoNovo} className="gap-2">
                <FileCheck2 className="h-4 w-4" /> Marcar como pedido novo
              </Button>
            </>
          ) : (
            <>
              {pedido.status !== "reprovado" && (
                <Button variant="outline" onClick={() => setShowReprovacao(true)} className="gap-2 border-destructive/40 text-destructive hover:bg-destructive/10">
                  <XCircle className="h-4 w-4" /> Reprovar
                </Button>
              )}
              <Button onClick={handleAprovar} disabled={pedido.status === "aprovado"} className="gap-2">
                <CheckCircle2 className="h-4 w-4" /> Aprovar pedido
              </Button>
            </>
          )}
        </div>
      </div>

      {pedido.status === "duplicado" && (
        <div className="mb-6 flex items-start gap-3 rounded-lg border border-status-duplicado/30 bg-status-duplicado-soft px-4 py-3 text-sm">
          <Copy className="mt-0.5 h-4 w-4 flex-shrink-0 text-status-duplicado" />
          <div className="flex-1">
            <div className="font-semibold text-status-duplicado">Pedido marcado como duplicado</div>
            <p className="mt-1 text-xs text-status-duplicado/90">
              O sistema detectou um pedido com o mesmo PDF (impressão digital) ou com o mesmo número e CNPJ de comprador.
              Confirme arquivando ou marque como pedido novo se for um caso legítimo.
            </p>
          </div>
        </div>
      )}

      <ResolverCodigosNovosModal
        open={showResolverCodigos}
        onOpenChange={setShowResolverCodigos}
        pedidoId={pedido.id}
        tenantId={pedido.tenant_id}
        onResolvido={async () => {
          const sb = supabase as any;
          const { count } = await sb
            .from("pedido_itens_pendentes_de_para")
            .select("id", { count: "exact", head: true })
            .eq("pedido_id", pedido.id)
            .eq("resolvido", false);
          setPendentesCount(count ?? 0);
          const { data: pedRow } = await sb.from("pedidos").select("status").eq("id", pedido.id).maybeSingle();
          const { data: itensRow } = await sb.from("pedido_itens").select("*").eq("pedido_id", pedido.id).order("numero_item", { ascending: true });
          if (pedRow) setPedido((curr) => curr ? { ...curr, status: (pedRow as any).status } : curr);
          if (itensRow) setItens(itensRow as unknown as PedidoItem[]);
        }}
      />

      {/* Modal reprovação */}
      {showReprovacao && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl">
            <h3 className="mb-1 text-lg font-semibold text-foreground">Reprovar pedido</h3>
            <p className="mb-4 text-sm text-muted-foreground">Informe o motivo da reprovação. O cliente será notificado.</p>
            <Textarea value={motivoReprovacao} onChange={(e) => setMotivoReprovacao(e.target.value)} placeholder="Ex: Produto fora de estoque..." rows={3} className="mb-4" />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setShowReprovacao(false); setMotivoReprovacao(""); }}>Cancelar</Button>
              <Button onClick={handleReprovar} className="gap-2 bg-destructive text-destructive-foreground hover:bg-destructive/90">
                <XCircle className="h-4 w-4" /> Confirmar reprovação
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">

          {/* DE-PARA — PRIMEIRO E MAIS IMPORTANTE */}
          {deParaLogs.length > 0 && (
            <section className="rounded-xl border border-success/40 bg-success/5 shadow-softeum-sm">
              <div className="flex items-center gap-2 border-b border-success/30 px-6 py-4">
                <CheckCircle2 className="h-5 w-5 text-success" />
                <div>
                  <h2 className="text-base font-semibold text-foreground">DE-PARA aplicado automaticamente</h2>
                  <p className="text-xs text-muted-foreground">
                    {deParaLogs.length} substituição{deParaLogs.length === 1 ? "" : "ões"} realizada{deParaLogs.length === 1 ? "" : "s"}
                  </p>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-success/10 text-xs uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="w-20 px-4 py-3 text-left font-medium">Nº Item</th>
                      <th className="px-4 py-3 text-left font-medium">Campo</th>
                      <th className="px-4 py-3 text-left font-medium">Original</th>
                      <th className="px-4 py-3 text-left font-medium">Convertido</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-success/20">
                    {deParaLogs.map((log) => {
                      const partes = log.campo.split(":");
                      const nItem = partes[1] ?? "-";
                      const campoNome = partes[2] ?? log.campo;
                      return (
                        <tr key={log.id} className="hover:bg-success/10">
                          <td className="px-4 py-3 font-medium tabular-nums">{nItem}</td>
                          <td className="px-4 py-3 text-foreground">{campoNome}</td>
                          <td className="px-4 py-3 text-muted-foreground line-through">{log.valor_anterior ?? "—"}</td>
                          <td className="px-4 py-3 font-medium">
                            <span className="rounded-md bg-success/15 px-2 py-0.5 text-success">{log.valor_novo ?? "—"}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Identificação do pedido */}
          <section className="rounded-xl border border-border bg-card p-6 shadow-softeum-sm">
            <h2 className="mb-4 text-base font-semibold text-foreground">Identificação do pedido</h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label="Empresa / Cliente">
                <Input value={pedido.empresa ?? ""} onChange={(e) => updatePedido({ empresa: e.target.value })} placeholder="Nome da empresa" />
              </Field>
              <Field label="CNPJ">
                <Input value={pedido.cnpj ?? ""} onChange={(e) => updatePedido({ cnpj: e.target.value })} placeholder="00.000.000/0000-00" />
              </Field>
              <Field label="Status">
                <Select value={pedido.status} onValueChange={(v) => updatePedido({ status: v as StatusPedido })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pendente">Pendente</SelectItem>
                    <SelectItem value="aprovado">Aprovado</SelectItem>
                    <SelectItem value="reprovado">Reprovado</SelectItem>
                    <SelectItem value="erro">Erro IA</SelectItem>
                    <SelectItem value="duplicado">Duplicado</SelectItem>
                    <SelectItem value="ignorado">Ignorado</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Data de emissão">
                <Input type="date" value={pedido.data_emissao ?? ""} onChange={(e) => updatePedido({ data_emissao: e.target.value || null })} />
              </Field>
              <Field label="Data de entrega solicitada">
                <Input type="date" value={pedido.data_entrega_solicitada ?? ""} onChange={(e) => updatePedido({ data_entrega_solicitada: e.target.value || null })} />
              </Field>
              <Field label="Valor total">
                <Input type="number" step="0.01" value={pedido.valor_total ?? ""} onChange={(e) => updatePedido({ valor_total: e.target.value === "" ? null : Number(e.target.value) })} placeholder="0,00" />
              </Field>

              {/* Campos opcionais — aparecem só se tiverem dados */}
              {pedido.numero_pedido_fornecedor && (
                <CampoOpcional label="Nº pedido fornecedor" value={pedido.numero_pedido_fornecedor}>
                  <Input value={pedido.numero_pedido_fornecedor ?? ""} onChange={(e) => updatePedido({ numero_pedido_fornecedor: e.target.value })} />
                </CampoOpcional>
              )}
              {pedido.numero_edi && (
                <CampoOpcional label="Número EDI" value={pedido.numero_edi}>
                  <Input value={pedido.numero_edi ?? ""} onChange={(e) => updatePedido({ numero_edi: e.target.value })} />
                </CampoOpcional>
              )}
              {pedido.tipo_pedido && (
                <CampoOpcional label="Tipo do pedido" value={pedido.tipo_pedido}>
                  <Input value={pedido.tipo_pedido ?? ""} onChange={(e) => updatePedido({ tipo_pedido: e.target.value })} />
                </CampoOpcional>
              )}
              {pedido.canal_venda && (
                <CampoOpcional label="Canal de venda" value={pedido.canal_venda}>
                  <Input value={pedido.canal_venda ?? ""} onChange={(e) => updatePedido({ canal_venda: e.target.value })} />
                </CampoOpcional>
              )}
              {pedido.campanha && (
                <CampoOpcional label="Campanha / Promoção" value={pedido.campanha}>
                  <Input value={pedido.campanha ?? ""} onChange={(e) => updatePedido({ campanha: e.target.value })} />
                </CampoOpcional>
              )}
              {pedido.numero_contrato && (
                <CampoOpcional label="Nº contrato / acordo" value={pedido.numero_contrato}>
                  <Input value={pedido.numero_contrato ?? ""} onChange={(e) => updatePedido({ numero_contrato: e.target.value })} />
                </CampoOpcional>
              )}
              {pedido.numero_cotacao && (
                <CampoOpcional label="Nº cotação" value={pedido.numero_cotacao}>
                  <Input value={pedido.numero_cotacao ?? ""} onChange={(e) => updatePedido({ numero_cotacao: e.target.value })} />
                </CampoOpcional>
              )}
              {pedido.numero_nf_referencia && (
                <CampoOpcional label="Nº NF referência" value={pedido.numero_nf_referencia}>
                  <Input value={pedido.numero_nf_referencia ?? ""} onChange={(e) => updatePedido({ numero_nf_referencia: e.target.value })} />
                </CampoOpcional>
              )}
              {pedido.validade_proposta && (
                <CampoOpcional label="Validade da proposta" value={pedido.validade_proposta}>
                  <Input value={pedido.validade_proposta ?? ""} onChange={(e) => updatePedido({ validade_proposta: e.target.value })} />
                </CampoOpcional>
              )}
              {pedido.data_limite_entrega && (
                <CampoOpcional label="Data limite entrega" value={pedido.data_limite_entrega}>
                  <Input type="date" value={pedido.data_limite_entrega ?? ""} onChange={(e) => updatePedido({ data_limite_entrega: e.target.value })} />
                </CampoOpcional>
              )}
            </div>
          </section>

          {/* Comprador */}
          <section className="rounded-xl border border-border bg-card p-6 shadow-softeum-sm">
            <h2 className="mb-4 text-base font-semibold text-foreground">Comprador</h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label="E-mail remetente">
                <Input type="email" value={pedido.email_remetente ?? ""} onChange={(e) => updatePedido({ email_remetente: e.target.value })} placeholder="contato@empresa.com" />
              </Field>
              <Field label="Nome do comprador">
                <Input value={pedido.nome_comprador ?? ""} onChange={(e) => updatePedido({ nome_comprador: e.target.value })} placeholder="Nome do comprador" />
              </Field>
              <Field label="E-mail do comprador">
                <Input type="email" value={pedido.email_comprador ?? ""} onChange={(e) => updatePedido({ email_comprador: e.target.value })} placeholder="comprador@empresa.com" />
              </Field>
              <Field label="Telefone do comprador">
                <Input value={pedido.telefone_comprador ?? ""} onChange={(e) => updatePedido({ telefone_comprador: e.target.value })} placeholder="(11) 99999-9999" />
              </Field>
              {pedido.nome_fantasia_cliente && (
                <CampoOpcional label="Nome fantasia" value={pedido.nome_fantasia_cliente}>
                  <Input value={pedido.nome_fantasia_cliente ?? ""} onChange={(e) => updatePedido({ nome_fantasia_cliente: e.target.value })} />
                </CampoOpcional>
              )}
              {pedido.inscricao_estadual_cliente && (
                <CampoOpcional label="Inscrição estadual" value={pedido.inscricao_estadual_cliente}>
                  <Input value={pedido.inscricao_estadual_cliente ?? ""} onChange={(e) => updatePedido({ inscricao_estadual_cliente: e.target.value })} />
                </CampoOpcional>
              )}
              {pedido.codigo_comprador && (
                <CampoOpcional label="Código do comprador" value={pedido.codigo_comprador}>
                  <Input value={pedido.codigo_comprador ?? ""} onChange={(e) => updatePedido({ codigo_comprador: e.target.value })} />
                </CampoOpcional>
              )}
              {pedido.departamento_comprador && (
                <CampoOpcional label="Departamento" value={pedido.departamento_comprador}>
                  <Input value={pedido.departamento_comprador ?? ""} onChange={(e) => updatePedido({ departamento_comprador: e.target.value })} />
                </CampoOpcional>
              )}
            </div>
          </section>

          {/* Fornecedor — só aparece se tiver dados */}
          {(pedido.razao_social_fornecedor || pedido.cnpj_fornecedor || pedido.codigo_fornecedor) && (
            <section className="rounded-xl border border-border bg-card p-6 shadow-softeum-sm">
              <h2 className="mb-4 text-base font-semibold text-foreground">Fornecedor</h2>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {pedido.razao_social_fornecedor && (
                  <CampoOpcional label="Razão social" value={pedido.razao_social_fornecedor}>
                    <Input value={pedido.razao_social_fornecedor ?? ""} onChange={(e) => updatePedido({ razao_social_fornecedor: e.target.value })} />
                  </CampoOpcional>
                )}
                {pedido.cnpj_fornecedor && (
                  <CampoOpcional label="CNPJ fornecedor" value={pedido.cnpj_fornecedor}>
                    <Input value={pedido.cnpj_fornecedor ?? ""} onChange={(e) => updatePedido({ cnpj_fornecedor: e.target.value })} />
                  </CampoOpcional>
                )}
                {pedido.codigo_fornecedor && (
                  <CampoOpcional label="Código do fornecedor" value={pedido.codigo_fornecedor}>
                    <Input value={pedido.codigo_fornecedor ?? ""} onChange={(e) => updatePedido({ codigo_fornecedor: e.target.value })} />
                  </CampoOpcional>
                )}
              </div>
            </section>
          )}

          {/* Entrega */}
          <section className="rounded-xl border border-border bg-card p-6 shadow-softeum-sm">
            <h2 className="mb-4 text-base font-semibold text-foreground">Entrega</h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="md:col-span-2">
                <Field label="Endereço">
                  <Input value={pedido.endereco_entrega ?? ""} onChange={(e) => updatePedido({ endereco_entrega: e.target.value })} placeholder="Rua, número, complemento" />
                </Field>
              </div>
              <Field label="Cidade">
                <Input value={pedido.cidade_entrega ?? ""} onChange={(e) => updatePedido({ cidade_entrega: e.target.value })} placeholder="Cidade" />
              </Field>
              <Field label="Estado (UF)">
                <Input value={pedido.estado_entrega ?? ""} onChange={(e) => updatePedido({ estado_entrega: e.target.value })} placeholder="SP" maxLength={2} />
              </Field>
              <Field label="CEP">
                <Input value={pedido.cep_entrega ?? ""} onChange={(e) => updatePedido({ cep_entrega: e.target.value })} placeholder="00000-000" />
              </Field>
              <Field label="Tipo de frete">
                <Input value={pedido.tipo_frete ?? ""} onChange={(e) => updatePedido({ tipo_frete: e.target.value })} placeholder="CIF / FOB" />
              </Field>
              {pedido.bairro_entrega && <CampoOpcional label="Bairro" value={pedido.bairro_entrega}><Input value={pedido.bairro_entrega ?? ""} onChange={(e) => updatePedido({ bairro_entrega: e.target.value })} /></CampoOpcional>}
              {pedido.local_entrega && <CampoOpcional label="Local de entrega" value={pedido.local_entrega}><Input value={pedido.local_entrega ?? ""} onChange={(e) => updatePedido({ local_entrega: e.target.value })} /></CampoOpcional>}
              {pedido.transportadora && <CampoOpcional label="Transportadora" value={pedido.transportadora}><Input value={pedido.transportadora ?? ""} onChange={(e) => updatePedido({ transportadora: e.target.value })} /></CampoOpcional>}
              {pedido.valor_frete && <CampoOpcional label="Valor do frete" value={pedido.valor_frete}><Input type="number" step="0.01" value={pedido.valor_frete ?? ""} onChange={(e) => updatePedido({ valor_frete: e.target.value === "" ? null : Number(e.target.value) })} /></CampoOpcional>}
              {pedido.prazo_entrega_dias && <CampoOpcional label="Prazo de entrega (dias)" value={pedido.prazo_entrega_dias}><Input type="number" value={pedido.prazo_entrega_dias ?? ""} onChange={(e) => updatePedido({ prazo_entrega_dias: e.target.value === "" ? null : Number(e.target.value) })} /></CampoOpcional>}
              {pedido.peso_total_bruto && <CampoOpcional label="Peso bruto total (kg)" value={pedido.peso_total_bruto}><Input type="number" step="0.01" value={pedido.peso_total_bruto ?? ""} onChange={(e) => updatePedido({ peso_total_bruto: e.target.value === "" ? null : Number(e.target.value) })} /></CampoOpcional>}
              {pedido.peso_total_liquido && <CampoOpcional label="Peso líquido total (kg)" value={pedido.peso_total_liquido}><Input type="number" step="0.01" value={pedido.peso_total_liquido ?? ""} onChange={(e) => updatePedido({ peso_total_liquido: e.target.value === "" ? null : Number(e.target.value) })} /></CampoOpcional>}
              {pedido.volume_total && <CampoOpcional label="Volume total (m³)" value={pedido.volume_total}><Input type="number" step="0.01" value={pedido.volume_total ?? ""} onChange={(e) => updatePedido({ volume_total: e.target.value === "" ? null : Number(e.target.value) })} /></CampoOpcional>}
              {pedido.quantidade_volumes && <CampoOpcional label="Qtd. volumes/caixas" value={pedido.quantidade_volumes}><Input type="number" value={pedido.quantidade_volumes ?? ""} onChange={(e) => updatePedido({ quantidade_volumes: e.target.value === "" ? null : Number(e.target.value) })} /></CampoOpcional>}
              {pedido.instrucoes_entrega && (
                <div className="md:col-span-2">
                  <CampoOpcional label="Instruções de entrega" value={pedido.instrucoes_entrega}>
                    <Textarea value={pedido.instrucoes_entrega ?? ""} onChange={(e) => updatePedido({ instrucoes_entrega: e.target.value })} rows={2} />
                  </CampoOpcional>
                </div>
              )}
            </div>
          </section>

          {/* Financeiro */}
          <section className="rounded-xl border border-border bg-card p-6 shadow-softeum-sm">
            <h2 className="mb-4 text-base font-semibold text-foreground">Financeiro</h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label="Condição de pagamento">
                <Input value={pedido.condicao_pagamento ?? ""} onChange={(e) => updatePedido({ condicao_pagamento: e.target.value })} placeholder="Ex: 30/60/90" />
              </Field>
              {pedido.forma_pagamento && <CampoOpcional label="Forma de pagamento" value={pedido.forma_pagamento}><Input value={pedido.forma_pagamento ?? ""} onChange={(e) => updatePedido({ forma_pagamento: e.target.value })} /></CampoOpcional>}
              {pedido.prazo_pagamento_dias && <CampoOpcional label="Prazo (dias)" value={pedido.prazo_pagamento_dias}><Input type="number" value={pedido.prazo_pagamento_dias ?? ""} onChange={(e) => updatePedido({ prazo_pagamento_dias: e.target.value === "" ? null : Number(e.target.value) })} /></CampoOpcional>}
              {pedido.desconto_canal && <CampoOpcional label="Desconto canal (%)" value={pedido.desconto_canal}><Input type="number" step="0.01" value={pedido.desconto_canal ?? ""} onChange={(e) => updatePedido({ desconto_canal: e.target.value === "" ? null : Number(e.target.value) })} /></CampoOpcional>}
              {pedido.desconto_financeiro && <CampoOpcional label="Desconto financeiro (%)" value={pedido.desconto_financeiro}><Input type="number" step="0.01" value={pedido.desconto_financeiro ?? ""} onChange={(e) => updatePedido({ desconto_financeiro: e.target.value === "" ? null : Number(e.target.value) })} /></CampoOpcional>}
              {pedido.desconto_adicional && <CampoOpcional label="Desconto adicional (%)" value={pedido.desconto_adicional}><Input type="number" step="0.01" value={pedido.desconto_adicional ?? ""} onChange={(e) => updatePedido({ desconto_adicional: e.target.value === "" ? null : Number(e.target.value) })} /></CampoOpcional>}
              {pedido.numero_acordo && <CampoOpcional label="Nro. Acordo" value={pedido.numero_acordo}><Input value={pedido.numero_acordo ?? ""} onChange={(e) => updatePedido({ numero_acordo: e.target.value })} /></CampoOpcional>}
              {pedido.vendor && <CampoOpcional label="Vendor / Verba" value={pedido.vendor}><Input value={pedido.vendor ?? ""} onChange={(e) => updatePedido({ vendor: e.target.value })} /></CampoOpcional>}
              {pedido.rebate && <CampoOpcional label="Rebate (%)" value={pedido.rebate}><Input type="number" step="0.01" value={pedido.rebate ?? ""} onChange={(e) => updatePedido({ rebate: e.target.value === "" ? null : Number(e.target.value) })} /></CampoOpcional>}
              {pedido.valor_entrada && <CampoOpcional label="Valor de entrada / sinal" value={pedido.valor_entrada}><Input type="number" step="0.01" value={pedido.valor_entrada ?? ""} onChange={(e) => updatePedido({ valor_entrada: e.target.value === "" ? null : Number(e.target.value) })} /></CampoOpcional>}
              {pedido.instrucoes_faturamento && (
                <div className="md:col-span-2">
                  <CampoOpcional label="Instruções de faturamento" value={pedido.instrucoes_faturamento}>
                    <Textarea value={pedido.instrucoes_faturamento ?? ""} onChange={(e) => updatePedido({ instrucoes_faturamento: e.target.value })} rows={2} />
                  </CampoOpcional>
                </div>
              )}
            </div>
          </section>

          {/* Fiscal — só aparece se tiver algum dado fiscal */}
          {(pedido.ipi_percentual || pedido.icms_st_percentual || pedido.cfop || pedido.natureza_operacao || pedido.ncm || pedido.mva_percentual || pedido.pis_percentual || pedido.cofins_percentual) && (
            <section className="rounded-xl border border-border bg-card p-6 shadow-softeum-sm">
              <h2 className="mb-4 text-base font-semibold text-foreground">Fiscal</h2>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {pedido.ipi_percentual && <CampoOpcional label="IPI (%)" value={pedido.ipi_percentual}><Input type="number" step="0.01" value={pedido.ipi_percentual ?? ""} onChange={(e) => updatePedido({ ipi_percentual: e.target.value === "" ? null : Number(e.target.value) })} /></CampoOpcional>}
                {pedido.valor_ipi && <CampoOpcional label="Valor IPI" value={pedido.valor_ipi}><Input type="number" step="0.01" value={pedido.valor_ipi ?? ""} onChange={(e) => updatePedido({ valor_ipi: e.target.value === "" ? null : Number(e.target.value) })} /></CampoOpcional>}
                {pedido.icms_st_percentual && <CampoOpcional label="ICMS ST (%)" value={pedido.icms_st_percentual}><Input type="number" step="0.01" value={pedido.icms_st_percentual ?? ""} onChange={(e) => updatePedido({ icms_st_percentual: e.target.value === "" ? null : Number(e.target.value) })} /></CampoOpcional>}
                {pedido.valor_icms_st && <CampoOpcional label="Valor ICMS ST" value={pedido.valor_icms_st}><Input type="number" step="0.01" value={pedido.valor_icms_st ?? ""} onChange={(e) => updatePedido({ valor_icms_st: e.target.value === "" ? null : Number(e.target.value) })} /></CampoOpcional>}
                {pedido.base_calculo_st && <CampoOpcional label="Base cálculo ST" value={pedido.base_calculo_st}><Input type="number" step="0.01" value={pedido.base_calculo_st ?? ""} onChange={(e) => updatePedido({ base_calculo_st: e.target.value === "" ? null : Number(e.target.value) })} /></CampoOpcional>}
                {pedido.mva_percentual && <CampoOpcional label="MVA / IVA (%)" value={pedido.mva_percentual}><Input type="number" step="0.01" value={pedido.mva_percentual ?? ""} onChange={(e) => updatePedido({ mva_percentual: e.target.value === "" ? null : Number(e.target.value) })} /></CampoOpcional>}
                {pedido.cfop && <CampoOpcional label="CFOP" value={pedido.cfop}><Input value={pedido.cfop ?? ""} onChange={(e) => updatePedido({ cfop: e.target.value })} /></CampoOpcional>}
                {pedido.natureza_operacao && <CampoOpcional label="Natureza da operação" value={pedido.natureza_operacao}><Input value={pedido.natureza_operacao ?? ""} onChange={(e) => updatePedido({ natureza_operacao: e.target.value })} /></CampoOpcional>}
                {pedido.ncm && <CampoOpcional label="NCM" value={pedido.ncm}><Input value={pedido.ncm ?? ""} onChange={(e) => updatePedido({ ncm: e.target.value })} /></CampoOpcional>}
                {pedido.pis_percentual && <CampoOpcional label="PIS (%)" value={pedido.pis_percentual}><Input type="number" step="0.01" value={pedido.pis_percentual ?? ""} onChange={(e) => updatePedido({ pis_percentual: e.target.value === "" ? null : Number(e.target.value) })} /></CampoOpcional>}
                {pedido.cofins_percentual && <CampoOpcional label="COFINS (%)" value={pedido.cofins_percentual}><Input type="number" step="0.01" value={pedido.cofins_percentual ?? ""} onChange={(e) => updatePedido({ cofins_percentual: e.target.value === "" ? null : Number(e.target.value) })} /></CampoOpcional>}
              </div>
            </section>
          )}

          {/* Vendedor / Controle — só aparece se tiver algum dado */}
          {(pedido.nome_vendedor || pedido.codigo_vendedor || pedido.centro_custo || pedido.projeto_obra || pedido.responsavel_aprovacao) && (
            <section className="rounded-xl border border-border bg-card p-6 shadow-softeum-sm">
              <h2 className="mb-4 text-base font-semibold text-foreground">Controle interno</h2>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {pedido.nome_vendedor && <CampoOpcional label="Vendedor / Representante" value={pedido.nome_vendedor}><Input value={pedido.nome_vendedor ?? ""} onChange={(e) => updatePedido({ nome_vendedor: e.target.value })} /></CampoOpcional>}
                {pedido.codigo_vendedor && <CampoOpcional label="Código do vendedor" value={pedido.codigo_vendedor}><Input value={pedido.codigo_vendedor ?? ""} onChange={(e) => updatePedido({ codigo_vendedor: e.target.value })} /></CampoOpcional>}
                {pedido.centro_custo && <CampoOpcional label="Centro de custo" value={pedido.centro_custo}><Input value={pedido.centro_custo ?? ""} onChange={(e) => updatePedido({ centro_custo: e.target.value })} /></CampoOpcional>}
                {pedido.projeto_obra && <CampoOpcional label="Projeto / Obra" value={pedido.projeto_obra}><Input value={pedido.projeto_obra ?? ""} onChange={(e) => updatePedido({ projeto_obra: e.target.value })} /></CampoOpcional>}
                {pedido.responsavel_aprovacao && <CampoOpcional label="Responsável pela aprovação" value={pedido.responsavel_aprovacao}><Input value={pedido.responsavel_aprovacao ?? ""} onChange={(e) => updatePedido({ responsavel_aprovacao: e.target.value })} /></CampoOpcional>}
              </div>
            </section>
          )}

          {/* Observações */}
          <section className="rounded-xl border border-border bg-card p-6 shadow-softeum-sm">
            <h2 className="mb-4 text-base font-semibold text-foreground">Observações</h2>
            <Textarea value={pedido.observacoes_gerais ?? ""} onChange={(e) => updatePedido({ observacoes_gerais: e.target.value })} placeholder="Observações gerais do pedido" rows={4} />
            {pedido.status === "reprovado" && pedido.motivo_reprovacao && (
              <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                <span className="font-medium">Motivo da reprovação: </span>{pedido.motivo_reprovacao}
              </div>
            )}
          </section>

          {/* Itens do pedido */}
          <section className="rounded-xl border border-border bg-card shadow-softeum-sm">
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
              <div>
                <h2 className="text-base font-semibold text-foreground">Itens do pedido</h2>
                <p className="text-xs text-muted-foreground">{itens.length} {itens.length === 1 ? "item" : "itens"} · Total {brl(totalItens)}</p>
              </div>
              <Button variant="outline" size="sm" onClick={handleAddItem} className="gap-2">
                <Plus className="h-4 w-4" /> Adicionar item
              </Button>
            </div>

            <div className="space-y-4 p-6">
              {itens.length === 0 && (
                <div className="flex flex-col items-center justify-center py-12 text-center text-sm text-muted-foreground">
                  <AlertTriangle className="mx-auto mb-2 h-5 w-5 text-warning" />
                  Nenhum item neste pedido.
                </div>
              )}

              {itens.map((it, idx) => (
                <div key={it.id} className="rounded-lg border border-border bg-muted/10 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Item {it.numero_item ?? idx + 1}
                    </span>
                    <button type="button" onClick={() => handleRemoveItem(it.id)} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                    {/* Campos sempre visíveis nos itens */}
                    <Field label="Código do cliente">
                      <Input value={it.codigo_cliente ?? ""} onChange={(e) => handleItemChange(it.id, { codigo_cliente: e.target.value })} placeholder="Código" />
                    </Field>
                    <Field label="Código ERP">
                      <Input value={it.codigo_produto_erp ?? ""} onChange={(e) => handleItemChange(it.id, { codigo_produto_erp: e.target.value })} placeholder="Código ERP" />
                    </Field>
                    <Field label="Referência">
                      <Input value={it.referencia ?? ""} onChange={(e) => handleItemChange(it.id, { referencia: e.target.value })} placeholder="Referência / EAN" />
                    </Field>
                    <div className="lg:col-span-2">
                      <Field label="Descrição">
                        <Input value={it.descricao ?? ""} onChange={(e) => handleItemChange(it.id, { descricao: e.target.value })} placeholder="Descrição completa do produto" />
                      </Field>
                    </div>
                    <Field label="Marca">
                      <Input value={it.marca ?? ""} onChange={(e) => handleItemChange(it.id, { marca: e.target.value })} placeholder="Marca" />
                    </Field>
                    <Field label="Unidade">
                      <Input value={it.unidade_medida ?? ""} onChange={(e) => handleItemChange(it.id, { unidade_medida: e.target.value })} placeholder="UN, CX, KG..." />
                    </Field>
                    <Field label="Quantidade">
                      <Input type="number" step="0.01" value={it.quantidade ?? ""} onChange={(e) => handleItemChange(it.id, { quantidade: e.target.value === "" ? null : Number(e.target.value) })} placeholder="0" />
                    </Field>
                    <Field label="Preço unitário">
                      <Input type="number" step="0.01" value={it.preco_unitario ?? ""} onChange={(e) => handleItemChange(it.id, { preco_unitario: e.target.value === "" ? null : Number(e.target.value) })} placeholder="0,00" />
                    </Field>
                    <Field label="Desconto (%)">
                      <Input type="number" step="0.01" min="0" max="100" value={it.desconto ?? ""} onChange={(e) => handleItemChange(it.id, { desconto: e.target.value === "" ? null : Number(e.target.value) })} placeholder="0" />
                    </Field>
                    <Field label="Total do item">
                      <div className="flex h-10 items-center rounded-md border border-border bg-muted/30 px-3 text-sm font-semibold tabular-nums text-foreground">
                        {brl(it.preco_total)}
                      </div>
                    </Field>

                    {/* Campos opcionais dos itens */}
                    {it.ean && <CampoOpcional label="EAN / SKU" value={it.ean}><Input value={it.ean ?? ""} onChange={(e) => handleItemChange(it.id, { ean: e.target.value })} /></CampoOpcional>}
                    {it.part_number && <CampoOpcional label="Part Number" value={it.part_number}><Input value={it.part_number ?? ""} onChange={(e) => handleItemChange(it.id, { part_number: e.target.value })} /></CampoOpcional>}
                    {it.modelo && <CampoOpcional label="Modelo" value={it.modelo}><Input value={it.modelo ?? ""} onChange={(e) => handleItemChange(it.id, { modelo: e.target.value })} /></CampoOpcional>}
                    {it.cor && <CampoOpcional label="Cor" value={it.cor}><Input value={it.cor ?? ""} onChange={(e) => handleItemChange(it.id, { cor: e.target.value })} /></CampoOpcional>}
                    {it.tamanho && <CampoOpcional label="Tamanho" value={it.tamanho}><Input value={it.tamanho ?? ""} onChange={(e) => handleItemChange(it.id, { tamanho: e.target.value })} /></CampoOpcional>}
                    {it.grade && <CampoOpcional label="Grade" value={it.grade}><Input value={it.grade ?? ""} onChange={(e) => handleItemChange(it.id, { grade: e.target.value })} /></CampoOpcional>}
                    {it.data_entrega_item && <CampoOpcional label="Data entrega do item" value={it.data_entrega_item}><Input type="date" value={it.data_entrega_item ?? ""} onChange={(e) => handleItemChange(it.id, { data_entrega_item: e.target.value })} /></CampoOpcional>}
                    {it.quantidade_minima && <CampoOpcional label="Qtd. mínima (MOQ)" value={it.quantidade_minima}><Input type="number" step="0.01" value={it.quantidade_minima ?? ""} onChange={(e) => handleItemChange(it.id, { quantidade_minima: e.target.value === "" ? null : Number(e.target.value) })} /></CampoOpcional>}
                    {it.multiplo_venda && <CampoOpcional label="Múltiplo de venda" value={it.multiplo_venda}><Input type="number" step="0.01" value={it.multiplo_venda ?? ""} onChange={(e) => handleItemChange(it.id, { multiplo_venda: e.target.value === "" ? null : Number(e.target.value) })} /></CampoOpcional>}
                    {it.ipi_item_percentual && <CampoOpcional label="IPI (%)" value={it.ipi_item_percentual}><Input type="number" step="0.01" value={it.ipi_item_percentual ?? ""} onChange={(e) => handleItemChange(it.id, { ipi_item_percentual: e.target.value === "" ? null : Number(e.target.value) })} /></CampoOpcional>}
                    {it.valor_ipi_item && <CampoOpcional label="Valor IPI" value={it.valor_ipi_item}><Input type="number" step="0.01" value={it.valor_ipi_item ?? ""} onChange={(e) => handleItemChange(it.id, { valor_ipi_item: e.target.value === "" ? null : Number(e.target.value) })} /></CampoOpcional>}
                    {it.icms_st_item_percentual && <CampoOpcional label="ICMS ST (%)" value={it.icms_st_item_percentual}><Input type="number" step="0.01" value={it.icms_st_item_percentual ?? ""} onChange={(e) => handleItemChange(it.id, { icms_st_item_percentual: e.target.value === "" ? null : Number(e.target.value) })} /></CampoOpcional>}
                    {it.valor_icms_st_item && <CampoOpcional label="Valor ICMS ST" value={it.valor_icms_st_item}><Input type="number" step="0.01" value={it.valor_icms_st_item ?? ""} onChange={(e) => handleItemChange(it.id, { valor_icms_st_item: e.target.value === "" ? null : Number(e.target.value) })} /></CampoOpcional>}
                    {it.base_calculo_st_item && <CampoOpcional label="Base cálculo ST" value={it.base_calculo_st_item}><Input type="number" step="0.01" value={it.base_calculo_st_item ?? ""} onChange={(e) => handleItemChange(it.id, { base_calculo_st_item: e.target.value === "" ? null : Number(e.target.value) })} /></CampoOpcional>}
                    {it.desconto_comercial && <CampoOpcional label="Desc. comercial (%)" value={it.desconto_comercial}><Input type="number" step="0.01" value={it.desconto_comercial ?? ""} onChange={(e) => handleItemChange(it.id, { desconto_comercial: e.target.value === "" ? null : Number(e.target.value) })} /></CampoOpcional>}
                    {it.desconto_adicional_item && <CampoOpcional label="Desc. adicional (%)" value={it.desconto_adicional_item}><Input type="number" step="0.01" value={it.desconto_adicional_item ?? ""} onChange={(e) => handleItemChange(it.id, { desconto_adicional_item: e.target.value === "" ? null : Number(e.target.value) })} /></CampoOpcional>}
                    {it.vendor_item && <CampoOpcional label="Vendor / Verba" value={it.vendor_item}><Input value={it.vendor_item ?? ""} onChange={(e) => handleItemChange(it.id, { vendor_item: e.target.value })} /></CampoOpcional>}
                    {it.peso_bruto_item && <CampoOpcional label="Peso bruto (kg)" value={it.peso_bruto_item}><Input type="number" step="0.01" value={it.peso_bruto_item ?? ""} onChange={(e) => handleItemChange(it.id, { peso_bruto_item: e.target.value === "" ? null : Number(e.target.value) })} /></CampoOpcional>}
                    {it.peso_liquido_item && <CampoOpcional label="Peso líquido (kg)" value={it.peso_liquido_item}><Input type="number" step="0.01" value={it.peso_liquido_item ?? ""} onChange={(e) => handleItemChange(it.id, { peso_liquido_item: e.target.value === "" ? null : Number(e.target.value) })} /></CampoOpcional>}
                    {it.ncm_item && <CampoOpcional label="NCM" value={it.ncm_item}><Input value={it.ncm_item ?? ""} onChange={(e) => handleItemChange(it.id, { ncm_item: e.target.value })} /></CampoOpcional>}
                    {it.cfop_item && <CampoOpcional label="CFOP" value={it.cfop_item}><Input value={it.cfop_item ?? ""} onChange={(e) => handleItemChange(it.id, { cfop_item: e.target.value })} /></CampoOpcional>}
                    {it.lote && <CampoOpcional label="Lote" value={it.lote}><Input value={it.lote ?? ""} onChange={(e) => handleItemChange(it.id, { lote: e.target.value })} /></CampoOpcional>}
                    {it.numero_serie && <CampoOpcional label="Número de série" value={it.numero_serie}><Input value={it.numero_serie ?? ""} onChange={(e) => handleItemChange(it.id, { numero_serie: e.target.value })} /></CampoOpcional>}
                    {it.data_validade && <CampoOpcional label="Data de validade" value={it.data_validade}><Input type="date" value={it.data_validade ?? ""} onChange={(e) => handleItemChange(it.id, { data_validade: e.target.value })} /></CampoOpcional>}
                    {it.shelf_life_dias && <CampoOpcional label="Shelf life (dias)" value={it.shelf_life_dias}><Input type="number" value={it.shelf_life_dias ?? ""} onChange={(e) => handleItemChange(it.id, { shelf_life_dias: e.target.value === "" ? null : Number(e.target.value) })} /></CampoOpcional>}
                    {it.temperatura_conservacao && <CampoOpcional label="Temperatura conservação" value={it.temperatura_conservacao}><Input value={it.temperatura_conservacao ?? ""} onChange={(e) => handleItemChange(it.id, { temperatura_conservacao: e.target.value })} /></CampoOpcional>}
                    {it.registro_anvisa && <CampoOpcional label="Registro ANVISA" value={it.registro_anvisa}><Input value={it.registro_anvisa ?? ""} onChange={(e) => handleItemChange(it.id, { registro_anvisa: e.target.value })} /></CampoOpcional>}
                    {it.aplicacao && <CampoOpcional label="Aplicação" value={it.aplicacao}><Input value={it.aplicacao ?? ""} onChange={(e) => handleItemChange(it.id, { aplicacao: e.target.value })} /></CampoOpcional>}
                    {it.cultura_destino && <CampoOpcional label="Cultura de destino" value={it.cultura_destino}><Input value={it.cultura_destino ?? ""} onChange={(e) => handleItemChange(it.id, { cultura_destino: e.target.value })} /></CampoOpcional>}
                    {it.principio_ativo && <CampoOpcional label="Princípio ativo" value={it.principio_ativo}><Input value={it.principio_ativo ?? ""} onChange={(e) => handleItemChange(it.id, { principio_ativo: e.target.value })} /></CampoOpcional>}
                    {it.concentracao && <CampoOpcional label="Concentração" value={it.concentracao}><Input value={it.concentracao ?? ""} onChange={(e) => handleItemChange(it.id, { concentracao: e.target.value })} /></CampoOpcional>}
                    {it.registro_mapa && <CampoOpcional label="Registro MAPA" value={it.registro_mapa}><Input value={it.registro_mapa ?? ""} onChange={(e) => handleItemChange(it.id, { registro_mapa: e.target.value })} /></CampoOpcional>}
                    {it.composicao && <CampoOpcional label="Composição" value={it.composicao}><Input value={it.composicao ?? ""} onChange={(e) => handleItemChange(it.id, { composicao: e.target.value })} /></CampoOpcional>}
                    {it.codigo_marketplace && <CampoOpcional label="Código marketplace" value={it.codigo_marketplace}><Input value={it.codigo_marketplace ?? ""} onChange={(e) => handleItemChange(it.id, { codigo_marketplace: e.target.value })} /></CampoOpcional>}
                    {it.numero_empenho && <CampoOpcional label="Nº empenho" value={it.numero_empenho}><Input value={it.numero_empenho ?? ""} onChange={(e) => handleItemChange(it.id, { numero_empenho: e.target.value })} /></CampoOpcional>}
                    {it.codigo_catmat && <CampoOpcional label="CATMAT" value={it.codigo_catmat}><Input value={it.codigo_catmat ?? ""} onChange={(e) => handleItemChange(it.id, { codigo_catmat: e.target.value })} /></CampoOpcional>}

                    <div className="lg:col-span-3">
                      <Field label="Observação do item">
                        <Input value={it.observacao_item ?? ""} onChange={(e) => handleItemChange(it.id, { observacao_item: e.target.value })} placeholder="Observação específica deste item" />
                      </Field>
                    </div>
                  </div>
                </div>
              ))}

              {itens.length > 0 && (
                <div className="flex items-center justify-end rounded-lg border border-border bg-muted/20 px-4 py-3">
                  <span className="text-sm text-muted-foreground mr-4">Total geral</span>
                  <span className="text-lg font-bold tabular-nums text-foreground">{brl(totalItens)}</span>
                </div>
              )}
            </div>
          </section>
        </div>

        {/* Sidebar */}
        <aside className="space-y-6">
          <section className="rounded-xl border border-border bg-card p-6 shadow-softeum-sm">
            <div className="mb-4 flex items-center gap-2">
              <History className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-base font-semibold text-foreground">Histórico de alterações</h2>
            </div>
            <div className="space-y-3">
              {logs.length === 0 && <p className="text-xs text-muted-foreground">Nenhuma alteração registrada ainda.</p>}
              {logs.map((log) => (
                <div key={log.id} className="rounded-lg border border-border bg-background p-3 text-xs">
                  <div className="mb-1 flex items-center gap-1.5 text-muted-foreground">
                    <Clock className="h-3 w-3" /> {dataHora(log.created_at)}
                  </div>
                  <div className="font-medium text-foreground">{log.campo}</div>
                  <div className="mt-1 text-muted-foreground">
                    <span className="line-through">{log.valor_anterior ?? "—"}</span>
                    {" → "}
                    <span className="text-foreground">{log.valor_novo ?? "—"}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  if (state === "idle") return null;
  const config = {
    saving: { icon: Loader2, text: "Salvando...", className: "text-muted-foreground", spin: true },
    saved: { icon: CheckCircle2, text: "Salvo", className: "text-success", spin: false },
    error: { icon: AlertTriangle, text: "Erro ao salvar", className: "text-destructive", spin: false },
  }[state];
  const Icon = config.icon;
  return (
    <div className={`flex items-center gap-1.5 text-xs font-medium ${config.className}`}>
      <Icon className={`h-3.5 w-3.5 ${config.spin ? "animate-spin" : ""}`} />
      {config.text}
    </div>
  );
}
