import { useEffect, useMemo, useState } from "react";
import { Loader2, Search, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ConfiancaBadge } from "@/components/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Sugestao {
  codigo_erp: string;
  descricao: string;
  confianca: number;
  motivo: string;
}

interface PendenciaRow {
  id: string;
  pedido_item_id: string;
  codigo_cliente: string | null;
  descricao_pedido: string | null;
  sugestoes_ia: Sugestao[] | null;
  resolvido: boolean;
}

interface ProdutoCatalogo {
  codigo_erp: string;
  descricao: string;
  ean: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pedidoId: string;
  tenantId: string;
  onResolvido?: () => void;
}

interface Escolha {
  codigo_erp: string;
  descricao: string;
  origem: "sugestao" | "catalogo";
}

export function ResolverCodigosNovosModal({ open, onOpenChange, pedidoId, tenantId, onResolvido }: Props) {
  const sb = supabase as any;
  const [loading, setLoading] = useState(true);
  const [pendencias, setPendencias] = useState<PendenciaRow[]>([]);
  const [escolhas, setEscolhas] = useState<Record<string, Escolha>>({});
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const [confirmandoTodos, setConfirmandoTodos] = useState(false);

  const [buscandoCatalogo, setBuscandoCatalogo] = useState<string | null>(null);
  const [buscaCatalogo, setBuscaCatalogo] = useState("");
  const [resultadosCatalogo, setResultadosCatalogo] = useState<ProdutoCatalogo[]>([]);

  const carregar = async () => {
    setLoading(true);
    const { data, error } = await sb
      .from("pedido_itens_pendentes_de_para")
      .select("id, pedido_item_id, codigo_cliente, descricao_pedido, sugestoes_ia, resolvido")
      .eq("pedido_id", pedidoId)
      .eq("resolvido", false)
      .order("created_at", { ascending: true });
    if (error) {
      toast.error("Falha ao carregar pendências", { description: error.message });
      setPendencias([]);
    } else {
      const rows = ((data ?? []) as any[]).map((r) => ({
        ...r,
        sugestoes_ia: Array.isArray(r.sugestoes_ia) ? r.sugestoes_ia : [],
      })) as PendenciaRow[];
      setPendencias(rows);
      const initialChoices: Record<string, Escolha> = {};
      for (const r of rows) {
        const top = r.sugestoes_ia?.[0];
        if (top?.codigo_erp) {
          initialChoices[r.id] = {
            codigo_erp: top.codigo_erp,
            descricao: top.descricao ?? "",
            origem: "sugestao",
          };
        }
      }
      setEscolhas(initialChoices);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (!open) return;
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pedidoId]);

  const buscarCatalogo = async (texto: string) => {
    if (!texto.trim()) {
      setResultadosCatalogo([]);
      return;
    }
    const escaped = texto.trim().replace(/[%,]/g, "");
    const { data } = await sb
      .from("catalogo_produtos")
      .select("codigo_erp, descricao, ean")
      .eq("tenant_id", tenantId)
      .eq("ativo", true)
      .or(`codigo_erp.ilike.%${escaped}%,descricao.ilike.%${escaped}%,ean.ilike.%${escaped}%`)
      .order("codigo_erp", { ascending: true })
      .limit(20);
    setResultadosCatalogo(((data ?? []) as ProdutoCatalogo[]));
  };

  useEffect(() => {
    if (!buscandoCatalogo) return;
    const t = setTimeout(() => buscarCatalogo(buscaCatalogo), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buscaCatalogo, buscandoCatalogo]);

  const confirmarUm = async (pendencia: PendenciaRow) => {
    const escolhida = escolhas[pendencia.id];
    if (!escolhida?.codigo_erp) {
      toast.error("Selecione um produto antes de confirmar.");
      return;
    }
    setConfirmando(pendencia.id);
    try {
      const { data, error } = await sb.functions.invoke("confirmar-de-para-pedido", {
        body: {
          pedido_item_id: pendencia.pedido_item_id,
          codigo_erp_escolhido: escolhida.codigo_erp,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success("Item resolvido");
      setPendencias((curr) => curr.filter((p) => p.id !== pendencia.id));
      onResolvido?.();
    } catch (err: any) {
      toast.error("Falha ao confirmar", { description: err.message });
    } finally {
      setConfirmando(null);
    }
  };

  const confirmarTodos = async () => {
    const elegiveis = pendencias.filter((p) => escolhas[p.id]);
    if (elegiveis.length === 0) {
      toast.error("Nenhum item tem produto selecionado.");
      return;
    }
    setConfirmandoTodos(true);
    let ok = 0;
    let fail = 0;
    for (const pendencia of elegiveis) {
      try {
        const { data, error } = await sb.functions.invoke("confirmar-de-para-pedido", {
          body: {
            pedido_item_id: pendencia.pedido_item_id,
            codigo_erp_escolhido: escolhas[pendencia.id]?.codigo_erp,
          },
        });
        if (error || data?.error) throw new Error(error?.message ?? data?.error);
        ok++;
      } catch {
        fail++;
      }
    }
    setConfirmandoTodos(false);
    if (ok > 0) toast.success(`${ok} item(ns) resolvido(s)`);
    if (fail > 0) toast.error(`${fail} item(ns) falharam`);
    await carregar();
    onResolvido?.();
  };

  const trocarEscolha = (p: PendenciaRow) => {
    const top = p.sugestoes_ia?.[0];
    setEscolhas((cur) => {
      const next = { ...cur };
      if (top?.codigo_erp) {
        next[p.id] = { codigo_erp: top.codigo_erp, descricao: top.descricao ?? "", origem: "sugestao" };
      } else {
        delete next[p.id];
      }
      return next;
    });
    if (buscandoCatalogo === p.id) {
      setBuscandoCatalogo(null);
      setBuscaCatalogo("");
      setResultadosCatalogo([]);
    }
  };

  const totalSelecionados = useMemo(
    () => pendencias.filter((p) => escolhas[p.id]).length,
    [pendencias, escolhas],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Resolver códigos novos</DialogTitle>
          <DialogDescription>
            Itens deste pedido não estavam no DE-PARA. A IA olhou seu catálogo e sugeriu correspondências.
            Confirme cada uma para criar o DE-PARA automaticamente.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Carregando...
          </div>
        ) : pendencias.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            Nenhum código novo pendente neste pedido.
          </div>
        ) : (
          <ScrollArea className="max-h-[60vh] pr-4">
            <div className="space-y-4">
              {pendencias.map((p) => (
                <div key={p.id} className="rounded-lg border border-border bg-card p-4">
                  <div className="mb-3">
                    <div className="text-xs uppercase tracking-wider text-muted-foreground">Código do pedido</div>
                    <div className="mt-1 font-mono text-sm font-semibold">{p.codigo_cliente ?? "—"}</div>
                    <div className="mt-1 text-sm text-muted-foreground">{p.descricao_pedido ?? "Sem descrição"}</div>
                  </div>

                  {escolhas[p.id]?.origem === "catalogo" ? (
                    <div className="space-y-2">
                      <div className="rounded-md border border-primary bg-primary/5 px-3 py-2">
                        <div className="flex items-start gap-3">
                          <span className="mt-1 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border border-primary bg-primary">
                            <span className="h-1.5 w-1.5 rounded-full bg-primary-foreground" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-sm">{escolhas[p.id].codigo_erp}</span>
                              <Badge variant="outline" className="border-primary/40 bg-primary/10 px-1.5 py-0 text-[10px] text-primary">
                                do catálogo
                              </Badge>
                            </div>
                            <div className="mt-0.5 text-sm">{escolhas[p.id].descricao}</div>
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => trocarEscolha(p)}
                        className="text-xs font-medium text-primary hover:underline"
                      >
                        ← Trocar escolha
                      </button>
                    </div>
                  ) : (
                    <>
                      {(p.sugestoes_ia ?? []).length === 0 && buscandoCatalogo !== p.id && (
                        <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                          A IA não encontrou correspondência no catálogo. Use "Outro produto..." para escolher manualmente.
                        </div>
                      )}

                      <div className="space-y-2">
                        {(p.sugestoes_ia ?? []).map((s) => {
                          const escolhida = escolhas[p.id];
                          const selecionado = escolhida?.codigo_erp === s.codigo_erp && escolhida?.origem === "sugestao";
                          return (
                            <button
                              key={s.codigo_erp}
                              type="button"
                              onClick={() => {
                                setEscolhas((cur) => ({
                                  ...cur,
                                  [p.id]: { codigo_erp: s.codigo_erp, descricao: s.descricao ?? "", origem: "sugestao" },
                                }));
                                if (buscandoCatalogo === p.id) {
                                  setBuscandoCatalogo(null);
                                  setBuscaCatalogo("");
                                  setResultadosCatalogo([]);
                                }
                              }}
                              className={`flex w-full items-start gap-3 rounded-md border px-3 py-2 text-left transition-colors ${
                                selecionado ? "border-primary bg-primary/5" : "border-border bg-muted/10 hover:bg-muted/30"
                              }`}
                            >
                              <span
                                className={`mt-1 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border ${
                                  selecionado ? "border-primary bg-primary" : "border-muted-foreground/40"
                                }`}
                              >
                                {selecionado && <span className="h-1.5 w-1.5 rounded-full bg-primary-foreground" />}
                              </span>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="font-mono text-sm">{s.codigo_erp}</span>
                                  <ConfiancaBadge valor={s.confianca / 100} />
                                </div>
                                <div className="mt-0.5 text-sm">{s.descricao}</div>
                                {s.motivo && <div className="mt-1 text-xs text-muted-foreground"><Sparkles className="mr-1 inline h-3 w-3" />{s.motivo}</div>}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </>
                  )}

                  {buscandoCatalogo === p.id ? (
                    <div className="mt-3 rounded-md border border-border bg-muted/20 p-3">
                      <div className="relative mb-2">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          autoFocus
                          className="pl-9"
                          placeholder="Buscar no catálogo por código, descrição ou EAN"
                          value={buscaCatalogo}
                          onChange={(e) => setBuscaCatalogo(e.target.value)}
                        />
                      </div>
                      <div className="max-h-48 overflow-auto">
                        {resultadosCatalogo.length === 0 ? (
                          <p className="px-2 py-3 text-xs text-muted-foreground">
                            {buscaCatalogo ? "Nenhum produto encontrado." : "Comece a digitar para buscar no catálogo."}
                          </p>
                        ) : (
                          <ul className="divide-y divide-border">
                            {resultadosCatalogo.map((r) => (
                              <li key={r.codigo_erp}>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEscolhas((cur) => ({
                                      ...cur,
                                      [p.id]: { codigo_erp: r.codigo_erp, descricao: r.descricao, origem: "catalogo" },
                                    }));
                                    setBuscandoCatalogo(null);
                                    setBuscaCatalogo("");
                                    setResultadosCatalogo([]);
                                  }}
                                  className="flex w-full items-start gap-3 px-2 py-2 text-left hover:bg-muted/40"
                                >
                                  <span className="mt-0.5 font-mono text-xs text-muted-foreground">{r.codigo_erp}</span>
                                  <span className="flex-1 text-sm">{r.descricao}</span>
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      <div className="mt-2 flex justify-end">
                        <Button variant="ghost" size="sm" onClick={() => { setBuscandoCatalogo(null); setBuscaCatalogo(""); }}>
                          Cancelar
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2 flex items-center justify-between">
                      <button
                        type="button"
                        onClick={() => { setBuscandoCatalogo(p.id); setBuscaCatalogo(""); setResultadosCatalogo([]); }}
                        className="text-xs font-medium text-primary hover:underline"
                      >
                        Outro produto...
                      </button>
                      <Button
                        size="sm"
                        onClick={() => confirmarUm(p)}
                        disabled={!escolhas[p.id]?.codigo_erp || confirmando === p.id}
                      >
                        {confirmando === p.id ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                        Confirmar este item
                      </Button>
                    </div>
                  )}

                  {escolhas[p.id] && (
                    <div className="mt-2 flex items-start gap-2 text-xs text-muted-foreground">
                      <span>Escolhido:</span>
                      <span className="font-mono font-semibold text-foreground">{escolhas[p.id].codigo_erp}</span>
                      {escolhas[p.id].descricao && (
                        <span className="text-foreground/80">— {escolhas[p.id].descricao}</span>
                      )}
                      {escolhas[p.id].origem === "catalogo" && (
                        <Badge variant="outline" className="ml-1 px-1.5 py-0 text-[10px]">do catálogo</Badge>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={confirmandoTodos}>
            Fechar
          </Button>
          {pendencias.length > 1 && (
            <Button onClick={confirmarTodos} disabled={confirmandoTodos || totalSelecionados === 0}>
              {confirmandoTodos ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
              Confirmar todos ({totalSelecionados})
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

