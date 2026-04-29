import { useEffect, useState } from "react";
import { Loader2, Bell, Zap, ShieldCheck, Mail, Save, Link as LinkIcon, Boxes } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const GMAIL_OAUTH_START_URL =
  "https://arihejdirnhmcwuhkzde.supabase.co/functions/v1/gmail-oauth-start";

const TOGGLES = [
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
  {
    grupo: "processamento",
    chave: "aprovacao_automatica",
    label: "Aprovação automática",
    descricao:
      "Quando ligado, pedidos com confiança acima do mínimo são aprovados e enviados ao ERP sem revisão manual. Quando desligado, todos ficam como pendentes.",
  },
  {
    grupo: "duplicados",
    chave: "validacao_duplicidade_ativa",
    label: "Validação de duplicidade",
    descricao:
      "Quando ligado, o sistema verifica se o PDF (impressão digital) ou o número do pedido + CNPJ do comprador já existem. Pedidos duplicados entram com status 'Duplicado' pra você revisar — não são bloqueados.",
  },
] as const;

const CONFIANCA_KEY = "confianca_minima_aprovacao";
const VALOR_MAX_KEY = "valor_maximo_aprovacao_automatica";
const QTD_MAX_KEY = "quantidade_maxima_item_automatica";
const COMPORTAMENTO_KEY = "comportamento_codigo_novo";

type Comportamento = "bloquear" | "aprovar_original" | "aprovar_parcial";

const COMPORTAMENTOS: Array<{ value: Comportamento; titulo: string; descricao: string }> = [
  {
    value: "aprovar_parcial",
    titulo: "Aprovar parcial (recomendado)",
    descricao:
      "Itens com DE-PARA são liberados para exportação. Itens com código novo ficam pendentes até confirmação. Status do pedido: Aprovado parcial.",
  },
  {
    value: "bloquear",
    titulo: "Bloquear pedido inteiro",
    descricao:
      "Pedido fica como Aguardando DE-PARA até o cliente confirmar todos os códigos novos. Mais seguro, porém atrasa pedidos parciais.",
  },
  {
    value: "aprovar_original",
    titulo: "Aprovar com código original",
    descricao:
      "Pedido segue o fluxo normal, mantendo o código que veio do cliente nos itens novos. Você cadastra o DE-PARA depois, manualmente.",
  },
];

interface ConfigRow {
  chave: string;
  valor: string | null;
}

interface GmailCfg {
  id?: string;
  email: string;
  assunto_filtro: string | null;
  ativo: boolean;
}

