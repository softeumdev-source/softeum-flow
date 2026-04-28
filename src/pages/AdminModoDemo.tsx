import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  FlaskConical, Loader2, RefreshCw, Trash2, Play, ArrowRight,
  FileText, Files, Wand2, Copy, FileWarning, ScanLine, Layers, Forward, Barcode, BarcodeIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const DEMO_TENANT_ID = "2b0389b5-e9bd-4279-8b2f-794ba132cdf5";

type Cenario =
  | "pedido_simples"
  | "pedido_multiplos_pdfs"
  | "pedido_codigos_novos"
  | "pedido_duplicado"
  | "pedido_erro_leitura"
  | "pedido_mal_escaneado"
  | "pedido_grande"
  | "pedido_encaminhado"
  | "pedido_com_ean"
  | "pedido_sem_ean";

const CENARIOS: Array<{ id: Cenario; titulo: string; descricao: string; icone: typeof FileText }> = [
  { id: "pedido_simples", titulo: "Pedido simples", descricao: "1 PDF, 5 itens, todos com DE-PARA cadastrado.", icone: FileText },
  { id: "pedido_multiplos_pdfs", titulo: "Múltiplos PDFs", descricao: "3 pedidos no mesmo lote.", icone: Files },
  { id: "pedido_codigos_novos", titulo: "Códigos novos", descricao: "5 itens, 3 sem DE-PARA — ativa a IA de sugestão.", icone: Wand2 },
  { id: "pedido_duplicado", titulo: "Duplicado", descricao: "Mesmo número do pedido recente — vira 'duplicado'.", icone: Copy },
  { id: "pedido_erro_leitura", titulo: "Erro de leitura", descricao: "PDF corrompido — entra como 'erro'.", icone: FileWarning },
  { id: "pedido_mal_escaneado", titulo: "Mal escaneado", descricao: "PDF de baixa qualidade, fonte miúda.", icone: ScanLine },
  { id: "pedido_grande", titulo: "Pedido grande", descricao: "50 itens (todo o catálogo demo).", icone: Layers },
  { id: "pedido_encaminhado", titulo: "Encaminhado", descricao: "Email simulando 'Fwd:' do Gmail.", icone: Forward },
  { id: "pedido_com_ean", titulo: "Com EAN", descricao: "Itens com EAN — testa match direto pelo código de barras.", icone: Barcode },
  { id: "pedido_sem_ean", titulo: "Sem EAN", descricao: "Sem EAN — IA precisa usar só descrição.", icone: BarcodeIcon },
];

interface DemoStatus {
  inicializado: boolean;
  total_catalogo: number;
  total_de_para: number;
  total_pedidos: number;
  ultima_atividade: string | null;
}

