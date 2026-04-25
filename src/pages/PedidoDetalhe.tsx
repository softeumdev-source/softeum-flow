import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Loader2,
  Plus,
  Trash2,
  CheckCircle2,
  Clock,
  History,
  AlertTriangle,
  XCircle,
  Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfiancaBadge } from "@/components/StatusBadge";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useDebouncedCallback } from "@/hooks/use-debounce";
import { toast } from "sonner";

type StatusPedido = "pendente" | "aprovado" | "reprovado" | "erro" | "duplicado" | "ignorado";

interface Pedido {
  id: string;
  tenant_id: string;
  numero: string | null;
  numero_pedido_cliente: string | null;
  empresa: string | null;
  cnpj: string | null;
  email_remetente: string | null;
  nome_comprador: string | null;
  email_comprador: string | null;
  telefone_comprador: string | null;
  data_emissao: string | null;
  data_entrega_solicitada: string | null;
  condicao_pagamento: string | null;
  tipo_frete: string | null;
  observacoes_gerais: string | null;
  endereco_entrega: string | null;
  cidade_entrega: string | null;
  estado_entrega: string | null;
  cep_entrega: string | null;
  valor_total: number | null;
  status: StatusPedido;
  confianca_ia: number | null;
  motivo_reprovacao: string | null;
  aprovado_por: string | null;
  aprovado_em: string | null;
  created_at: string | null;
  pdf_url: string | null;
}

interface PedidoItem {
  id: string;
  pedido_id: string;
  tenant_id: string;
  numero_item: number | null;
  codigo_cliente: string | null;
  descricao: string | null;
  referencia: string | null;
  marca: string | null;
  codigo_produto_erp: string | null;
  unidade_medida: string | null;
  quantidade: number | null;
  preco_unitario: number | null;
  desconto: number | null;
  preco_total: number | null;
  observacao_item: string | null;
}

interface PedidoLog {
  id: string;
  campo: string;
  valor_anterior: string | null;
  valor_novo: string | null;
  alterado_por: string | null;
  created_at: string | null;
}

