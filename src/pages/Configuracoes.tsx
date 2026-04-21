import { useEffect, useState } from "react";
import { Loader2, Bell, Zap, ShieldCheck } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

// Toggles booleanos salvos em public.configuracoes (chave/valor)
const TOGGLES = [
  // Notificações
  {
    grupo: "notificacoes",
    chave: "notif_recebimento",
    label: "Notificar recebimento",
    descricao: "Envia email quando o pedido é recebido e está em análise.",
  },
  {
    grupo: "notificacoes",
    chave: "notif_aprovacao",
    label: "Notificar aprovação",
    descricao: "Envia email quando o pedido é aprovado.",
  },
  {
    grupo: "notificacoes",
    chave: "notif_reprovacao",
    label: "Notificar reprovação",
    descricao: "Envia email quando o pedido é reprovado.",
  },
  {
    grupo: "notificacoes",
    chave: "notif_duplicado",
    label: "Notificar duplicado",
    descricao: "Envia email quando um pedido duplicado é detectado.",
  },
  // Processamento automático
  {
    grupo: "processamento",
    chave: "aprovacao_automatica",
    label: "Aprovação automática",
    descricao:
      "Quando ligado, pedidos com confiança acima do mínimo são aprovados e enviados ao ERP sem revisão manual. Quando desligado, todos ficam como pendentes.",
  },
  // Duplicados
  {
    grupo: "duplicados",
    chave: "bloquear_pdf_duplicado",
    label: "Bloquear PDFs duplicados",
    descricao:
      "O sistema verifica a impressão digital do PDF. Se já existir um pedido com o mesmo arquivo, o novo é bloqueado automaticamente.",
  },
  {
    grupo: "duplicados",
    chave: "bloquear_numero_cnpj",
    label: "Bloquear por número do pedido + CNPJ",
    descricao:
      "Se chegar um pedido com o mesmo número e CNPJ de um já existente, o sistema bloqueia e notifica.",
  },
] as const;

const CONFIANCA_KEY = "confianca_minima_aprovacao";

interface ConfigRow {
  chave: string;
  valor: string | null;
}

