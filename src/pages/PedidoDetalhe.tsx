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

// Interface alinhada ao schema REAL do banco externo arihejdirnhmcwuhkzde.
interface Pedido {
  id: string;
  tenant_id: string;
  numero: string | null;
  numero_pedido_cliente: string | null;
  empresa: string | null;
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
  produto_codigo: string | null;
  produto_descricao: string | null;
  sugestao_erp: string | null;
  unidade: string | null;
  quantidade: number | null;
  preco_unitario: number | null;
  total: number | null;
  aceito: boolean | null;
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
            .order("created_at", { ascending: true }),
          sb
            .from("pedido_logs")
            .select("*")
            .eq("pedido_id", id)
            .order("created_at", { ascending: false })
            .limit(50),
        ]);

        const data = pedRes.data;
        const error = pedRes.error;

        if (cancelled) return;

        if (error) throw error;
        if (!data) {
          toast.error("Pedido não encontrado");
          navigate("/dashboard");
          return;
        }

        const p = data as unknown as Pedido;
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

    return () => {
      cancelled = true;
    };
  }, [id, user, navigate]);

  const persist = useDebouncedCallback(async (next: Pedido) => {
    if (!user) return;
    setSaveState("saving");
    try {
      const prev = serverSnapshotRef.current;
      const changedFields: { campo: string; valor_anterior: string | null; valor_novo: string | null }[] = [];

      const tracked: (keyof Pedido)[] = [
        "empresa",
        "email_remetente",
        "nome_comprador",
        "email_comprador",
        "telefone_comprador",
        "data_emissao",
        "data_entrega_solicitada",
        "condicao_pagamento",
        "tipo_frete",
        "observacoes_gerais",
        "endereco_entrega",
        "cidade_entrega",
        "estado_entrega",
        "cep_entrega",
        "valor_total",
        "status",
        "motivo_reprovacao",
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

      // O types.ts gerado é do projeto Lovable Cloud, não do banco externo
      // arihejdirnhmcwuhkzde — por isso usamos `any` aqui para liberar as colunas reais.
      const sb = supabase as any;
      const { error } = await sb
        .from("pedidos")
        .update({
          empresa: next.empresa,
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
        })
        .eq("id", next.id);

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
    return Number((q * p).toFixed(2));
  };

  const updateItemLocal = (itemId: string, patch: Partial<PedidoItem>) => {
    setItens((curr) =>
      curr.map((it) => {
        if (it.id !== itemId) return it;
        const merged = { ...it, ...patch };
        merged.total = recomputeTotalItem(merged);
        return merged;
      }),
    );
  };

  const persistItem = useDebouncedCallback(async (item: PedidoItem) => {
    try {
      const sb = supabase;
      const { error } = await sb
        .from("pedido_itens")
        .update({
          produto_codigo: item.produto_codigo,
          produto_descricao: item.produto_descricao,
          sugestao_erp: item.sugestao_erp,
          unidade: item.unidade,
          quantidade: item.quantidade,
          preco_unitario: item.preco_unitario,
          total: item.total,
          aceito: item.aceito,
        })
        .eq("id", item.id);
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
      merged.total = recomputeTotalItem(merged);
      persistItem(merged);
    }
  };

  const handleAddItem = async () => {
    if (!pedido || !tenantId) return;
    try {
      const sb = supabase;
      const { data, error } = await sb
        .from("pedido_itens")
        .insert({
          pedido_id: pedido.id,
          tenant_id: pedido.tenant_id,
          produto_descricao: "",
          quantidade: 1,
          preco_unitario: 0,
          total: 0,
          aceito: true,
        })
        .select()
        .single();
      if (error) throw error;
      setItens((curr) => [...curr, data as unknown as PedidoItem]);
    } catch (err: any) {
      toast.error("Erro ao adicionar item", { description: err.message });
    }
  };

  const handleRemoveItem = async (itemId: string) => {
    try {
      const sb = supabase;
      const { error } = await sb.from("pedido_itens").delete().eq("id", itemId);
      if (error) throw error;
      setItens((curr) => curr.filter((it) => it.id !== itemId));
    } catch (err: any) {
      toast.error("Erro ao remover item", { description: err.message });
    }
  };

  const totalItens = useMemo(
    () => itens.reduce((acc, it) => acc + Number(it.total ?? 0), 0),
    [itens],
  );
  const totalAceitos = useMemo(
    () => itens.filter((it) => it.aceito).reduce((acc, it) => acc + Number(it.total ?? 0), 0),
    [itens],
  );

  const handleAprovar = async () => {
    if (!pedido) return;
    updatePedido({
      status: "aprovado",
      aprovado_por: user?.id ?? null,
      aprovado_em: new Date().toISOString(),
    });
    toast.success("Pedido aprovado", {
      description: "Status atualizado. Integração ERP será adicionada na próxima fase.",
    });
  };

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!pedido) return null;

  console.log('RENDER pedido state:', {
    id: pedido.id,
    empresa: pedido.empresa,
    nome_comprador: pedido.nome_comprador,
    email_comprador: pedido.email_comprador,
    telefone_comprador: pedido.telefone_comprador,
    condicao_pagamento: pedido.condicao_pagamento,
    tipo_frete: pedido.tipo_frete,
    data_emissao: pedido.data_emissao,
    data_entrega_solicitada: pedido.data_entrega_solicitada,
    valor_total: pedido.valor_total,
    observacoes_gerais: pedido.observacoes_gerais,
  });

  return (
    <div className="mx-auto w-full max-w-[1400px] px-8 py-8">
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
          <Button onClick={handleAprovar} disabled={pedido.status === "aprovado"} className="gap-2">
            <CheckCircle2 className="h-4 w-4" />
            Aprovar pedido
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        {/* Coluna principal */}
        <div className="space-y-6">
          {/* Dados do pedido */}
          <section className="rounded-xl border border-border bg-card p-6 shadow-softeum-sm">
            <h2 className="mb-4 text-base font-semibold text-foreground">Dados do pedido</h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label="Fornecedor / Empresa">
                <Input
                  value={pedido.empresa ?? ""}
                  onChange={(e) => updatePedido({ empresa: e.target.value })}
                  placeholder="Nome do fornecedor"
                />
              </Field>
              <Field label="E-mail remetente">
                <Input
                  type="email"
                  value={pedido.email_remetente ?? ""}
                  onChange={(e) => updatePedido({ email_remetente: e.target.value })}
                  placeholder="contato@fornecedor.com"
                />
              </Field>
              <Field label="Nome do comprador">
                <Input
                  value={pedido.nome_comprador ?? ""}
                  onChange={(e) => updatePedido({ nome_comprador: e.target.value })}
                  placeholder="Nome do comprador"
                />
              </Field>
              <Field label="E-mail do comprador">
                <Input
                  type="email"
                  value={pedido.email_comprador ?? ""}
                  onChange={(e) => updatePedido({ email_comprador: e.target.value })}
                  placeholder="comprador@empresa.com"
                />
              </Field>
              <Field label="Telefone do comprador">
                <Input
                  value={pedido.telefone_comprador ?? ""}
                  onChange={(e) => updatePedido({ telefone_comprador: e.target.value })}
                  placeholder="(11) 99999-9999"
                />
              </Field>
              <Field label="Condição de pagamento">
                <Input
                  value={pedido.condicao_pagamento ?? ""}
                  onChange={(e) => updatePedido({ condicao_pagamento: e.target.value })}
                  placeholder="Ex: 30/60/90"
                />
              </Field>
              <Field label="Tipo de frete">
                <Input
                  value={pedido.tipo_frete ?? ""}
                  onChange={(e) => updatePedido({ tipo_frete: e.target.value })}
                  placeholder="CIF / FOB"
                />
              </Field>
              <Field label="Data de emissão">
                <Input
                  type="date"
                  value={pedido.data_emissao ?? ""}
                  onChange={(e) => updatePedido({ data_emissao: e.target.value || null })}
                />
              </Field>
              <Field label="Data de entrega solicitada">
                <Input
                  type="date"
                  value={pedido.data_entrega_solicitada ?? ""}
                  onChange={(e) => updatePedido({ data_entrega_solicitada: e.target.value || null })}
                />
              </Field>
              <Field label="Status">
                <Select
                  value={pedido.status}
                  onValueChange={(v) => updatePedido({ status: v as StatusPedido })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
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
              <Field label="Valor total">
                <Input
                  type="number"
                  step="0.01"
                  value={pedido.valor_total ?? ""}
                  onChange={(e) =>
                    updatePedido({
                      valor_total: e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                  placeholder="0,00"
                />
              </Field>
              <div className="md:col-span-2">
                <Field label="Observações">
                  <Textarea
                    value={pedido.observacoes_gerais ?? ""}
                    onChange={(e) => updatePedido({ observacoes_gerais: e.target.value })}
                    placeholder="Notas internas sobre o pedido"
                    rows={3}
                  />
                </Field>
              </div>
            </div>
          </section>

          {/* Itens */}
          <section className="rounded-xl border border-border bg-card shadow-softeum-sm">
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
              <div>
                <h2 className="text-base font-semibold text-foreground">Itens do pedido</h2>
                <p className="text-xs text-muted-foreground">
                  {itens.length} {itens.length === 1 ? "item" : "itens"} ·
                  {" "}Total {brl(totalItens)} ·{" "}
                  Aceitos {brl(totalAceitos)}
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={handleAddItem} className="gap-2">
                <Plus className="h-4 w-4" />
                Adicionar item
              </Button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="w-10 px-4 py-3 text-left font-medium">OK</th>
                    <th className="px-4 py-3 text-left font-medium">Código</th>
                    <th className="px-4 py-3 text-left font-medium">Descrição</th>
                    <th className="px-4 py-3 text-left font-medium">Sugestão ERP</th>
                    <th className="w-20 px-4 py-3 text-left font-medium">Un.</th>
                    <th className="w-24 px-4 py-3 text-right font-medium">Qtd.</th>
                    <th className="w-32 px-4 py-3 text-right font-medium">Preço un.</th>
                    <th className="w-32 px-4 py-3 text-right font-medium">Total</th>
                    <th className="w-12 px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {itens.map((it) => (
                    <tr key={it.id} className="hover:bg-muted/20">
                      <td className="px-4 py-2">
                        <input
                          type="checkbox"
                          checked={!!it.aceito}
                          onChange={(e) => handleItemChange(it.id, { aceito: e.target.checked })}
                          className="h-4 w-4 rounded border-input"
                        />
                      </td>
                      <td className="px-4 py-2">
                        <Input
                          value={it.produto_codigo ?? ""}
                          onChange={(e) =>
                            handleItemChange(it.id, { produto_codigo: e.target.value })
                          }
                          className="h-8"
                        />
                      </td>
                      <td className="px-4 py-2">
                        <Input
                          value={it.produto_descricao ?? ""}
                          onChange={(e) =>
                            handleItemChange(it.id, { produto_descricao: e.target.value })
                          }
                          className="h-8"
                        />
                      </td>
                      <td className="px-4 py-2">
                        <Input
                          value={it.sugestao_erp ?? ""}
                          onChange={(e) =>
                            handleItemChange(it.id, { sugestao_erp: e.target.value })
                          }
                          className="h-8"
                          placeholder="-"
                        />
                      </td>
                      <td className="px-4 py-2">
                        <Input
                          value={it.unidade ?? ""}
                          onChange={(e) => handleItemChange(it.id, { unidade: e.target.value })}
                          className="h-8"
                          placeholder="UN"
                        />
                      </td>
                      <td className="px-4 py-2">
                        <Input
                          type="number"
                          step="0.01"
                          value={it.quantidade ?? ""}
                          onChange={(e) =>
                            handleItemChange(it.id, {
                              quantidade: e.target.value === "" ? null : Number(e.target.value),
                            })
                          }
                          className="h-8 text-right tabular-nums"
                        />
                      </td>
                      <td className="px-4 py-2">
                        <Input
                          type="number"
                          step="0.01"
                          value={it.preco_unitario ?? ""}
                          onChange={(e) =>
                            handleItemChange(it.id, {
                              preco_unitario:
                                e.target.value === "" ? null : Number(e.target.value),
                            })
                          }
                          className="h-8 text-right tabular-nums"
                        />
                      </td>
                      <td className="px-4 py-2 text-right font-semibold tabular-nums">
                        {brl(it.total)}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => handleRemoveItem(it.id)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                          aria-label="Remover item"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {itens.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-4 py-12 text-center text-sm text-muted-foreground">
                        <AlertTriangle className="mx-auto mb-2 h-5 w-5 text-warning" />
                        Nenhum item neste pedido. Clique em "Adicionar item" para começar.
                      </td>
                    </tr>
                  )}
                </tbody>
                {itens.length > 0 && (
                  <tfoot className="border-t border-border bg-muted/20 text-sm font-semibold">
                    <tr>
                      <td colSpan={7} className="px-4 py-3 text-right text-muted-foreground">
                        Total geral
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-foreground">
                        {brl(totalItens)}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                )}
              </table>
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
                    <h2 className="text-base font-semibold text-foreground">
                      DE-PARA aplicado automaticamente
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      {deParaLogs.length} substituição{deParaLogs.length === 1 ? "" : "ões"} realizada{deParaLogs.length === 1 ? "" : "s"} pelo motor de DE-PARA
                    </p>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-success/10 text-xs uppercase tracking-wider text-muted-foreground">
                      <tr>
                        <th className="w-20 px-4 py-3 text-left font-medium">Nº Item</th>
                        <th className="px-4 py-3 text-left font-medium">Campo</th>
                        <th className="px-4 py-3 text-left font-medium">Valor original</th>
                        <th className="px-4 py-3 text-left font-medium">Valor convertido</th>
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
                            <td className="px-4 py-3 text-muted-foreground line-through">
                              {log.valor_anterior ?? "—"}
                            </td>
                            <td className="px-4 py-3 font-medium text-success-foreground">
                              <span className="rounded-md bg-success/15 px-2 py-0.5 text-success">
                                {log.valor_novo ?? "—"}
                              </span>
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

        {/* Sidebar: histórico */}
        <aside className="space-y-6">
          <section className="rounded-xl border border-border bg-card p-6 shadow-softeum-sm">
            <div className="mb-4 flex items-center gap-2">
              <History className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-base font-semibold text-foreground">Histórico de alterações</h2>
            </div>
            <div className="space-y-3">
              {logs.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Nenhuma alteração registrada ainda.
                </p>
              )}
              {logs.map((log) => (
                <div
                  key={log.id}
                  className="rounded-lg border border-border bg-background p-3 text-xs"
                >
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