type SaveState = "idle" | "saving" | "saved" | "error";

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
  const [baixandoPdf, setBaixandoPdf] = useState(false);

  const serverSnapshotRef = useRef<Pedido | null>(null);

  useEffect(() => {
    if (!id || !user) return;
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      try {
        const sb = supabase;
        const [pedRes, itensRes, logsRes] = await Promise.all([
          sb.from("pedidos").select("*").eq("id", id).maybeSingle(),
          sb
            .from("pedido_itens")
            .select("*")
            .eq("pedido_id", id)
            .order("numero_item", { ascending: true }),
          sb
            .from("pedido_logs")
            .select("*")
            .eq("pedido_id", id)
            .order("created_at", { ascending: false })
            .limit(50),
        ]);

        if (cancelled) return;

        if (pedRes.error) throw pedRes.error;
        if (!pedRes.data) {
          toast.error("Pedido não encontrado");
          navigate("/dashboard");
          return;
        }

        const p = pedRes.data as unknown as Pedido;
        setPedido(p);
        serverSnapshotRef.current = p;
        setItens((itensRes.data as unknown as PedidoItem[]) ?? []);
        setLogs((logsRes.data as unknown as PedidoLog[]) ?? []);
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
        "telefone_comprador", "data_emissao", "data_entrega_solicitada",
        "condicao_pagamento", "tipo_frete", "observacoes_gerais",
        "endereco_entrega", "cidade_entrega", "estado_entrega", "cep_entrega",
        "valor_total", "status", "motivo_reprovacao",
      ];

      if (prev) {
        for (const k of tracked) {
          const a = prev[k];
          const b = next[k];
          if ((a ?? null) !== (b ?? null)) {
            changedFields.push({
              campo: String(k),
              valor_anterior: a == null ? null : String(a),
              valor_novo: b == null ? null : String(b),
            });
          }
        }
      }

      const sb = supabase as any;
      const { error } = await sb.from("pedidos").update({
        empresa: next.empresa,
        cnpj: next.cnpj,
        email_remetente: next.email_remetente,
        nome_comprador: next.nome_comprador,
        email_comprador: next.email_comprador,
        telefone_comprador: next.telefone_comprador,
        data_emissao: next.data_emissao,
        data_entrega_solicitada: next.data_entrega_solicitada,
        condicao_pagamento: next.condicao_pagamento,
        tipo_frete: next.tipo_frete,
        observacoes_gerais: next.observacoes_gerais,
        endereco_entrega: next.endereco_entrega,
        cidade_entrega: next.cidade_entrega,
        estado_entrega: next.estado_entrega,
        cep_entrega: next.cep_entrega,
        valor_total: next.valor_total,
        status: next.status,
        motivo_reprovacao: next.motivo_reprovacao,
        aprovado_por: next.status === "aprovado" ? user.id : next.aprovado_por,
        aprovado_em: next.status === "aprovado" ? new Date().toISOString() : next.aprovado_em,
      }).eq("id", next.id);

      if (error) throw error;

      if (changedFields.length > 0 && next.tenant_id) {
        await sb.from("pedido_logs").insert(
          changedFields.map((c) => ({
            pedido_id: next.id,
            tenant_id: next.tenant_id,
            campo: c.campo,
            valor_anterior: c.valor_anterior,
            valor_novo: c.valor_novo,
            alterado_por: user.id,
          })),
        );
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
    const total = q * p * (1 - d / 100);
    return Number(total.toFixed(2));
  };

  const updateItemLocal = (itemId: string, patch: Partial<PedidoItem>) => {
    setItens((curr) =>
      curr.map((it) => {
        if (it.id !== itemId) return it;
        const merged = { ...it, ...patch };
        merged.preco_total = recomputeTotalItem(merged);
        return merged;
      }),
    );
  };

  const persistItem = useDebouncedCallback(async (item: PedidoItem) => {
    try {
      const sb = supabase as any;
      const { error } = await sb.from("pedido_itens").update({
        numero_item: item.numero_item,
        codigo_cliente: item.codigo_cliente,
        descricao: item.descricao,
        referencia: item.referencia,
        marca: item.marca,
        codigo_produto_erp: item.codigo_produto_erp,
        unidade_medida: item.unidade_medida,
        quantidade: item.quantidade,
        preco_unitario: item.preco_unitario,
        desconto: item.desconto,
        preco_total: item.preco_total,
        observacao_item: item.observacao_item,
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
      const proximoNumero = itens.length + 1;
      const { data, error } = await sb.from("pedido_itens").insert({
        pedido_id: pedido.id,
        tenant_id: pedido.tenant_id,
        numero_item: proximoNumero,
        descricao: "",
        quantidade: 1,
        preco_unitario: 0,
        preco_total: 0,
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

  const totalItens = useMemo(
    () => itens.reduce((acc, it) => acc + Number(it.preco_total ?? 0), 0),
    [itens],
  );

  const handleAprovar = async () => {
    if (!pedido) return;
    updatePedido({
      status: "aprovado",
      aprovado_por: user?.id ?? null,
      aprovado_em: new Date().toISOString(),
    });
    toast.success("Pedido aprovado com sucesso!");
  };

  const handleReprovar = async () => {
    if (!pedido) return;
    if (!motivoReprovacao.trim()) {
      toast.error("Informe o motivo da reprovação");
      return;
    }
    updatePedido({ status: "reprovado", motivo_reprovacao: motivoReprovacao });
    setShowReprovacao(false);
    setMotivoReprovacao("");
    toast.success("Pedido reprovado");
  };

 const handleBaixarPdf = () => {
    if (!pedido?.pdf_url) {
      toast.error("PDF original não disponível para este pedido");
      return;
    }
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

  return (
    <div key={pedido.id} className="mx-auto w-full max-w-[1400px] px-8 py-8">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Link
            to="/dashboard"
            className="mb-2 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar ao dashboard
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
          {pedido.confianca_ia != null && (
            <ConfiancaBadge valor={Math.round(Number(pedido.confianca_ia) * 100)} />
          )}
          {pedido.pdf_url && (
            <Button variant="outline" onClick={handleBaixarPdf} disabled={baixandoPdf} className="gap-2">
              {baixandoPdf ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Baixar PDF
            </Button>
          )}
          {pedido.status !== "reprovado" && (
            <Button
              variant="outline"
              onClick={() => setShowReprovacao(true)}
              className="gap-2 border-destructive/40 text-destructive hover:bg-destructive/10"
            >
              <XCircle className="h-4 w-4" />
              Reprovar
            </Button>
          )}
          <Button onClick={handleAprovar} disabled={pedido.status === "aprovado"} className="gap-2">
            <CheckCircle2 className="h-4 w-4" />
            Aprovar pedido
          </Button>
        </div>
      </div>

      {/* Modal reprovação */}
      {showReprovacao && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl">
            <h3 className="mb-1 text-lg font-semibold text-foreground">Reprovar pedido</h3>
            <p className="mb-4 text-sm text-muted-foreground">
              Informe o motivo da reprovação. O cliente será notificado.
            </p>
            <Textarea
              value={motivoReprovacao}
              onChange={(e) => setMotivoReprovacao(e.target.value)}
              placeholder="Ex: Produto fora de estoque, preço incorreto..."
              rows={3}
              className="mb-4"
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setShowReprovacao(false); setMotivoReprovacao(""); }}>
                Cancelar
              </Button>
              <Button
                onClick={handleReprovar}
                className="gap-2 bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                <XCircle className="h-4 w-4" />
                Confirmar reprovação
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">

          {/* Dados do pedido */}
          <section className="rounded-xl border border-border bg-card p-6 shadow-softeum-sm">
            <h2 className="mb-4 text-base font-semibold text-foreground">Dados do pedido</h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label="Empresa / Cliente">
                <Input value={pedido.empresa ?? ""} onChange={(e) => updatePedido({ empresa: e.target.value })} placeholder="Nome da empresa" />
              </Field>
              <Field label="CNPJ">
                <Input value={pedido.cnpj ?? ""} onChange={(e) => updatePedido({ cnpj: e.target.value })} placeholder="00.000.000/0000-00" />
              </Field>
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
              <Field label="Condição de pagamento">
                <Input value={pedido.condicao_pagamento ?? ""} onChange={(e) => updatePedido({ condicao_pagamento: e.target.value })} placeholder="Ex: 30/60/90" />
              </Field>
              <Field label="Tipo de frete">
                <Input value={pedido.tipo_frete ?? ""} onChange={(e) => updatePedido({ tipo_frete: e.target.value })} placeholder="CIF / FOB" />
              </Field>
              <Field label="Data de emissão">
                <Input type="date" value={pedido.data_emissao ?? ""} onChange={(e) => updatePedido({ data_emissao: e.target.value || null })} />
              </Field>
              <Field label="Data de entrega solicitada">
                <Input type="date" value={pedido.data_entrega_solicitada ?? ""} onChange={(e) => updatePedido({ data_entrega_solicitada: e.target.value || null })} />
              </Field>
              <Field label="Valor total">
                <Input
                  type="number" step="0.01"
                  value={pedido.valor_total ?? ""}
                  onChange={(e) => updatePedido({ valor_total: e.target.value === "" ? null : Number(e.target.value) })}
                  placeholder="0,00"
                />
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
            </div>
          </section>

          {/* Endereço de entrega */}
          <section className="rounded-xl border border-border bg-card p-6 shadow-softeum-sm">
            <h2 className="mb-4 text-base font-semibold text-foreground">Endereço de entrega</h2>
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
            </div>
          </section>

          {/* Observações */}
          <section className="rounded-xl border border-border bg-card p-6 shadow-softeum-sm">
            <h2 className="mb-4 text-base font-semibold text-foreground">Observações</h2>
            <Textarea
              value={pedido.observacoes_gerais ?? ""}
              onChange={(e) => updatePedido({ observacoes_gerais: e.target.value })}
              placeholder="Observações gerais do pedido"
              rows={4}
            />
            {pedido.status === "reprovado" && pedido.motivo_reprovacao && (
              <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                <span className="font-medium">Motivo da reprovação: </span>
                {pedido.motivo_reprovacao}
              </div>
            )}
          </section>

          {/* Itens do pedido */}
          <section className="rounded-xl border border-border bg-card shadow-softeum-sm">
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
              <div>
                <h2 className="text-base font-semibold text-foreground">Itens do pedido</h2>
                <p className="text-xs text-muted-foreground">
                  {itens.length} {itens.length === 1 ? "item" : "itens"} · Total {brl(totalItens)}
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={handleAddItem} className="gap-2">
                <Plus className="h-4 w-4" />
                Adicionar item
              </Button>
            </div>

            <div className="space-y-4 p-6">
              {itens.length === 0 && (
                <div className="flex flex-col items-center justify-center py-12 text-center text-sm text-muted-foreground">
                  <AlertTriangle className="mx-auto mb-2 h-5 w-5 text-warning" />
                  Nenhum item neste pedido. Clique em "Adicionar item" para começar.
                </div>
              )}

              {itens.map((it, idx) => (
                <div key={it.id} className="rounded-lg border border-border bg-muted/10 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Item {it.numero_item ?? idx + 1}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleRemoveItem(it.id)}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                    <Field label="Código do cliente">
                      <Input
                        value={it.codigo_cliente ?? ""}
                        onChange={(e) => handleItemChange(it.id, { codigo_cliente: e.target.value })}
                        placeholder="Código"
                      />
                    </Field>
                    <Field label="Código ERP">
                      <Input
                        value={it.codigo_produto_erp ?? ""}
                        onChange={(e) => handleItemChange(it.id, { codigo_produto_erp: e.target.value })}
                        placeholder="Código ERP"
                      />
                    </Field>
                    <Field label="Referência">
                      <Input
                        value={it.referencia ?? ""}
                        onChange={(e) => handleItemChange(it.id, { referencia: e.target.value })}
                        placeholder="Referência / código de barras"
                      />
                    </Field>
                    <div className="lg:col-span-2">
                      <Field label="Descrição">
                        <Input
                          value={it.descricao ?? ""}
                          onChange={(e) => handleItemChange(it.id, { descricao: e.target.value })}
                          placeholder="Descrição completa do produto"
                        />
                      </Field>
                    </div>
                    <Field label="Marca">
                      <Input
                        value={it.marca ?? ""}
                        onChange={(e) => handleItemChange(it.id, { marca: e.target.value })}
                        placeholder="Marca"
                      />
                    </Field>
                    <Field label="Unidade">
                      <Input
                        value={it.unidade_medida ?? ""}
                        onChange={(e) => handleItemChange(it.id, { unidade_medida: e.target.value })}
                        placeholder="UN, CX, KG..."
                      />
                    </Field>
                    <Field label="Quantidade">
                      <Input
                        type="number" step="0.01"
                        value={it.quantidade ?? ""}
                        onChange={(e) => handleItemChange(it.id, { quantidade: e.target.value === "" ? null : Number(e.target.value) })}
                        placeholder="0"
                      />
                    </Field>
                    <Field label="Preço unitário">
                      <Input
                        type="number" step="0.01"
                        value={it.preco_unitario ?? ""}
                        onChange={(e) => handleItemChange(it.id, { preco_unitario: e.target.value === "" ? null : Number(e.target.value) })}
                        placeholder="0,00"
                      />
                    </Field>
                    <Field label="Desconto (%)">
                      <Input
                        type="number" step="0.01" min="0" max="100"
                        value={it.desconto ?? ""}
                        onChange={(e) => handleItemChange(it.id, { desconto: e.target.value === "" ? null : Number(e.target.value) })}
                        placeholder="0"
                      />
                    </Field>
                    <Field label="Total do item">
                      <div className="flex h-10 items-center rounded-md border border-border bg-muted/30 px-3 text-sm font-semibold tabular-nums text-foreground">
                        {brl(it.preco_total)}
                      </div>
                    </Field>
                    <div className="lg:col-span-3">
                      <Field label="Observação do item">
                        <Input
                          value={it.observacao_item ?? ""}
                          onChange={(e) => handleItemChange(it.id, { observacao_item: e.target.value })}
                          placeholder="Observação específica deste item"
                        />
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

          {/* DE-PARA aplicado */}
          {(() => {
            const deParaLogs = logs.filter((l) => l.campo?.startsWith("de_para_aplicado"));
            if (deParaLogs.length === 0) return null;
            return (
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
            );
          })()}
        </div>

        {/* Sidebar */}
        <aside className="space-y-6">
          <section className="rounded-xl border border-border bg-card p-6 shadow-softeum-sm">
            <div className="mb-4 flex items-center gap-2">
              <History className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-base font-semibold text-foreground">Histórico de alterações</h2>
            </div>
            <div className="space-y-3">
              {logs.length === 0 && (
                <p className="text-xs text-muted-foreground">Nenhuma alteração registrada ainda.</p>
              )}
              {logs.map((log) => (
                <div key={log.id} className="rounded-lg border border-border bg-background p-3 text-xs">
                  <div className="mb-1 flex items-center gap-1.5 text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {dataHora(log.created_at)}
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
      <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </Label>
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