export default function Configuracoes() {
  const { user, tenantId, papel, isSuperAdmin, loading: authLoading } = useAuth();
  const isAdmin = papel === "admin" || isSuperAdmin;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [conectandoGmail, setConectandoGmail] = useState(false);
  const [toggles, setToggles] = useState<Record<string, boolean>>({});
  const [confianca, setConfianca] = useState<string>("");
  const [savingConfianca, setSavingConfianca] = useState(false);
  const [valorMax, setValorMax] = useState<string>("");
  const [savingValorMax, setSavingValorMax] = useState(false);
  const [qtdMax, setQtdMax] = useState<string>("");
  const [savingQtdMax, setSavingQtdMax] = useState(false);
  const [comportamento, setComportamento] = useState<Comportamento>("aprovar_parcial");
  const [savingComportamento, setSavingComportamento] = useState(false);
  const [gmail, setGmail] = useState<GmailCfg>({ email: "", assunto_filtro: "[Pedido]", ativo: false });

  useEffect(() => {
    if (authLoading) return;
    if (!user) { setLoading(false); return; }
    if (!tenantId) { setLoading(false); return; }

    const load = async () => {
      setLoading(true);
      try {
        const sb = supabase as any;
        const [{ data: cfgs, error }, { data: gmailRow }] = await Promise.all([
          sb.from("configuracoes").select("chave, valor").eq("tenant_id", tenantId),
          sb.from("tenant_gmail_config").select("*").eq("tenant_id", tenantId).maybeSingle(),
        ]);
        if (error) throw error;

        const map: Record<string, boolean> = {};
        TOGGLES.forEach((t) => (map[t.chave] = false));
        // Default true para validação de duplicidade — ausência da chave
        // no banco significa "ainda não configurado", e queremos a
        // checagem ligada por padrão.
        map["validacao_duplicidade_ativa"] = true;
        let conf = "";
        let valMax = "";
        let qMax = "";
        let comp: Comportamento = "aprovar_parcial";

        (cfgs ?? []).forEach((r: ConfigRow) => {
          if (r.chave === CONFIANCA_KEY) {
            conf = r.valor ?? "";
          } else if (r.chave === VALOR_MAX_KEY) {
            valMax = r.valor ?? "";
          } else if (r.chave === QTD_MAX_KEY) {
            qMax = r.valor ?? "";
          } else if (r.chave === COMPORTAMENTO_KEY) {
            const v = (r.valor ?? "") as Comportamento;
            if (v === "bloquear" || v === "aprovar_original" || v === "aprovar_parcial") comp = v;
          } else {
            map[r.chave] = r.valor === "true";
          }
        });

        setToggles(map);
        setConfianca(conf);
        setValorMax(valMax);
        setQtdMax(qMax);
        setComportamento(comp);

        if (gmailRow) {
          setGmail({
            id: gmailRow.id,
            email: gmailRow.email ?? "",
            assunto_filtro: gmailRow.assunto_filtro ?? "[Pedido]",
            ativo: !!gmailRow.ativo,
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
      setToggles((t) => ({ ...t, [chave]: !valor }));
      toast.error("Não foi possível salvar", { description: err.message });
    }
  };

  const salvarComportamento = async (novo: Comportamento) => {
    if (!tenantId || !isAdmin) return;
    setComportamento(novo);
    setSavingComportamento(true);
    try {
      const sb = supabase as any;
      const { error } = await sb
        .from("configuracoes")
        .upsert(
          { tenant_id: tenantId, chave: COMPORTAMENTO_KEY, valor: novo },
          { onConflict: "tenant_id,chave" },
        );
      if (error) throw error;
      toast.success("Comportamento atualizado");
    } catch (err: any) {
      toast.error("Não foi possível salvar", { description: err.message });
    } finally {
      setSavingComportamento(false);
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

  const salvarLimiteNumerico = async (
    chave: string, valor: string, label: string,
    setSaving: (v: boolean) => void,
  ) => {
    if (!tenantId || !isAdmin) return;
    const trimmed = valor.trim();
    if (!trimmed) return; // Vazio não persiste — toggle de ativação é o gate.
    const num = Number(trimmed.replace(",", "."));
    if (Number.isNaN(num) || num <= 0) {
      toast.error(`${label} inválido`, { description: "Use um número positivo." });
      return;
    }
    setSaving(true);
    try {
      const sb = supabase as any;
      const { error } = await sb
        .from("configuracoes")
        .upsert(
          { tenant_id: tenantId, chave, valor: String(num) },
          { onConflict: "tenant_id,chave" },
        );
      if (error) throw error;
      toast.success(`${label} salvo`);
    } catch (err: any) {
      toast.error("Não foi possível salvar", { description: err.message });
    } finally {
      setSaving(false);
    }
  };

  const salvarValorMax = () => salvarLimiteNumerico(
    VALOR_MAX_KEY, valorMax, "Valor máximo do pedido", setSavingValorMax,
  );
  const salvarQtdMax = () => salvarLimiteNumerico(
    QTD_MAX_KEY, qtdMax, "Quantidade máxima por item", setSavingQtdMax,
  );

  const limitesAprovacaoPreenchidos =
    confianca.trim() !== "" && valorMax.trim() !== "" && qtdMax.trim() !== "";

  const handleToggleAprovacaoAutomatica = (v: boolean) => {
    if (v && !limitesAprovacaoPreenchidos) {
      toast.error("Configure os 3 limites antes de ativar", {
        description: "Confiança mínima, valor máximo do pedido e quantidade máxima por item.",
      });
      return;
    }
    salvarToggle("aprovacao_automatica", v);
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

  const conectarGmail = async () => {
    if (!tenantId || !isAdmin) return;
    setConectandoGmail(true);
    try {
      const res = await fetch(
        `${GMAIL_OAUTH_START_URL}?tenant_id=${encodeURIComponent(tenantId)}`,
      );
      const json = await res.json();
      if (!res.ok || !json.url) {
        throw new Error(json.error ?? "Não foi possível iniciar o fluxo");
      }
      window.location.href = json.url;
    } catch (err: any) {
      toast.error("Erro ao conectar Gmail", { description: err.message });
      setConectandoGmail(false);
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const gmailParam = params.get("gmail");
    if (!gmailParam) return;
    if (gmailParam === "ok") {
      toast.success("Gmail conectado com sucesso");
    } else {
      const motivo = params.get("motivo") ?? "desconhecido";
      toast.error("Falha ao conectar Gmail", { description: motivo });
    }
    const url = new URL(window.location.href);
    url.searchParams.delete("gmail");
    url.searchParams.delete("motivo");
    window.history.replaceState({}, "", url.toString());
  }, []);

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

  const togglesNotif = TOGGLES.filter((t) => t.grupo === "notificacoes");
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
          headerToggle={{
            checked: !!toggles.notif_email_ativo,
            disabled: !isAdmin,
            onChange: (v) => salvarToggle("notif_email_ativo", v),
          }}
        >
          {toggles.notif_email_ativo &&
            togglesNotif.map((t) => (
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
          titulo="Aprovação automática"
          descricao="Pedidos que passem em TODAS as regras abaixo são aprovados sem revisão manual e vão pra fila de exportação."
        >
          <ToggleRow
            label="Aprovação automática"
            descricao={
              limitesAprovacaoPreenchidos
                ? "Quando ligada, pedidos válidos viram 'Aprovado' direto. Configure os 3 limites abaixo antes de ligar."
                : "Preencha os 3 limites abaixo (confiança, valor e quantidade) pra poder ligar."
            }
            checked={!!toggles.aprovacao_automatica}
            disabled={!isAdmin || (!toggles.aprovacao_automatica && !limitesAprovacaoPreenchidos)}
            onChange={handleToggleAprovacaoAutomatica}
          />

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="rounded-lg border border-border bg-muted/20 px-4 py-3">
              <Label htmlFor="lim-confianca" className="text-sm">Confiança mínima da IA (%)</Label>
              <p className="mt-1 text-xs text-muted-foreground">Ex.: 95</p>
              <div className="mt-2 flex items-center gap-2">
                <Input
                  id="lim-confianca"
                  type="number" min={0} max={100} step={1}
                  value={confianca}
                  onChange={(e) => setConfianca(e.target.value)}
                  onBlur={salvarConfianca}
                  disabled={!isAdmin || savingConfianca}
                  placeholder="—"
                />
                {savingConfianca && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
              </div>
            </div>

            <div className="rounded-lg border border-border bg-muted/20 px-4 py-3">
              <Label htmlFor="lim-valor" className="text-sm">Valor máximo do pedido (R$)</Label>
              <p className="mt-1 text-xs text-muted-foreground">Pedidos acima viram 'pendente'.</p>
              <div className="mt-2 flex items-center gap-2">
                <Input
                  id="lim-valor"
                  type="number" min={0} step="0.01"
                  value={valorMax}
                  onChange={(e) => setValorMax(e.target.value)}
                  onBlur={salvarValorMax}
                  disabled={!isAdmin || savingValorMax}
                  placeholder="—"
                />
                {savingValorMax && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
              </div>
            </div>

            <div className="rounded-lg border border-border bg-muted/20 px-4 py-3">
              <Label htmlFor="lim-qtd" className="text-sm">Quantidade máxima por item</Label>
              <p className="mt-1 text-xs text-muted-foreground">Itens acima viram 'pendente'.</p>
              <div className="mt-2 flex items-center gap-2">
                <Input
                  id="lim-qtd"
                  type="number" min={0} step="any"
                  value={qtdMax}
                  onChange={(e) => setQtdMax(e.target.value)}
                  onBlur={salvarQtdMax}
                  disabled={!isAdmin || savingQtdMax}
                  placeholder="—"
                />
                {savingQtdMax && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-muted/10 px-4 py-3">
            <div className="text-sm font-medium text-foreground">Como funciona</div>
            <p className="mt-1 text-xs text-muted-foreground">
              Pra um pedido ser aprovado automaticamente, todas estas regras precisam passar:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
              <li>Toggle acima ligado.</li>
              <li>Confiança da IA ≥ mínimo configurado.</li>
              <li>100% dos itens com DE-PARA encontrado (sem códigos novos pendentes).</li>
              <li>Número do pedido legível no PDF.</li>
              <li>Pedido não foi marcado como duplicado.</li>
              <li>Valor total ≤ máximo configurado.</li>
              <li>Quantidade de cada item ≤ máximo configurado.</li>
              <li>Campos completos: CNPJ, data, ≥1 item, valor &gt; 0, valor bate com soma dos itens (tolerância 0,5%).</li>
            </ul>
            <p className="mt-2 text-xs text-muted-foreground">
              Qualquer regra que falhar joga o pedido pra revisão manual ('pendente'). Toda decisão fica registrada na trilha de auditoria.
            </p>
          </div>
        </Section>

        <Section
          icone={ShieldCheck}
          titulo="Validação de duplicidade"
          descricao="Evita que o mesmo pedido seja processado duas vezes."
        >
          {togglesDup.map((t) => (
            <ToggleRow
              key={t.chave}
              label={t.label}
              descricao={t.descricao}
              checked={toggles[t.chave] !== false}
              disabled={!isAdmin}
              onChange={(v) => salvarToggle(t.chave, v)}
            />
          ))}
        </Section>

        <Section
          icone={Boxes}
          titulo="DE-PARA inteligente"
          descricao="O que fazer quando chega um pedido com código de produto que ainda não está no DE-PARA cadastrado."
        >
          <div className="space-y-2">
            {COMPORTAMENTOS.map((opt) => {
              const ativo = comportamento === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  disabled={!isAdmin || savingComportamento}
                  onClick={() => salvarComportamento(opt.value)}
                  className={`flex w-full items-start gap-3 rounded-lg border px-4 py-3 text-left transition-colors ${
                    ativo
                      ? "border-primary bg-primary/5"
                      : "border-border bg-muted/20 hover:bg-muted/40"
                  } ${!isAdmin ? "cursor-not-allowed opacity-60" : ""}`}
                >
                  <span
                    className={`mt-1 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border ${
                      ativo ? "border-primary bg-primary" : "border-muted-foreground/40"
                    }`}
                  >
                    {ativo && <span className="h-1.5 w-1.5 rounded-full bg-primary-foreground" />}
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-foreground">{opt.titulo}</div>
                    <p className="mt-0.5 text-xs text-muted-foreground">{opt.descricao}</p>
                  </div>
                </button>
              );
            })}
            {savingComportamento && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Salvando...
              </div>
            )}
          </div>
        </Section>

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
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={conectarGmail}
              disabled={!isAdmin || conectandoGmail}
              className="gap-2"
            >
              {conectandoGmail ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <LinkIcon className="h-4 w-4" />
              )}
              {gmail.email ? "Reconectar Gmail" : "Conectar Gmail"}
            </Button>
            <Button onClick={salvarGmail} disabled={!isAdmin || saving} className="gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Salvar Gmail
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
  headerToggle,
}: {
  icone: typeof Bell;
  titulo: string;
  descricao: string;
  children: React.ReactNode;
  headerToggle?: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean };
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
        {headerToggle && (
          <Switch
            checked={headerToggle.checked}
            onCheckedChange={headerToggle.onChange}
            disabled={headerToggle.disabled}
          />
        )}
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
