import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft, Loader2, CheckCircle2, AlertTriangle, XCircle,
  Download, Archive, FileCheck2, History, Boxes,
  ChevronDown, ChevronUp, FileText,
} from "lucide-react";
import { ResolverCodigosNovosModal } from "@/components/ResolverCodigosNovosModal";
import { StatusBadge, ConfiancaBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { disparaNotificacaoStatus } from "@/lib/notificacoes";
import { toast } from "sonner";

// ─────────────────────────────────────────────────────────────────────────
// Interface enxuta — só campos universais. F4 do refator removeu os ~60
// campos canônicos editáveis; tudo o que vem do PDF do cliente fica em
// dados_layout.linhas (renderizado dinamicamente). Aprovador automático
// continua usando colunas canônicas no banco mas a UI não precisa delas.
// ─────────────────────────────────────────────────────────────────────────
interface Pedido {
  id: string;
  tenant_id: string;
  numero_pedido_cliente: string | null;
  status: string;
  confianca_ia: number | string | null;
  dados_layout: { linhas?: Array<Record<string, string>> } | null;
  created_at: string | null;
  exportado: boolean | null;
  exportado_em: string | null;
  pdf_url: string | null;
  motivo_reprovacao: string | null;
  email_remetente: string | null;
}

interface PedidoItem {
  id: string;
  pedido_id: string;
  numero_item: number | null;
  codigo_cliente: string | null;
  codigo_produto_erp: string | null;
  descricao: string | null;
  quantidade: number | null;
  preco_unitario: number | null;
  preco_total: number | null;
}

interface PedidoLog {
  id: string;
  campo: string;
  valor_anterior: string | null;
  valor_novo: string | null;
  alterado_por: string | null;
  created_at: string | null;
}

interface PendentePedido {
  id: string;
  codigo_cliente: string;
  descricao_pedido: string | null;
}

const brl = (v: number | null | undefined) =>
  (v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const dataHora = (iso: string | null) => {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
};

export default function PedidoDetalhe() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, tenantId } = useAuth();

  const [pedido, setPedido] = useState<Pedido | null>(null);
  const [itens, setItens] = useState<PedidoItem[]>([]);
  const [logs, setLogs] = useState<PedidoLog[]>([]);
  const [pendentes, setPendentes] = useState<PendentePedido[]>([]);
  const [loading, setLoading] = useState(true);
  const [acaoEmCurso, setAcaoEmCurso] = useState<string | null>(null);

  const [showReprovacao, setShowReprovacao] = useState(false);
  const [motivoReprovacao, setMotivoReprovacao] = useState("");
  const [showResolverCodigos, setShowResolverCodigos] = useState(false);
  const [linhasEditadas, setLinhasEditadas] = useState<Array<Record<string, string>>>([]);
  const [pdfExpandido, setPdfExpandido] = useState(true);

  useEffect(() => {
    if (!id || !user || !tenantId) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        // deno-lint-ignore no-explicit-any
        const sb = supabase as any;
        // Defesa em profundidade: filtra por tenant_id em todas as queries.
        // RLS já scope pra usuários comuns, mas super admin tem policy de
        // full access — sem o filtro, ele abriria pedido de qualquer tenant
        // via URL guessing/sharing.
        const [pedRes, itensRes, logsRes, pendRes] = await Promise.all([
          sb.from("pedidos").select("*").eq("id", id).eq("tenant_id", tenantId).maybeSingle(),
          sb.from("pedido_itens").select("*").eq("pedido_id", id).eq("tenant_id", tenantId).order("numero_item", { ascending: true }),
          sb.from("pedido_logs").select("*").eq("pedido_id", id).eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(50),
          sb.from("pedido_itens_pendentes_de_para").select("id,codigo_cliente,descricao_pedido").eq("pedido_id", id).eq("tenant_id", tenantId).eq("resolvido", false),
        ]);
        if (cancelled) return;
        if (pedRes.error) throw pedRes.error;
        if (!pedRes.data) {
          toast.error("Pedido não encontrado");
          navigate("/dashboard");
          return;
        }
        setPedido(pedRes.data as Pedido);
        setLinhasEditadas((pedRes.data?.dados_layout?.linhas ?? []).map((l: Record<string, string>) => ({ ...l })));
        setItens((itensRes.data ?? []) as PedidoItem[]);
        setLogs((logsRes.data ?? []) as PedidoLog[]);
        setPendentes((pendRes.data ?? []) as PendentePedido[]);
      } catch (err) {
        toast.error("Erro ao carregar pedido", { description: (err as Error).message });
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [id, user, tenantId, navigate]);

  // Update simples e direto: PATCH no banco + pedido_logs + notificação por
  // mudança de status. Sem debounce — só ações administrativas explícitas
  // (aprovar/reprovar/arquivar/marcar novo) chamam essa função.
  const acionar = async (
    acao: string,
    patch: Record<string, unknown>,
    sucessoMsg: string,
  ) => {
    if (!pedido || !user) return;
    setAcaoEmCurso(acao);
    try {
      // deno-lint-ignore no-explicit-any
      const sb = supabase as any;
      const { error } = await sb
        .from("pedidos")
        .update(patch)
        .eq("id", pedido.id)
        .eq("tenant_id", pedido.tenant_id);
      if (error) throw error;

      const novoStatus = patch.status as string | undefined;
      if (novoStatus && novoStatus !== pedido.status) {
        await sb.from("pedido_logs").insert({
          pedido_id: pedido.id,
          tenant_id: pedido.tenant_id,
          campo: "status",
          valor_anterior: pedido.status,
          valor_novo: novoStatus,
          alterado_por: user.id,
        });
        disparaNotificacaoStatus(pedido.id, novoStatus).catch(() => undefined);
      }

      setPedido({ ...pedido, ...(patch as Partial<Pedido>) });
      toast.success(sucessoMsg);
    } catch (err) {
      toast.error("Erro ao executar ação", { description: (err as Error).message });
    } finally {
      setAcaoEmCurso(null);
    }
  };

  const handleAprovar = async () => {
    if (!pedido || !user) return;
    setAcaoEmCurso("aprovar");
    try {
      // deno-lint-ignore no-explicit-any
      const sb = supabase as any;
      if (linhasEditadas.length > 0) {
        await sb.from("pedidos").update({
          dados_layout: { linhas: linhasEditadas },
        }).eq("id", pedido.id).eq("tenant_id", pedido.tenant_id);
      }
      const { error } = await sb.from("pedidos").update({
        status: "aprovado",
        aprovado_por: user.id ?? null,
        aprovado_em: new Date().toISOString(),
      }).eq("id", pedido.id).eq("tenant_id", pedido.tenant_id);
      if (error) throw error;
      await sb.from("pedido_logs").insert({
        pedido_id: pedido.id, tenant_id: pedido.tenant_id,
        campo: "status", valor_anterior: pedido.status, valor_novo: "aprovado",
        alterado_por: user.id,
      });
      disparaNotificacaoStatus(pedido.id, "aprovado").catch(() => undefined);
      setPedido({ ...pedido, status: "aprovado", dados_layout: { linhas: linhasEditadas } });
      toast.success("Pedido aprovado com sucesso");
    } catch (err) {
      toast.error("Erro ao aprovar", { description: (err as Error).message });
    } finally {
      setAcaoEmCurso(null);
    }
  };

  const handleArquivarDuplicado = () => acionar(
    "arquivar",
    { status: "ignorado" },
    "Pedido arquivado como duplicado",
  );

  const handleMarcarComoNovo = () => acionar(
    "marcar_novo",
    { status: "pendente" },
    "Pedido voltou para revisão",
  );

  const handleReprovar = async () => {
    if (!motivoReprovacao.trim()) {
      toast.error("Informe o motivo da reprovação");
      return;
    }
    await acionar(
      "reprovar",
      { status: "reprovado", motivo_reprovacao: motivoReprovacao },
      "Pedido reprovado",
    );
    setShowReprovacao(false);
    setMotivoReprovacao("");
  };

  const handleBaixarPdf = () => {
    if (!pedido?.pdf_url) {
      toast.error("PDF original não disponível para este pedido");
      return;
    }
    window.open(pedido.pdf_url, "_blank");
  };

  const linhasLayout = useMemo(
    () => pedido?.dados_layout?.linhas ?? [],
    [pedido?.dados_layout],
  );

  const colunasLayout = useMemo(
    () => (linhasEditadas.length > 0 ? Object.keys(linhasEditadas[0]) : []),
    [linhasEditadas],
  );

  const totalItens = useMemo(
    () => itens.reduce((acc, i) => acc + (Number(i.preco_total) || 0), 0),
    [itens],
  );

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!pedido) return null;

  const ehDuplicado = pedido.status === "duplicado" || pedido.status === "ignorado";
  const ehPendenteAcao = pedido.status === "pendente"
    || pedido.status === "aguardando_de_para"
    || pedido.status === "aprovado_parcial"
    || pedido.status === "leitura_manual";
  const temPendentes = pendentes.length > 0
    || pedido.status === "aguardando_de_para"
    || pedido.status === "aprovado_parcial";

  return (
    <div key={pedido.id} className="mx-auto w-full max-w-[1280px] px-8 py-8">
      {/* Header fixo no topo */}
      <div className="sticky top-0 z-30 -mx-8 mb-6 border-b border-border bg-background/95 px-8 py-4 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <Link
              to="/dashboard"
              className="mb-1 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" /> Voltar ao dashboard
            </Link>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight text-foreground">
                Pedido {pedido.numero_pedido_cliente ?? pedido.id.slice(0, 8)}
              </h1>
              <StatusBadge status={pedido.status} />
              <ConfiancaBadge valor={pedido.confianca_ia} />
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Recebido em {dataHora(pedido.created_at)}
              {pedido.email_remetente ? ` · de ${pedido.email_remetente}` : ""}
            </p>
          </div>

          <div className="flex flex-shrink-0 flex-wrap items-center gap-2">
            {pedido.pdf_url && (
              <>
                <Button variant="outline" size="sm" onClick={handleBaixarPdf} className="gap-2">
                  <Download className="h-4 w-4" /> Baixar PDF
                </Button>
                <Button variant="outline" size="sm" onClick={() => setPdfExpandido(v => !v)} className="gap-2">
                  <FileText className="h-4 w-4" />
                  {pdfExpandido ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </Button>
              </>
            )}
            {temPendentes && (
              <Button variant="outline" size="sm" onClick={() => setShowResolverCodigos(true)} className="gap-2">
                <AlertTriangle className="h-4 w-4" /> Resolver códigos
                {pendentes.length > 0 && ` (${pendentes.length})`}
              </Button>
            )}
            {pedido.status === "duplicado" ? (
              <Button size="sm" onClick={handleMarcarComoNovo} disabled={acaoEmCurso !== null} className="gap-2">
                <FileCheck2 className="h-4 w-4" /> Marcar como novo
              </Button>
            ) : !ehDuplicado && (
              <Button variant="outline" size="sm" onClick={handleArquivarDuplicado} disabled={acaoEmCurso !== null} className="gap-2">
                <Archive className="h-4 w-4" /> Arquivar duplicado
              </Button>
            )}
            {ehPendenteAcao && (
              <>
                <Button variant="outline" size="sm" onClick={() => setShowReprovacao(true)} disabled={acaoEmCurso !== null} className="gap-2 border-destructive/40 text-destructive hover:bg-destructive/10">
                  <XCircle className="h-4 w-4" /> Reprovar
                </Button>
                <Button size="sm" onClick={handleAprovar} disabled={acaoEmCurso !== null} className="gap-2">
                  {acaoEmCurso === "aprovar" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  Aprovar
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* PDF Original */}
      {pedido.pdf_url && pdfExpandido && (
        <div className="mb-6 overflow-hidden rounded-xl border border-border bg-card shadow-softeum-sm">
          <div className="flex items-center justify-between border-b border-border px-5 py-3">
            <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
              <FileText className="h-4 w-4" /> PDF Original
            </h2>
            <Button variant="ghost" size="sm" onClick={() => setPdfExpandido(false)}>
              <ChevronUp className="h-4 w-4" />
            </Button>
          </div>
          <iframe
            src={pedido.pdf_url}
            className="h-[600px] w-full"
            title="PDF do pedido"
          />
        </div>
      )}

      {pedido.motivo_reprovacao && pedido.status === "reprovado" && (
        <div className="mb-6 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
          <p className="text-sm font-medium text-destructive">Motivo da reprovação</p>
          <p className="mt-1 text-sm text-foreground">{pedido.motivo_reprovacao}</p>
        </div>
      )}

      {/* Card A — Layout do ERP do cliente (editável) */}
      <Card titulo="Layout do ERP do cliente" icon={<Boxes className="h-4 w-4" />}>
        {linhasEditadas.length === 0 ? (
          <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-4 w-4" />
            Sem dados extraídos. Preencha os campos manualmente e clique em Aprovar.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
                  {colunasLayout.map((nome) => (
                    <th key={nome} className="px-3 py-2 text-left font-medium">{nome}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {linhasEditadas.map((linha, idx) => (
                  <tr key={idx} className="border-b border-border/60">
                    {colunasLayout.map((nome) => (
                      <td key={nome} className="px-2 py-1">
                        <input
                          type="text"
                          value={linha[nome] ?? ""}
                          onChange={(e) => {
                            const novas = linhasEditadas.map((l, i) =>
                              i === idx ? { ...l, [nome]: e.target.value } : l
                            );
                            setLinhasEditadas(novas);
                          }}
                          className="w-full min-w-[80px] rounded border border-transparent bg-transparent px-1 py-0.5 text-foreground transition-colors hover:border-border focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30"
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Card B — Itens do pedido */}
      <Card titulo="Itens do pedido" icon={<Boxes className="h-4 w-4" />}>
        {itens.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">Nenhum item registrado.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-3 py-2 text-left font-medium">#</th>
                  <th className="px-3 py-2 text-left font-medium">Cód cliente</th>
                  <th className="px-3 py-2 text-left font-medium">Cód ERP</th>
                  <th className="px-3 py-2 text-left font-medium">Descrição</th>
                  <th className="px-3 py-2 text-right font-medium">Qtd</th>
                  <th className="px-3 py-2 text-right font-medium">V. unit.</th>
                  <th className="px-3 py-2 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {itens.map((it) => (
                  <tr key={it.id} className="border-b border-border/60">
                    <td className="px-3 py-2 text-muted-foreground">{it.numero_item ?? "-"}</td>
                    <td className="px-3 py-2 font-mono text-xs">{it.codigo_cliente ?? "-"}</td>
                    <td className="px-3 py-2 font-mono text-xs">{it.codigo_produto_erp ?? "-"}</td>
                    <td className="px-3 py-2">{it.descricao ?? "-"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{it.quantidade ?? "-"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{brl(Number(it.preco_unitario))}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">{brl(Number(it.preco_total))}</td>
                  </tr>
                ))}
                <tr className="bg-muted/20">
                  <td colSpan={6} className="px-3 py-2 text-right text-sm font-medium text-muted-foreground">Total</td>
                  <td className="px-3 py-2 text-right text-base font-bold tabular-nums text-foreground">{brl(totalItens)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Card C — DE-PARA pendentes (condicional) */}
      {pendentes.length > 0 && (
        <Card titulo={`DE-PARA pendentes (${pendentes.length})`} icon={<AlertTriangle className="h-4 w-4 text-amber-600" />}>
          <ul className="space-y-2">
            {pendentes.map((p) => (
              <li key={p.id} className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-sm">
                <div>
                  <span className="font-mono text-xs">{p.codigo_cliente}</span>
                  {p.descricao_pedido && <span className="ml-2 text-muted-foreground">{p.descricao_pedido}</span>}
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex justify-end">
            <Button onClick={() => setShowResolverCodigos(true)} className="gap-2">
              <FileCheck2 className="h-4 w-4" /> Resolver códigos
            </Button>
          </div>
        </Card>
      )}

      {/* Card D — Histórico */}
      <Card titulo="Histórico de alterações" icon={<History className="h-4 w-4" />}>
        {logs.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">Sem alterações registradas.</p>
        ) : (
          <ul className="space-y-2">
            {logs.map((log) => (
              <li key={log.id} className="flex items-start gap-3 border-b border-border/40 pb-2 text-sm last:border-0">
                <span className="w-32 flex-shrink-0 text-xs text-muted-foreground">
                  {dataHora(log.created_at)}
                </span>
                <span className="font-mono text-xs text-muted-foreground">{log.campo}</span>
                <span className="text-foreground">
                  {log.valor_anterior ?? "—"} → <span className="font-medium">{log.valor_novo ?? "—"}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Modal Reprovar */}
      {showReprovacao && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-lg">
            <h3 className="mb-1 text-lg font-semibold text-foreground">Reprovar pedido</h3>
            <p className="mb-3 text-sm text-muted-foreground">
              Informe o motivo da reprovação. O comprador será notificado.
            </p>
            <Textarea
              value={motivoReprovacao}
              onChange={(e) => setMotivoReprovacao(e.target.value)}
              placeholder="Ex: produto fora de catálogo, valor acima do limite..."
              rows={4}
            />
            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => { setShowReprovacao(false); setMotivoReprovacao(""); }}
              >
                Cancelar
              </Button>
              <Button
                onClick={handleReprovar}
                disabled={acaoEmCurso !== null}
                className="gap-2 bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {acaoEmCurso === "reprovar"
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <XCircle className="h-4 w-4" />}
                Confirmar reprovação
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Resolver Códigos */}
      <ResolverCodigosNovosModal
        open={showResolverCodigos}
        onOpenChange={setShowResolverCodigos}
        pedidoId={pedido.id}
        tenantId={pedido.tenant_id}
        onResolvido={() => {
          // deno-lint-ignore no-explicit-any
          const sb = supabase as any;
          sb.from("pedido_itens_pendentes_de_para")
            .select("id,codigo_cliente,descricao_pedido")
            .eq("pedido_id", pedido.id)
            .eq("tenant_id", pedido.tenant_id)
            .eq("resolvido", false)
            .then(({ data }: { data: PendentePedido[] | null }) => {
              setPendentes(data ?? []);
            });
        }}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Subcomponentes locais
// ─────────────────────────────────────────────────────────────────────────

function Card({
  titulo,
  icon,
  children,
}: {
  titulo: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-6 rounded-xl border border-border bg-card p-5 shadow-softeum-sm">
      <h2 className="mb-4 flex items-center gap-2 text-base font-semibold text-foreground">
        {icon}
        {titulo}
      </h2>
      {children}
    </div>
  );
}

