import { useEffect, useState } from "react";
import { Loader2, Save, Mail, Cog, Bell, Zap } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

// Configs simples (chave/valor) salvas em public.configuracoes
const CONFIGS_DEFAULT = [
  { chave: "notif_email_novo_pedido", label: "Notificar por e-mail novos pedidos", tipo: "bool" },
  { chave: "notif_email_erro_ia", label: "Notificar por e-mail quando IA falhar", tipo: "bool" },
  { chave: "processamento_automatico", label: "Aprovar pedidos com confiança ≥ 95% automaticamente", tipo: "bool" },
  { chave: "ignorar_duplicados", label: "Ignorar automaticamente pedidos duplicados", tipo: "bool" },
] as const;

interface ConfigRow {
  id?: string;
  chave: string;
  valor: string | null;
}

interface GmailCfg {
  id?: string;
  email: string;
  assunto_filtro: string | null;
  ativo: boolean;
}

interface ErpCfg {
  id?: string;
  tipo: string;
  endpoint: string | null;
  api_key: string | null;
  ativo: boolean;
}

export default function Configuracoes() {
  const { user, tenantId, papel, loading: authLoading } = useAuth();
  const isAdmin = papel === "admin";

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [toggles, setToggles] = useState<Record<string, boolean>>({});
  const [gmail, setGmail] = useState<GmailCfg>({ email: "", assunto_filtro: "[Pedido]", ativo: false });
  const [erp, setErp] = useState<ErpCfg>({ tipo: "api_rest", endpoint: "", api_key: "", ativo: false });

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setLoading(false);
      return;
    }
    if (!tenantId) {
      // Usuário sem tenant vinculado — não trava no loader
      setLoading(false);
      return;
    }
    const load = async () => {
      setLoading(true);
      try {
        const sb = supabase as any;
        const [{ data: cfgs }, { data: gmailRow }, { data: erpRow }] = await Promise.all([
          sb.from("configuracoes").select("id, chave, valor").eq("tenant_id", tenantId),
          sb.from("tenant_gmail_config").select("*").eq("tenant_id", tenantId).maybeSingle(),
          sb.from("tenant_erp_config").select("*").eq("tenant_id", tenantId).maybeSingle(),
        ]);

        const map: Record<string, boolean> = {};
        CONFIGS_DEFAULT.forEach((c) => (map[c.chave] = false));
        (cfgs ?? []).forEach((r: ConfigRow) => {
          map[r.chave] = r.valor === "true";
        });
        setToggles(map);

        if (gmailRow) {
          setGmail({
            id: gmailRow.id,
            email: gmailRow.email ?? "",
            assunto_filtro: gmailRow.assunto_filtro ?? "[Pedido]",
            ativo: !!gmailRow.ativo,
          });
        }
        if (erpRow) {
          setErp({
            id: erpRow.id,
            tipo: erpRow.tipo ?? "api_rest",
            endpoint: erpRow.endpoint ?? "",
            api_key: erpRow.api_key ?? "",
            ativo: !!erpRow.ativo,
          });
        }
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
      // reverte
      setToggles((t) => ({ ...t, [chave]: !valor }));
      toast.error("Não foi possível salvar", { description: err.message });
    }
  };

  const salvarGmail = async () => {
    if (!tenantId || !isAdmin) return;
    setSaving(true);
    try {
      const sb = supabase as any;
      const { error } = await sb
        .from("tenant_gmail_config")
        .upsert(
          {
            id: gmail.id,
            tenant_id: tenantId,
            email: gmail.email,
            assunto_filtro: gmail.assunto_filtro,
            ativo: gmail.ativo,
          },
          { onConflict: "tenant_id" },
        );
      if (error) throw error;
      toast.success("Configuração do Gmail salva");
    } catch (err: any) {
      toast.error("Erro ao salvar Gmail", { description: err.message });
    } finally {
      setSaving(false);
    }
  };

  const salvarErp = async () => {
    if (!tenantId || !isAdmin) return;
    setSaving(true);
    try {
      const sb = supabase as any;
      const { error } = await sb
        .from("tenant_erp_config")
        .upsert(
          {
            id: erp.id,
            tenant_id: tenantId,
            tipo: erp.tipo,
            endpoint: erp.endpoint,
            api_key: erp.api_key,
            ativo: erp.ativo,
          },
          { onConflict: "tenant_id" },
        );
      if (error) throw error;
      toast.success("Configuração do ERP salva");
    } catch (err: any) {
      toast.error("Erro ao salvar ERP", { description: err.message });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-[1400px] px-8 py-8">
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
  return (
    <div className="mx-auto w-full max-w-[1100px] px-8 py-8">
      <div className="mb-7">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Configurações</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Notificações, processamento automático e integrações.
        </p>
        {!isAdmin && (
          <p className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
            Somente administradores podem alterar as configurações.
          </p>
        )}
      </div>

      <div className="space-y-6">
        {/* Notificações + automação */}
        <Section icone={Bell} titulo="Notificações" descricao="Como você quer ser avisado.">
          {CONFIGS_DEFAULT.filter((c) => c.chave.startsWith("notif_")).map((c) => (
            <ToggleRow
              key={c.chave}
              label={c.label}
              checked={!!toggles[c.chave]}
              disabled={!isAdmin}
              onChange={(v) => salvarToggle(c.chave, v)}
            />
          ))}
        </Section>

        <Section icone={Zap} titulo="Processamento automático" descricao="Regras automáticas para reduzir trabalho manual.">
          {CONFIGS_DEFAULT.filter((c) => !c.chave.startsWith("notif_")).map((c) => (
            <ToggleRow
              key={c.chave}
              label={c.label}
              checked={!!toggles[c.chave]}
              disabled={!isAdmin}
              onChange={(v) => salvarToggle(c.chave, v)}
            />
          ))}
        </Section>

        {/* Gmail */}
        <Section icone={Mail} titulo="Integração Gmail" descricao="Conta usada para receber pedidos por e-mail.">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="gmail-email">E-mail</Label>
              <Input
                id="gmail-email"
                type="email"
                value={gmail.email}
                onChange={(e) => setGmail({ ...gmail, email: e.target.value })}
                placeholder="pedidos@suaempresa.com"
                disabled={!isAdmin}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="gmail-filtro">Filtro de assunto</Label>
              <Input
                id="gmail-filtro"
                value={gmail.assunto_filtro ?? ""}
                onChange={(e) => setGmail({ ...gmail, assunto_filtro: e.target.value })}
                placeholder="[Pedido]"
                disabled={!isAdmin}
              />
            </div>
          </div>
          <ToggleRow
            label="Integração ativa"
            checked={gmail.ativo}
            disabled={!isAdmin}
            onChange={(v) => setGmail({ ...gmail, ativo: v })}
          />
          <div className="flex justify-end">
            <Button onClick={salvarGmail} disabled={!isAdmin || saving} className="gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Salvar Gmail
            </Button>
          </div>
        </Section>

        {/* ERP */}
        <Section icone={Cog} titulo="Integração ERP" descricao="Para onde enviar os pedidos aprovados.">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="erp-tipo">Tipo</Label>
              <Input
                id="erp-tipo"
                value={erp.tipo}
                onChange={(e) => setErp({ ...erp, tipo: e.target.value })}
                placeholder="api_rest"
                disabled={!isAdmin}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="erp-endpoint">Endpoint</Label>
              <Input
                id="erp-endpoint"
                value={erp.endpoint ?? ""}
                onChange={(e) => setErp({ ...erp, endpoint: e.target.value })}
                placeholder="https://erp.suaempresa.com/api/pedidos"
                disabled={!isAdmin}
              />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor="erp-key">API Key</Label>
              <Input
                id="erp-key"
                type="password"
                value={erp.api_key ?? ""}
                onChange={(e) => setErp({ ...erp, api_key: e.target.value })}
                placeholder="••••••••"
                disabled={!isAdmin}
              />
            </div>
          </div>
          <ToggleRow
            label="Integração ativa"
            checked={erp.ativo}
            disabled={!isAdmin}
            onChange={(v) => setErp({ ...erp, ativo: v })}
          />
          <div className="flex justify-end">
            <Button onClick={salvarErp} disabled={!isAdmin || saving} className="gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Salvar ERP
            </Button>
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
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border bg-muted/20 px-4 py-3">
      <span className="text-sm text-foreground">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  );
}