export default function Configuracoes() {
  const { user, tenantId, papel, loading: authLoading } = useAuth();
  const isAdmin = papel === "admin";

  const [loading, setLoading] = useState(true);
  const [toggles, setToggles] = useState<Record<string, boolean>>({});
  const [confianca, setConfianca] = useState<string>("95");
  const [savingConfianca, setSavingConfianca] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setLoading(false);
      return;
    }
    if (!tenantId) {
      setLoading(false);
      return;
    }
    const load = async () => {
      setLoading(true);
      try {
        const sb = supabase as any;
        const { data: cfgs, error } = await sb
          .from("configuracoes")
          .select("chave, valor")
          .eq("tenant_id", tenantId);
        if (error) throw error;

        const map: Record<string, boolean> = {};
        TOGGLES.forEach((t) => (map[t.chave] = false));
        let conf = "95";
        (cfgs ?? []).forEach((r: ConfigRow) => {
          if (r.chave === CONFIANCA_KEY) {
            conf = r.valor ?? "95";
          } else {
            map[r.chave] = r.valor === "true";
          }
        });
        setToggles(map);
        setConfianca(conf);
      } catch (err: any) {
        toast.error("Erro ao carregar configurações", { description: err.message });
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [user, authLoading, tenantId]);

  const salvarToggle = async (chave: string, valor: boolean) => {
    if (!tenantId || !isAdmin) return;
    setToggles((t) => ({ ...t, [chave]: valor }));
    try {
      const sb = supabase as any;
      const { error } = await sb
        .from("configuracoes")
        .upsert(
          { tenant_id: tenantId, chave, valor: String(valor) },
          { onConflict: "tenant_id,chave" },
        );
      if (error) throw error;
      toast.success("Configuração salva");
    } catch (err: any) {
      setToggles((t) => ({ ...t, [chave]: !valor }));
      toast.error("Não foi possível salvar", { description: err.message });
    }
  };

  const salvarConfianca = async () => {
    if (!tenantId || !isAdmin) return;
    const num = Number(confianca);
    if (Number.isNaN(num) || num < 0 || num > 100) {
      toast.error("Valor inválido", { description: "Use um número entre 0 e 100." });
      return;
    }
    setSavingConfianca(true);
    try {
      const sb = supabase as any;
      const { error } = await sb
        .from("configuracoes")
        .upsert(
          { tenant_id: tenantId, chave: CONFIANCA_KEY, valor: String(num) },
          { onConflict: "tenant_id,chave" },
        );
      if (error) throw error;
      toast.success("Confiança mínima salva");
    } catch (err: any) {
      toast.error("Não foi possível salvar", { description: err.message });
    } finally {
      setSavingConfianca(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-[1100px] px-8 py-8">
        <div className="flex items-center justify-center rounded-xl border border-border bg-card py-20 text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Carregando configurações...
        </div>
      </div>
    );
  }

  if (!tenantId) {
    return (
      <div className="mx-auto w-full max-w-[1100px] px-8 py-8">
        <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          Sua conta ainda não está vinculada a um tenant. Solicite acesso ao administrador.
        </div>
      </div>
    );
  }

  const togglesNotif = TOGGLES.filter((t) => t.grupo === "notificacoes");
  const togglesProc = TOGGLES.filter((t) => t.grupo === "processamento");
  const togglesDup = TOGGLES.filter((t) => t.grupo === "duplicados");

  return (
    <div className="mx-auto w-full max-w-[1100px] px-8 py-8">
      <div className="mb-7">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Configurações</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Notificações, processamento automático e controle de duplicados.
        </p>
        {!isAdmin && (
          <p className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
            Somente administradores podem alterar as configurações.
          </p>
        )}
      </div>

      <div className="space-y-6">
        <Section
          icone={Bell}
          titulo="Notificações por email"
          descricao="Controle quais emails são enviados automaticamente para o cliente."
        >
          {togglesNotif.map((t) => (
            <ToggleRow
              key={t.chave}
              label={t.label}
              descricao={t.descricao}
              checked={!!toggles[t.chave]}
              disabled={!isAdmin}
              onChange={(v) => salvarToggle(t.chave, v)}
            />
          ))}
        </Section>

        <Section
          icone={Zap}
          titulo="Processamento automático"
          descricao="Defina se pedidos com alta confiança da IA são enviados automaticamente ao ERP."
        >
          {togglesProc.map((t) => (
            <ToggleRow
              key={t.chave}
              label={t.label}
              descricao={t.descricao}
              checked={!!toggles[t.chave]}
              disabled={!isAdmin}
              onChange={(v) => salvarToggle(t.chave, v)}
            />
          ))}

          <div className="rounded-lg border border-border bg-muted/20 px-4 py-4">
            <Label htmlFor="confianca-min" className="text-sm text-foreground">
              Confiança mínima para aprovar automaticamente (%)
            </Label>
            <p className="mt-1 text-xs text-muted-foreground">
              Pedidos com confiança da IA acima deste valor serão enviados ao ERP automaticamente.
            </p>
            <div className="mt-3 flex items-center gap-2">
              <Input
                id="confianca-min"
                type="number"
                min={0}
                max={100}
                step={1}
                value={confianca}
                onChange={(e) => setConfianca(e.target.value)}
                onBlur={salvarConfianca}
                disabled={!isAdmin || savingConfianca}
                className="w-32"
              />
              {savingConfianca && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            </div>
          </div>
        </Section>

        <Section
          icone={ShieldCheck}
          titulo="Controle de duplicados"
          descricao="Evite que o mesmo pedido seja processado duas vezes."
        >
          {togglesDup.map((t) => (
            <ToggleRow
              key={t.chave}
              label={t.label}
              descricao={t.descricao}
              checked={!!toggles[t.chave]}
              disabled={!isAdmin}
              onChange={(v) => salvarToggle(t.chave, v)}
            />
          ))}
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
  icone: typeof Bell;
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
        <div>
          <h2 className="text-base font-semibold text-foreground">{titulo}</h2>
          <p className="text-xs text-muted-foreground">{descricao}</p>
        </div>
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function ToggleRow({
  label,
  descricao,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  descricao?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-muted/20 px-4 py-3">
      <div className="min-w-0">
        <div className="text-sm font-medium text-foreground">{label}</div>
        {descricao && <p className="mt-0.5 text-xs text-muted-foreground">{descricao}</p>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  );
}
