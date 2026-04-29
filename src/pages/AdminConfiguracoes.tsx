import { useEffect, useState } from "react";
import { Loader2, AlertTriangle, Mail } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const KEY_SEV_MIN = "severidade_minima_email";
const KEY_BYPASS = "bypass_revisao_destinatario";

const SEVERIDADES: Array<{ value: string; label: string }> = [
  { value: "baixa", label: "Baixa (todos os erros)" },
  { value: "media", label: "Média (padrão)" },
  { value: "alta", label: "Alta" },
  { value: "critica", label: "Crítica (apenas críticos)" },
];

export default function AdminConfiguracoes() {
  const [loading, setLoading] = useState(true);
  const [sevMin, setSevMin] = useState<string>("media");
  const [savingSev, setSavingSev] = useState(false);
  const [bypassRevisao, setBypassRevisao] = useState(false);
  const [savingBypass, setSavingBypass] = useState(false);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const sb = supabase as any;
        const { data, error } = await sb
          .from("configuracoes_globais")
          .select("chave, valor")
          .in("chave", [KEY_SEV_MIN, KEY_BYPASS]);
        if (error) throw error;
        (data ?? []).forEach((r: any) => {
          if (r.chave === KEY_SEV_MIN) setSevMin(r.valor ?? "media");
          if (r.chave === KEY_BYPASS) setBypassRevisao(String(r.valor ?? "").toLowerCase() === "true");
        });
      } catch (err: any) {
        toast.error("Erro ao carregar configurações", { description: err.message });
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const salvarSev = async (novoValor: string) => {
    setSevMin(novoValor);
    setSavingSev(true);
    try {
      const sb = supabase as any;
      const { error } = await sb
        .from("configuracoes_globais")
        .upsert({ chave: KEY_SEV_MIN, valor: novoValor }, { onConflict: "chave" });
      if (error) throw error;
      toast.success("Severidade mínima salva");
    } catch (err: any) {
      toast.error("Não foi possível salvar", { description: err.message });
    } finally {
      setSavingSev(false);
    }
  };

  const salvarBypass = async (novoValor: boolean) => {
    setBypassRevisao(novoValor);
    setSavingBypass(true);
    try {
      const sb = supabase as any;
      const { error } = await sb
        .from("configuracoes_globais")
        .upsert({ chave: KEY_BYPASS, valor: String(novoValor) }, { onConflict: "chave" });
      if (error) throw error;
      toast.success(novoValor ? "Bypass ligado" : "Bypass desligado");

      // Avisa se há pedidos antigos pendentes — bypass só vale pra novos.
      if (novoValor) {
        const { count } = await sb
          .from("pedidos")
          .select("id", { count: "exact", head: true })
          .eq("notif_suspeita_destinatario", true)
          .eq("notif_revisada", false);
        if ((count ?? 0) > 0) {
          toast.info(
            `${count} pedido(s) antigos continuam aguardando revisão.`,
            { description: "O bypass só afeta pedidos novos. Pra liberar os antigos, processe em /admin/revisar-notificacoes." },
          );
        }
      }
    } catch (err: any) {
      setBypassRevisao(!novoValor);
      toast.error("Não foi possível salvar", { description: err.message });
    } finally {
      setSavingBypass(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-[900px] px-8 py-8">
        <div className="flex items-center justify-center rounded-xl border border-border bg-card py-20 text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Carregando configurações...
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[900px] px-8 py-8">
      <div className="mb-7">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Configurações admin</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Configurações globais visíveis apenas para o Super Admin.
        </p>
      </div>

      <div className="space-y-6">
        <Section icone={AlertTriangle} titulo="Filtro de severidade" descricao="Quais erros viram notificação no sino do Super Admin.">
          <div className="rounded-lg border border-border bg-muted/20 px-4 py-4">
            <Label className="text-sm text-foreground">Severidade mínima para notificar</Label>
            <p className="mt-1 text-xs text-muted-foreground">
              Erros abaixo dessa severidade ainda são gravados em <code>system_errors</code> e aparecem em /admin/erros, mas não disparam notificação no sino.
            </p>
            <div className="mt-3 flex items-center gap-2">
              <Select value={sevMin} onValueChange={salvarSev} disabled={savingSev}>
                <SelectTrigger className="max-w-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SEVERIDADES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
              {savingSev && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            </div>
          </div>
        </Section>

        <Section icone={Mail} titulo="Notificações de pedidos" descricao="Política de envio de e-mails ao cliente quando o sistema suspeita do destinatário.">
          <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-muted/20 px-4 py-4">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-foreground">Enviar notificações sem revisão manual</div>
              <p className="mt-1 text-xs text-muted-foreground">
                Quando ligado, e-mails são enviados automaticamente mesmo nos casos em que o detector marcou suspeita de destinatário (ex: forward de Gmail). Recomendado apenas depois de validar que o detector está confiável pro seu cenário.
              </p>
            </div>
            <div className="flex items-center gap-2">
              {savingBypass && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
              <Switch checked={bypassRevisao} onCheckedChange={salvarBypass} disabled={savingBypass} />
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}

function Section({
  icone: Icone,
  titulo,
  descricao,
  children,
}: {
  icone: typeof AlertTriangle;
  titulo: string;
  descricao: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-6 shadow-softeum-sm">
      <div className="mb-5 flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icone className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <h2 className="text-base font-semibold text-foreground">{titulo}</h2>
          <p className="text-xs text-muted-foreground">{descricao}</p>
        </div>
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}