export default function AdminModoDemo() {
  const navigate = useNavigate();
  const sb = supabase as any;

  const [status, setStatus] = useState<DemoStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [acaoEmAndamento, setAcaoEmAndamento] = useState<string | null>(null);
  const [confirmandoReset, setConfirmandoReset] = useState(false);

  const carregar = async () => {
    setLoading(true);
    try {
      const [{ data: tenant }, { count: catCount }, { count: dpCount }, { count: pedCount }, { data: ultimoPedido }] = await Promise.all([
        sb.from("tenants").select("id, is_demo").eq("id", DEMO_TENANT_ID).maybeSingle(),
        sb.from("catalogo_produtos").select("id", { count: "exact", head: true }).eq("tenant_id", DEMO_TENANT_ID),
        sb.from("de_para").select("id", { count: "exact", head: true }).eq("tenant_id", DEMO_TENANT_ID),
        sb.from("pedidos").select("id", { count: "exact", head: true }).eq("tenant_id", DEMO_TENANT_ID),
        sb.from("pedidos").select("created_at").eq("tenant_id", DEMO_TENANT_ID).order("created_at", { ascending: false }).limit(1),
      ]);
      setStatus({
        inicializado: !!tenant && (catCount ?? 0) > 0,
        total_catalogo: catCount ?? 0,
        total_de_para: dpCount ?? 0,
        total_pedidos: pedCount ?? 0,
        ultima_atividade: ultimoPedido?.[0]?.created_at ?? null,
      });
    } catch (e: any) {
      toast.error("Falha ao carregar status do demo", { description: e.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { carregar(); }, []);

  const inicializar = async () => {
    setAcaoEmAndamento("inicializar");
    try {
      const { data, error } = await sb.functions.invoke("inicializar-demo", { body: {} });
      if (error || data?.error) throw new Error(error?.message ?? data?.error);
      toast.success("Demo inicializado", {
        description: `${data.catalogo} produtos · ${data.de_paras} DE-PARAs · ${data.layouts} layout(s)`,
      });
      await carregar();
    } catch (e: any) {
      toast.error("Falha ao inicializar", { description: e.message });
    } finally {
      setAcaoEmAndamento(null);
    }
  };

  const resetar = async () => {
    setConfirmandoReset(false);
    setAcaoEmAndamento("resetar");
    try {
      const { data, error } = await sb.functions.invoke("resetar-demo", { body: { confirmar: true } });
      if (error || data?.error) throw new Error(error?.message ?? data?.error);
      toast.success("Demo resetado", {
        description: `${data.pedidos_apagados} pedidos · ${data.notificacoes_apagadas} notificações apagadas`,
      });
      await carregar();
    } catch (e: any) {
      toast.error("Falha ao resetar", { description: e.message });
    } finally {
      setAcaoEmAndamento(null);
    }
  };

  const simular = async (cenario: Cenario) => {
    setAcaoEmAndamento(`cenario:${cenario}`);
    try {
      const { data, error } = await sb.functions.invoke("simular-cenario-demo", {
        body: { tenant_id: DEMO_TENANT_ID, cenario },
      });
      if (error || data?.error) throw new Error(error?.message ?? data?.error);
      toast.success("Cenário simulado", {
        description: data.multi
          ? `${data.pedidos.length} pedidos criados`
          : `Pedido ${data.pedido_id?.slice(0, 8)} criado`,
      });
      await carregar();
    } catch (e: any) {
      toast.error("Falha ao simular", { description: e.message });
    } finally {
      setAcaoEmAndamento(null);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1100px] px-8 py-8">
      <div className="mb-6 flex items-center gap-3">
        <FlaskConical className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Modo demonstração</h1>
          <p className="text-sm text-muted-foreground">
            Tenant fictício pré-populado com catálogo, DE-PARAs e layout. Use os cenários para testar o fluxo
            sem precisar de cliente real ou e-mail.
          </p>
        </div>
      </div>

      <Card className="mb-6">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Status do tenant demo</CardTitle>
          <Button variant="ghost" size="sm" onClick={carregar} disabled={loading}>
            <RefreshCw className={`mr-1 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Carregando...
            </div>
          ) : status ? (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <Metric label="Inicializado" valor={status.inicializado ? "Sim" : "Não"} destaque={status.inicializado ? "ok" : "warn"} />
              <Metric label="Catálogo" valor={String(status.total_catalogo)} />
              <Metric label="DE-PARAs" valor={String(status.total_de_para)} />
              <Metric label="Pedidos demo" valor={String(status.total_pedidos)} />
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
            {!status?.inicializado && (
              <Button onClick={inicializar} disabled={acaoEmAndamento === "inicializar"}>
                {acaoEmAndamento === "inicializar" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                Inicializar tenant demo
              </Button>
            )}
            {status?.inicializado && (
              <Button variant="outline" onClick={inicializar} disabled={!!acaoEmAndamento}>
                {acaoEmAndamento === "inicializar" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                Re-popular catálogo / DE-PARAs
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => setConfirmandoReset(true)}
              disabled={!status?.inicializado || !!acaoEmAndamento}
              className="border-destructive/40 text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="mr-1 h-4 w-4" />
              Resetar pedidos do demo
            </Button>
            <Button
              variant="default"
              onClick={() => navigate("/dashboard")}
              disabled={!status?.inicializado}
              className="ml-auto gap-2"
            >
              Entrar no tenant demo <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
          {status?.ultima_atividade && (
            <p className="mt-3 text-xs text-muted-foreground">
              Última atividade: {new Date(status.ultima_atividade).toLocaleString("pt-BR")}
            </p>
          )}
        </CardContent>
      </Card>

      <h2 className="mb-3 text-lg font-semibold">Simular cenários</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Cada cenário gera um PDF fictício no Storage e cria um pedido completo no tenant demo.
      </p>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {CENARIOS.map((c) => {
          const Icone = c.icone;
          const emAndamento = acaoEmAndamento === `cenario:${c.id}`;
          return (
            <Card key={c.id}>
              <CardContent className="flex items-start gap-3 p-4">
                <div className="mt-1 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icone className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold">{c.titulo}</h3>
                    <Badge variant="outline" className="text-[10px]">{c.id}</Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{c.descricao}</p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => simular(c.id)}
                  disabled={!status?.inicializado || !!acaoEmAndamento}
                >
                  {emAndamento ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-1 h-3.5 w-3.5" />}
                  Simular
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <AlertDialog open={confirmandoReset} onOpenChange={setConfirmandoReset}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Resetar dados do demo?</AlertDialogTitle>
            <AlertDialogDescription>
              Vamos apagar todos os <strong>pedidos</strong>, itens, pendências e notificações do tenant demo.
              O catálogo, DE-PARAs e layout permanecem. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={resetar}>Resetar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Metric({ label, valor, destaque }: { label: string; valor: string; destaque?: "ok" | "warn" }) {
  const tom =
    destaque === "ok" ? "text-emerald-700"
    : destaque === "warn" ? "text-amber-700"
    : "text-foreground";
  return (
    <div className="rounded-lg border border-border bg-muted/20 px-4 py-3">
      <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${tom}`}>{valor}</div>
    </div>
  );
}
