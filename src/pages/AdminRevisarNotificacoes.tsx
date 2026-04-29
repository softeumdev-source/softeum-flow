import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight, Check, CheckCheck, Loader2, Mail, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type StatusPedido =
  | "pendente" | "aprovado" | "reprovado" | "erro" | "duplicado" | "ignorado"
  | "aguardando_de_para" | "aprovado_parcial";

interface PedidoSuspeita {
  id: string;
  numero: string | null;
  numero_pedido_cliente: string | null;
  empresa: string | null;
  cnpj: string | null;
  valor_total: number | null;
  status: StatusPedido;
  email_envelope_from: string | null;
  email_comprador: string | null;
  remetente_email: string | null;
  email_remetente: string | null;
  created_at: string;
}

const brl = (v: number | null) =>
  (v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dataHora = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

const STATUS_LABEL: Record<string, string> = {
  pendente: "Pendente", aprovado: "Aprovado", reprovado: "Reprovado",
  erro: "Erro", duplicado: "Duplicado", ignorado: "Ignorado",
  aguardando_de_para: "Aguardando DE-PARA", aprovado_parcial: "Aprovado parcial",
};

export default function AdminRevisarNotificacoes() {
  const sb = supabase as any;
  const [pedidos, setPedidos] = useState<PedidoSuspeita[]>([]);
  const [loading, setLoading] = useState(true);
  const [acaoEm, setAcaoEm] = useState<string | null>(null);

  const [trocarAlvo, setTrocarAlvo] = useState<PedidoSuspeita | null>(null);
  const [novoEmail, setNovoEmail] = useState("");

  const [confirmandoLote, setConfirmandoLote] = useState(false);
  const [processandoLote, setProcessandoLote] = useState<{ ok: number; fail: number; total: number } | null>(null);

  const carregar = async () => {
    setLoading(true);
    const { data, error } = await sb
      .from("pedidos")
      .select("id, numero, numero_pedido_cliente, empresa, cnpj, valor_total, status, email_envelope_from, email_comprador, remetente_email, email_remetente, created_at")
      .eq("notif_suspeita_destinatario", true)
      .eq("notif_revisada", false)
      .order("created_at", { ascending: false });
    if (error) {
      toast.error("Falha ao carregar fila", { description: error.message });
      setPedidos([]);
    } else {
      setPedidos((data ?? []) as PedidoSuspeita[]);
    }
    setLoading(false);
  };

  useEffect(() => { carregar(); }, []);

  const chamarRevisao = async (
    pedido: PedidoSuspeita,
    acao: "confirmar" | "trocar" | "ignorar",
    destinatarioOverride?: string,
  ) => {
    setAcaoEm(pedido.id);
    try {
      const { data, error } = await sb.functions.invoke("revisar-notificacao-suspeita", {
        body: { pedido_id: pedido.id, acao, destinatario_override: destinatarioOverride },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const msg =
        acao === "ignorar" ? "Marcado como revisado sem envio." :
        data?.email_enviado ? "Notificação enviada." :
        `Marcado como revisado. ${data?.skip_reason ?? ""}`;
      toast.success(msg);
      setPedidos((curr) => curr.filter((p) => p.id !== pedido.id));
    } catch (err: any) {
      toast.error("Falha ao processar", { description: err.message });
    } finally {
      setAcaoEm(null);
    }
  };

  const aprovarTodos = async () => {
    const lista = [...pedidos];
    const total = lista.length;
    if (total === 0) return;
    setConfirmandoLote(false);
    setProcessandoLote({ ok: 0, fail: 0, total });
    let ok = 0;
    let fail = 0;
    for (let i = 0; i < lista.length; i++) {
      const p = lista[i];
      try {
        const { data, error } = await sb.functions.invoke("revisar-notificacao-suspeita", {
          body: { pedido_id: p.id, acao: "confirmar" },
        });
        if (error || data?.error) throw new Error(error?.message ?? data?.error);
        ok++;
      } catch {
        fail++;
      }
      setProcessandoLote({ ok, fail, total });
      // Atualiza a lista visível progressivamente.
      setPedidos((curr) => curr.filter((x) => x.id !== p.id));
    }
    setProcessandoLote(null);
    if (ok > 0) toast.success(`${ok} pedido(s) processado(s)`);
    if (fail > 0) toast.error(`${fail} falha(s) — confira no banco`);
  };

  const confirmarTroca = async () => {
    if (!trocarAlvo) return;
    const novo = novoEmail.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(novo)) {
      toast.error("E-mail inválido");
      return;
    }
    const alvo = trocarAlvo;
    setTrocarAlvo(null);
    setNovoEmail("");
    await chamarRevisao(alvo, "trocar", novo);
  };

  return (
    <div className="mx-auto w-full max-w-[1200px] px-8 py-8">
      <div className="mb-6 flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-1 h-6 w-6 flex-shrink-0 text-amber-600" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Revisar notificações</h1>
            <p className="text-sm text-muted-foreground">
              Pedidos onde o sistema suspeita que o destinatário pode estar errado (forward de e-mail).
              Confirme antes de enviar a notificação ao cliente.
            </p>
          </div>
        </div>
        {pedidos.length > 0 && (
          <Button
            variant="default"
            onClick={() => setConfirmandoLote(true)}
            disabled={!!processandoLote || !!acaoEm}
            className="gap-2"
          >
            {processandoLote ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCheck className="h-4 w-4" />}
            {processandoLote
              ? `Processando ${processandoLote.ok + processandoLote.fail}/${processandoLote.total}...`
              : `Aprovar todos (${pedidos.length})`}
          </Button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center rounded-xl border border-border bg-card py-20 text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Carregando fila...
        </div>
      ) : pedidos.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Check className="mx-auto mb-3 h-10 w-10 text-emerald-600" />
            <p className="text-sm font-medium text-foreground">Nenhuma notificação aguardando revisão.</p>
            <p className="mt-1 text-xs text-muted-foreground">As próximas suspeitas aparecem aqui automaticamente.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {pedidos.map((p) => {
            const numero = p.numero_pedido_cliente ?? p.numero ?? p.id.slice(0, 8);
            const envelope = p.email_envelope_from ?? "—";
            const comprador = p.email_comprador ?? "—";
            const resolvido = p.remetente_email ?? p.email_remetente ?? "—";
            const emAndamento = acaoEm === p.id;
            return (
              <Card key={p.id}>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Link to={`/pedido/${p.id}`} className="text-sm font-semibold text-foreground hover:underline">
                          Pedido {numero}
                        </Link>
                        <span className="text-xs text-muted-foreground">{STATUS_LABEL[p.status] ?? p.status}</span>
                        <span className="text-xs text-muted-foreground">· {dataHora(p.created_at)}</span>
                      </div>
                      <div className="mt-0.5 text-sm text-muted-foreground">
                        {p.empresa ?? "Sem empresa"}{p.cnpj ? ` · ${p.cnpj}` : ""} · {brl(p.valor_total)}
                      </div>

                      <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
                        <CampoEmail label="Envelope From (entregou)" valor={envelope} alerta />
                        <CampoEmail label="E-mail no PDF (comprador)" valor={comprador} />
                        <CampoEmail label="Resolvido (vai receber)" valor={resolvido} destaque />
                      </div>
                    </div>

                    <div className="flex flex-shrink-0 flex-col gap-2">
                      <Button
                        size="sm"
                        onClick={() => chamarRevisao(p, "confirmar")}
                        disabled={emAndamento}
                        className="gap-2"
                      >
                        {emAndamento ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
                        Confirmar e enviar
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => { setTrocarAlvo(p); setNovoEmail(resolvido !== "—" ? resolvido : ""); }}
                        disabled={emAndamento}
                        className="gap-2"
                      >
                        <Pencil className="h-3.5 w-3.5" /> Trocar destinatário
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => chamarRevisao(p, "ignorar")}
                        disabled={emAndamento}
                        className="gap-2 text-muted-foreground"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Ignorar
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={!!trocarAlvo} onOpenChange={(o) => { if (!o) { setTrocarAlvo(null); setNovoEmail(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Trocar destinatário</DialogTitle>
            <DialogDescription>
              O e-mail novo será gravado no pedido e usado para todas as notificações futuras.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="novo-dest">Novo e-mail</Label>
            <Input
              id="novo-dest"
              type="email"
              value={novoEmail}
              onChange={(e) => setNovoEmail(e.target.value)}
              placeholder="contato@cliente.com.br"
            />
            <p className="text-xs text-muted-foreground">
              Atual: <span className="font-mono">{trocarAlvo?.remetente_email ?? trocarAlvo?.email_remetente ?? "—"}</span>
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setTrocarAlvo(null); setNovoEmail(""); }}>Cancelar</Button>
            <Button onClick={confirmarTroca} className="gap-2">
              <ArrowRight className="h-4 w-4" /> Trocar e enviar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmandoLote} onOpenChange={setConfirmandoLote}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Aprovar todos os pendentes?</AlertDialogTitle>
            <AlertDialogDescription>
              Você vai enviar <strong>{pedidos.length}</strong> e-mail(s) para os destinatários
              resolvidos atualmente. Cada pedido é processado individualmente; falhas isoladas
              não interrompem o lote. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={aprovarTodos}>Aprovar e enviar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function CampoEmail({ label, valor, alerta, destaque }: { label: string; valor: string; alerta?: boolean; destaque?: boolean }) {
  return (
    <div
      className={`rounded-md border px-3 py-2 ${
        destaque ? "border-primary/40 bg-primary/5" :
        alerta ? "border-amber-300 bg-amber-50" :
        "border-border bg-muted/20"
      }`}
    >
      <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-0.5 truncate font-mono text-xs ${destaque ? "text-primary" : "text-foreground"}`}>{valor}</div>
    </div>
  );
}
