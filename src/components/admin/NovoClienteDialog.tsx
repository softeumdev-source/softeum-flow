import { useEffect, useState } from "react";
import { Loader2, ChevronLeft, ChevronRight, Check, Building2, MapPin, CreditCard, FileSignature, Gauge, User, MessageSquare } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { CredenciaisDialog } from "./CredenciaisDialog";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated?: () => void;
  tenantId?: string | null;
}

const slugify = (v: string) =>
  v.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50);

const onlyDigits = (v: string) => v.replace(/\D/g, "");

const brl = (v: string) => {
  const n = parseFloat(v.replace(",", "."));
  return Number.isFinite(n) ? n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—";
};

// Validação de CNPJ
const validarCNPJ = (cnpj: string): boolean => {
  const c = onlyDigits(cnpj);
  if (c.length !== 14) return false;
  if (/^(\d)\1+$/.test(c)) return false;
  const calc = (c: string, len: number) => {
    let sum = 0;
    let pos = len - 7;
    for (let i = len; i >= 1; i--) {
      sum += parseInt(c[len - i]) * pos--;
      if (pos < 2) pos = 9;
    }
    return sum % 11 < 2 ? 0 : 11 - (sum % 11);
  };
  return calc(c, 12) === parseInt(c[12]) && calc(c, 13) === parseInt(c[13]);
};

const STEPS = [
  { id: "empresa", label: "Empresa", icon: Building2 },
  { id: "endereco", label: "Endereço", icon: MapPin },
  { id: "financeiro", label: "Financeiro", icon: CreditCard },
  { id: "contrato", label: "Contrato", icon: FileSignature },
  { id: "limites", label: "Limites", icon: Gauge },
  { id: "admin", label: "Admin", icon: User },
  { id: "obs", label: "Resumo", icon: MessageSquare },
] as const;

type FormState = {
  nome: string; nome_fantasia: string; cnpj: string;
  inscricao_estadual: string; inscricao_municipal: string; slug: string;
  cep: string; endereco: string; numero_endereco: string; complemento: string;
  bairro: string; cidade: string; estado: string;
  responsavel_financeiro: string; email_financeiro: string; telefone: string;
  plano_nome: string; valor_mensal: string; valor_setup: string;
  data_inicio_contrato: string; data_inicio_pagamento: string;
  dia_vencimento: string; forma_pagamento: string;
  data_vencimento_contrato: string; gestor_contrato: string;
  executivo_venda: string; tipo_integracao: string;
  limite_pedidos_mes: string; limite_usuarios: string; valor_excedente: string;
  admin_nome: string; admin_email: string;
  comentarios: string;
};

const initial: FormState = {
  nome: "", nome_fantasia: "", cnpj: "", inscricao_estadual: "", inscricao_municipal: "", slug: "",
  cep: "", endereco: "", numero_endereco: "", complemento: "", bairro: "", cidade: "", estado: "",
  responsavel_financeiro: "", email_financeiro: "", telefone: "",
  plano_nome: "", valor_mensal: "", valor_setup: "",
  data_inicio_contrato: "", data_inicio_pagamento: "",
  dia_vencimento: "", forma_pagamento: "",
  data_vencimento_contrato: "", gestor_contrato: "",
  executivo_venda: "", tipo_integracao: "automatizado_api",
  limite_pedidos_mes: "100", limite_usuarios: "5", valor_excedente: "0,50",
  admin_nome: "", admin_email: "",
  comentarios: "",
};

export function NovoClienteDialog({ open, onOpenChange, onCreated, tenantId }: Props) {
  const isEdit = !!tenantId;
  const [carregandoTenant, setCarregandoTenant] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [buscandoCep, setBuscandoCep] = useState(false);
  const [step, setStep] = useState(0);
  const [slugTouched, setSlugTouched] = useState(false);
  const [cnpjValido, setCnpjValido] = useState<boolean | null>(null);
  const [form, setForm] = useState<FormState>(initial);
  const [credOpen, setCredOpen] = useState(false);
  const [credData, setCredData] = useState<{ email: string; senha: string; empresa: string } | null>(null);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    if (!open) return;
    setStep(0);
    setSlugTouched(isEdit);
    setForm(initial);
    setCnpjValido(null);

    if (isEdit && tenantId) {
      setCarregandoTenant(true);
      const sb = supabase as any;
      sb.from("tenants").select("*").eq("id", tenantId).maybeSingle().then(({ data: t, error: eT }: any) => {
        if (eT) toast.error("Erro ao carregar cliente: " + eT.message);
        else if (t) {
          const numToStr = (n: any) => n === null || n === undefined ? "" : String(n).replace(".", ",");
          setForm({
            nome: t.nome ?? "",
            nome_fantasia: t.nome_fantasia ?? "",
            cnpj: t.cnpj ?? "",
            inscricao_estadual: t.inscricao_estadual ?? "",
            inscricao_municipal: t.inscricao_municipal ?? "",
            slug: t.slug ?? "",
            cep: t.cep ?? "",
            endereco: t.endereco ?? "",
            numero_endereco: t.numero_endereco ?? "",
            complemento: t.complemento ?? "",
            bairro: t.bairro ?? "",
            cidade: t.cidade ?? "",
            estado: t.estado ?? "",
            responsavel_financeiro: t.responsavel_financeiro ?? "",
            email_financeiro: t.email_financeiro ?? "",
            telefone: t.telefone ?? "",
            plano_nome: t.plano_nome ?? "",
            valor_mensal: numToStr(t.valor_mensal),
            valor_setup: numToStr(t.valor_setup),
            data_inicio_contrato: t.data_inicio_contrato ?? "",
            data_inicio_pagamento: t.data_inicio_pagamento ?? "",
            dia_vencimento: t.dia_vencimento != null ? String(t.dia_vencimento) : "",
            forma_pagamento: t.forma_pagamento ?? "",
            data_vencimento_contrato: t.data_vencimento_contrato ?? "",
            gestor_contrato: t.gestor_contrato ?? "",
            executivo_venda: t.executivo_venda ?? "",
            tipo_integracao: t.tipo_integracao ?? "automatizado_api",
            limite_pedidos_mes: t.limite_pedidos_mes != null ? String(t.limite_pedidos_mes) : "100",
            limite_usuarios: t.limite_usuarios != null ? String(t.limite_usuarios) : "5",
            valor_excedente: numToStr(t.valor_excedente) || "0,50",
            admin_nome: "",
            admin_email: "",
            comentarios: t.comentarios ?? "",
          });
        }
        setCarregandoTenant(false);
      });
    }
  }, [open, tenantId, isEdit]);

  const onNomeChange = (v: string) => {
    set("nome", v);
    if (!slugTouched) set("slug", slugify(v));
  };

  const onCnpjChange = (v: string) => {
    set("cnpj", v);
    const digits = onlyDigits(v);
    if (digits.length === 14) setCnpjValido(validarCNPJ(v));
    else setCnpjValido(null);
  };

  const buscarCep = async () => {
    const cepLimpo = onlyDigits(form.cep);
    if (cepLimpo.length !== 8) return;
    setBuscandoCep(true);
    try {
      const r = await fetch(`https://viacep.com.br/ws/${cepLimpo}/json/`);
      const d = await r.json();
      if (d.erro) { toast.error("CEP não encontrado"); return; }
      setForm((p) => ({
        ...p,
        endereco: d.logradouro ?? p.endereco,
        bairro: d.bairro ?? p.bairro,
        cidade: d.localidade ?? p.cidade,
        estado: d.uf ?? p.estado,
        complemento: d.complemento || p.complemento,
      }));
    } catch { toast.error("Falha ao buscar CEP"); }
    finally { setBuscandoCep(false); }
  };

  const validateStep = (s: number): string | null => {
    if (s === 0) {
      if (!form.nome.trim()) return "Informe o nome da empresa";
      if (!form.slug.trim()) return "Informe o slug";
      if (form.cnpj && onlyDigits(form.cnpj).length === 14 && !validarCNPJ(form.cnpj)) return "CNPJ inválido";
    }
    if (s === 2) {
      if (form.email_financeiro && !/^\S+@\S+\.\S+$/.test(form.email_financeiro)) return "E-mail financeiro inválido";
    }
    if (s === 3) {
      if (form.dia_vencimento) {
        const d = parseInt(form.dia_vencimento, 10);
        if (!Number.isFinite(d) || d < 1 || d > 31) return "Dia de vencimento deve estar entre 1 e 31";
      }
    }
    if (s === 4) {
      const lp = parseInt(form.limite_pedidos_mes, 10);
      if (!Number.isFinite(lp) || lp <= 0) return "Limite de documentos inválido";
      const lu = parseInt(form.limite_usuarios, 10);
      if (!Number.isFinite(lu) || lu <= 0) return "Limite de usuários inválido";
      const ve = parseFloat(form.valor_excedente.replace(",", "."));
      if (!Number.isFinite(ve) || ve < 0) return "Valor excedente inválido";
    }
    if (s === 5 && !isEdit) {
      if (!form.admin_nome.trim()) return "Informe o nome do admin";
      if (!form.admin_email.trim() || !/^\S+@\S+\.\S+$/.test(form.admin_email)) return "E-mail do admin inválido";
    }
    return null;
  };

  const goNext = () => {
    const err = validateStep(step);
    if (err) return toast.error(err);
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
  };
  const goBack = () => setStep((s) => Math.max(0, s - 1));

  const parseNum = (v: string) => {
    const n = parseFloat(v.replace(",", "."));
    return Number.isFinite(n) ? n : null;
  };

  const handleSubmit = async () => {
    const err = validateStep(step);
    if (err) return toast.error(err);
    setSalvando(true);
    try {
      const dados: any = {
        nome: form.nome.trim(),
        slug: form.slug.trim(),
        nome_fantasia: form.nome_fantasia.trim() || null,
        cnpj: onlyDigits(form.cnpj) || null,
        inscricao_estadual: form.inscricao_estadual.trim() || null,
        inscricao_municipal: form.inscricao_municipal.trim() || null,
        cep: onlyDigits(form.cep) || null,
        endereco: form.endereco.trim() || null,
        numero_endereco: form.numero_endereco.trim() || null,
        complemento: form.complemento.trim() || null,
        bairro: form.bairro.trim() || null,
        cidade: form.cidade.trim() || null,
        estado: form.estado.trim() || null,
        responsavel_financeiro: form.responsavel_financeiro.trim() || null,
        email_financeiro: form.email_financeiro.trim() || null,
        telefone: onlyDigits(form.telefone) || null,
        plano_nome: form.plano_nome.trim() || null,
        valor_mensal: parseNum(form.valor_mensal),
        valor_setup: parseNum(form.valor_setup),
        data_inicio_contrato: form.data_inicio_contrato || null,
        data_inicio_pagamento: form.data_inicio_pagamento || null,
        dia_vencimento: form.dia_vencimento ? parseInt(form.dia_vencimento, 10) : null,
        forma_pagamento: form.forma_pagamento || null,
        data_vencimento_contrato: form.data_vencimento_contrato || null,
        gestor_contrato: form.gestor_contrato.trim() || null,
        executivo_venda: form.executivo_venda.trim() || null,
        tipo_integracao: form.tipo_integracao || null,
        limite_pedidos_mes: parseInt(form.limite_pedidos_mes, 10),
        limite_usuarios: parseInt(form.limite_usuarios, 10),
        valor_excedente: parseNum(form.valor_excedente),
        comentarios: form.comentarios.trim() || null,
      };

      const sb = supabase as any;
      if (isEdit && tenantId) {
        const { error } = await sb.from("tenants").update(dados).eq("id", tenantId);
        if (error) throw error;
        toast.success("Cliente atualizado com sucesso");
        onOpenChange(false);
        onCreated?.();
      } else {
        const baseSlug = dados.slug;
        let slugFinal = baseSlug;
        let tentativa = 2;
        while (tentativa <= 50) {
          const { data: existe } = await sb.from("tenants").select("id").eq("slug", slugFinal).maybeSingle();
          if (!existe) break;
          slugFinal = `${baseSlug}-${tentativa}`;
          tentativa++;
        }
        dados.slug = slugFinal;

        const { data: novo, error } = await sb.from("tenants").insert(dados).select("id").single();
        if (error) throw error;

        const { data: sessionData } = await supabase.auth.getSession();
        const accessToken = sessionData.session?.access_token;
        const SUPABASE_URL = "https://arihejdirnhmcwuhkzde.supabase.co";
        const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFyaWhlamRpcm5obWN3dWhremRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3Mzk5MzAsImV4cCI6MjA5MjMxNTkzMH0.JNcv6mm_eNS__TvctUCalot1OcKxIUZPAtkslRya1Cg";

        let respFn: any = null;
        let fnErrMsg: string | null = null;
        try {
          const resp = await fetch(`${SUPABASE_URL}/functions/v1/criar-usuario-tenant`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              apikey: SUPABASE_ANON_KEY,
              Authorization: `Bearer ${accessToken ?? SUPABASE_ANON_KEY}`,
            },
            body: JSON.stringify({ tenant_id: novo.id, admin_nome: form.admin_nome.trim(), admin_email: form.admin_email.trim(), empresa_nome: form.nome.trim() }),
          });
          const text = await resp.text();
          try { respFn = text ? JSON.parse(text) : null; } catch { respFn = { error: text }; }
          if (!resp.ok) fnErrMsg = respFn?.error ?? `Edge function retornou ${resp.status}`;
        } catch (e: any) { fnErrMsg = e?.message ?? String(e); }

        if (fnErrMsg || !respFn?.sucesso) {
          toast.error("Cliente criado, mas falhou ao criar o usuário admin", { description: fnErrMsg ?? respFn?.error ?? "Erro desconhecido" });
          onOpenChange(false);
          onCreated?.();
          return;
        }

        toast.success("Cliente cadastrado com sucesso");
        setCredData({ email: respFn.email, senha: respFn.senha_provisoria, empresa: form.nome.trim() });
        setCredOpen(true);
        onCreated?.();
      }
    } catch (e: any) {
      toast.error("Erro ao salvar: " + (e?.message ?? e));
    } finally {
      setSalvando(false);
    }
  };

  const isLast = step === STEPS.length - 1;
  const dataFmt = (iso: string) => iso ? new Date(iso + "T12:00:00").toLocaleDateString("pt-BR") : "—";
  const formaFmt = (v: string) => ({ boleto: "Boleto", pix: "PIX", cartao: "Cartão" }[v] ?? v || "—");
  const integFmt = (v: string) => ({ automatizado_api: "Automatizado via API", exportacao_arquivo: "Exportação de arquivo" }[v] ?? v || "—");

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-hidden p-0 sm:max-w-[720px]">
          <DialogHeader className="border-b border-border px-6 pb-4 pt-6">
            <DialogTitle>{isEdit ? "Editar cliente" : "Novo cliente"}</DialogTitle>
            <DialogDescription>
              Etapa {step + 1} de {STEPS.length} — {STEPS[step].label}
            </DialogDescription>
            <div className="mt-4 flex items-center gap-1.5">
              {STEPS.map((s, i) => (
                <div key={s.id} className="flex flex-1 items-center gap-1.5">
                  <div
                    className={cn(
                      "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold transition-colors",
                      i < step && "bg-primary text-primary-foreground",
                      i === step && "bg-primary text-primary-foreground ring-2 ring-primary/30",
                      i > step && "bg-muted text-muted-foreground",
                    )}
                  >
                    {i < step ? <Check className="h-3 w-3" /> : i + 1}
                  </div>
                  {i < STEPS.length - 1 && (
                    <div className={cn("h-0.5 flex-1 rounded-full", i < step ? "bg-primary" : "bg-muted")} />
                  )}
                </div>
              ))}
            </div>
          </DialogHeader>

          <div className="max-h-[60vh] overflow-y-auto px-6 py-5">
            {carregandoTenant ? (
              <div className="flex h-40 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : (
              <>
                {/* STEP 0 — Empresa */}
                {step === 0 && (
                  <div className="grid gap-4">
                    <div className="grid gap-1.5">
                      <Label htmlFor="nome">Nome da empresa *</Label>
                      <Input id="nome" value={form.nome} onChange={(e) => onNomeChange(e.target.value)} placeholder="Acme Indústria Ltda" />
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="nome_fantasia">Nome fantasia</Label>
                      <Input id="nome_fantasia" value={form.nome_fantasia} onChange={(e) => set("nome_fantasia", e.target.value)} placeholder="Acme" />
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="grid gap-1.5">
                        <Label htmlFor="cnpj">CNPJ</Label>
                        <div className="relative">
                          <Input
                            id="cnpj"
                            value={form.cnpj}
                            onChange={(e) => onCnpjChange(e.target.value)}
                            placeholder="00.000.000/0000-00"
                            className={cn(
                              cnpjValido === true && "border-success ring-1 ring-success/30",
                              cnpjValido === false && "border-destructive ring-1 ring-destructive/30",
                            )}
                          />
                          {cnpjValido === true && <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-success">✓ Válido</span>}
                          {cnpjValido === false && <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-destructive">✗ Inválido</span>}
                        </div>
                      </div>
                      <div className="grid gap-1.5">
                        <Label htmlFor="ie">Inscrição estadual</Label>
                        <Input id="ie" value={form.inscricao_estadual} onChange={(e) => set("inscricao_estadual", e.target.value)} />
                      </div>
                      <div className="grid gap-1.5">
                        <Label htmlFor="im">Inscrição municipal</Label>
                        <Input id="im" value={form.inscricao_municipal} onChange={(e) => set("inscricao_municipal", e.target.value)} />
                      </div>
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="slug">Slug *</Label>
                      <Input
                        id="slug"
                        value={form.slug}
                        onChange={(e) => { setSlugTouched(true); set("slug", slugify(e.target.value)); }}
                        placeholder="acme-industria"
                      />
                      <p className="text-xs text-muted-foreground">Identificador único da empresa, gerado automaticamente.</p>
                    </div>
                  </div>
                )}

                {/* STEP 1 — Endereço */}
                {step === 1 && (
                  <div className="grid gap-4">
                    <div className="grid grid-cols-[1fr_auto] items-end gap-2">
                      <div className="grid gap-1.5">
                        <Label htmlFor="cep">CEP</Label>
                        <Input id="cep" value={form.cep} onChange={(e) => set("cep", e.target.value)} onBlur={buscarCep} placeholder="00000-000" />
                      </div>
                      <Button type="button" variant="outline" size="sm" onClick={buscarCep} disabled={buscandoCep || onlyDigits(form.cep).length !== 8}>
                        {buscandoCep ? <Loader2 className="h-4 w-4 animate-spin" /> : "Buscar"}
                      </Button>
                    </div>
                    <div className="grid grid-cols-[1fr_120px] gap-3">
                      <div className="grid gap-1.5">
                        <Label htmlFor="endereco">Endereço</Label>
                        <Input id="endereco" value={form.endereco} onChange={(e) => set("endereco", e.target.value)} />
                      </div>
                      <div className="grid gap-1.5">
                        <Label htmlFor="numero_endereco">Número</Label>
                        <Input id="numero_endereco" value={form.numero_endereco} onChange={(e) => set("numero_endereco", e.target.value)} />
                      </div>
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="complemento">Complemento</Label>
                      <Input id="complemento" value={form.complemento} onChange={(e) => set("complemento", e.target.value)} />
                    </div>
                    <div className="grid grid-cols-[1fr_1fr_100px] gap-3">
                      <div className="grid gap-1.5">
                        <Label htmlFor="bairro">Bairro</Label>
                        <Input id="bairro" value={form.bairro} onChange={(e) => set("bairro", e.target.value)} />
                      </div>
                      <div className="grid gap-1.5">
                        <Label htmlFor="cidade">Cidade</Label>
                        <Input id="cidade" value={form.cidade} onChange={(e) => set("cidade", e.target.value)} />
                      </div>
                      <div className="grid gap-1.5">
                        <Label htmlFor="estado">UF</Label>
                        <Input id="estado" value={form.estado} maxLength={2} onChange={(e) => set("estado", e.target.value.toUpperCase())} placeholder="SP" />
                      </div>
                    </div>
                  </div>
                )}

                {/* STEP 2 — Financeiro */}
                {step === 2 && (
                  <div className="grid gap-4">
                    <div className="grid gap-1.5">
                      <Label htmlFor="resp">Nome do responsável financeiro</Label>
                      <Input id="resp" value={form.responsavel_financeiro} onChange={(e) => set("responsavel_financeiro", e.target.value)} />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="grid gap-1.5">
                        <Label htmlFor="email_fin">E-mail financeiro</Label>
                        <Input id="email_fin" type="email" value={form.email_financeiro} onChange={(e) => set("email_financeiro", e.target.value)} placeholder="financeiro@empresa.com" />
                      </div>
                      <div className="grid gap-1.5">
                        <Label htmlFor="tel">Telefone</Label>
                        <Input id="tel" value={form.telefone} onChange={(e) => set("telefone", e.target.value)} placeholder="(11) 99999-9999" />
                      </div>
                    </div>
                  </div>
                )}

                {/* STEP 3 — Contrato */}
                {step === 3 && (
                  <div className="grid gap-4">
                    <div className="grid gap-1.5">
                      <Label htmlFor="plano_nome">Plano</Label>
                      <Input
                        id="plano_nome"
                        value={form.plano_nome}
                        onChange={(e) => set("plano_nome", e.target.value)}
                        placeholder="Ex: Starter, Pro, Enterprise..."
                      />
                      <p className="text-xs text-muted-foreground">Digite o nome do plano contratado pelo cliente.</p>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="grid gap-1.5">
                        <Label htmlFor="valor_mensal">Valor mensal (R$)</Label>
                        <Input id="valor_mensal" inputMode="decimal" value={form.valor_mensal} onChange={(e) => set("valor_mensal", e.target.value)} placeholder="0,00" />
                      </div>
                      <div className="grid gap-1.5">
                        <Label htmlFor="valor_setup">Valor do Setup (R$)</Label>
                        <Input id="valor_setup" inputMode="decimal" value={form.valor_setup} onChange={(e) => set("valor_setup", e.target.value)} placeholder="0,00" />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="grid gap-1.5">
                        <Label htmlFor="dic">Início do contrato</Label>
                        <Input id="dic" type="date" value={form.data_inicio_contrato} onChange={(e) => set("data_inicio_contrato", e.target.value)} />
                      </div>
                      <div className="grid gap-1.5">
                        <Label htmlFor="dip">Início do pagamento</Label>
                        <Input id="dip" type="date" value={form.data_inicio_pagamento} onChange={(e) => set("data_inicio_pagamento", e.target.value)} />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="grid gap-1.5">
                        <Label htmlFor="dv">Dia de vencimento da fatura</Label>
                        <Input id="dv" type="number" min={1} max={31} value={form.dia_vencimento} onChange={(e) => set("dia_vencimento", e.target.value)} placeholder="10" />
                      </div>
                      <div className="grid gap-1.5">
                        <Label htmlFor="fp">Forma de pagamento</Label>
                        <Select value={form.forma_pagamento || undefined} onValueChange={(v) => set("forma_pagamento", v)}>
                          <SelectTrigger id="fp"><SelectValue placeholder="Selecione" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="boleto">Boleto</SelectItem>
                            <SelectItem value="pix">PIX</SelectItem>
                            <SelectItem value="cartao">Cartão</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="dvc">Vencimento do contrato</Label>
                      <Input id="dvc" type="date" value={form.data_vencimento_contrato} onChange={(e) => set("data_vencimento_contrato", e.target.value)} />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="grid gap-1.5">
                        <Label htmlFor="gc">Gestor do contrato</Label>
                        <Input id="gc" value={form.gestor_contrato} onChange={(e) => set("gestor_contrato", e.target.value)} />
                      </div>
                      <div className="grid gap-1.5">
                        <Label htmlFor="ev">Executivo que fez a venda</Label>
                        <Input id="ev" value={form.executivo_venda} onChange={(e) => set("executivo_venda", e.target.value)} />
                      </div>
                    </div>
                    <div className="grid gap-2">
                      <Label>Tipo de integração</Label>
                      <RadioGroup value={form.tipo_integracao} onValueChange={(v) => set("tipo_integracao", v)} className="grid grid-cols-2 gap-2">
                        <div className={cn("flex cursor-pointer items-center gap-2 rounded-lg border border-border p-3 text-sm transition-colors hover:bg-muted/50", form.tipo_integracao === "automatizado_api" && "border-primary bg-accent")}>
                          <RadioGroupItem value="automatizado_api" id="ti-api" />
                          <Label htmlFor="ti-api" className="cursor-pointer font-normal">Automatizado via API</Label>
                        </div>
                        <div className={cn("flex cursor-pointer items-center gap-2 rounded-lg border border-border p-3 text-sm transition-colors hover:bg-muted/50", form.tipo_integracao === "exportacao_arquivo" && "border-primary bg-accent")}>
                          <RadioGroupItem value="exportacao_arquivo" id="ti-arq" />
                          <Label htmlFor="ti-arq" className="cursor-pointer font-normal">Exportação de arquivo</Label>
                        </div>
                      </RadioGroup>
                    </div>
                  </div>
                )}

                {/* STEP 4 — Limites */}
                {step === 4 && (
                  <div className="grid gap-4">
                    <div className="grid grid-cols-3 gap-3">
                      <div className="grid gap-1.5">
                        <Label htmlFor="lpm">Documentos / mês *</Label>
                        <Input id="lpm" type="number" min={1} value={form.limite_pedidos_mes} onChange={(e) => set("limite_pedidos_mes", e.target.value)} />
                      </div>
                      <div className="grid gap-1.5">
                        <Label htmlFor="lu">Limite de usuários *</Label>
                        <Input id="lu" type="number" min={1} value={form.limite_usuarios} onChange={(e) => set("limite_usuarios", e.target.value)} />
                      </div>
                      <div className="grid gap-1.5">
                        <Label htmlFor="ve">Valor excedente (R$) *</Label>
                        <Input id="ve" inputMode="decimal" value={form.valor_excedente} onChange={(e) => set("valor_excedente", e.target.value)} placeholder="0,50" />
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      O valor excedente é cobrado por cada documento processado acima do limite mensal.
                    </p>
                  </div>
                )}

                {/* STEP 5 — Admin */}
                {step === 5 && (
                  <div className="grid gap-4">
                    {isEdit ? (
                      <div className="rounded-lg border border-border bg-muted/40 p-4 text-sm text-foreground">
                        <p className="text-xs leading-relaxed opacity-90">
                          Os dados do administrador não são alterados nesta tela. Para gerenciar membros, acesse a aba <strong>Equipe</strong> do cliente.
                        </p>
                      </div>
                    ) : (
                      <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm text-foreground">
                        <p className="mb-1 font-medium">Usuário admin do cliente</p>
                        <p className="text-xs leading-relaxed text-muted-foreground">
                          Será criado um usuário com papel <strong>admin</strong> vinculado a esta empresa. Ao concluir, exibiremos a senha provisória.
                        </p>
                      </div>
                    )}
                    <div className="grid gap-1.5">
                      <Label htmlFor="admin_nome">Nome do admin {!isEdit && "*"}</Label>
                      <Input id="admin_nome" value={form.admin_nome} onChange={(e) => set("admin_nome", e.target.value)} placeholder="João Silva" disabled={isEdit} />
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="admin_email">E-mail do admin {!isEdit && "*"}</Label>
                      <Input id="admin_email" type="email" value={form.admin_email} onChange={(e) => set("admin_email", e.target.value)} placeholder="admin@empresa.com" disabled={isEdit} />
                    </div>
                  </div>
                )}

                {/* STEP 6 — Resumo */}
                {step === 6 && (
                  <div className="grid gap-4">
                    <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
                      <p className="text-xs font-medium text-primary">Revise os dados antes de salvar</p>
                    </div>

                    <ResumoSecao titulo="Empresa">
                      <ResumoItem label="Nome" value={form.nome} />
                      <ResumoItem label="Nome fantasia" value={form.nome_fantasia} />
                      <ResumoItem label="CNPJ" value={form.cnpj} />
                      <ResumoItem label="Slug" value={form.slug} />
                    </ResumoSecao>

                    {(form.cidade || form.estado || form.endereco) && (
                      <ResumoSecao titulo="Endereço">
                        <ResumoItem label="Endereço" value={[form.endereco, form.numero_endereco].filter(Boolean).join(", ")} />
                        <ResumoItem label="Cidade/UF" value={[form.cidade, form.estado].filter(Boolean).join(" / ")} />
                      </ResumoSecao>
                    )}

                    <ResumoSecao titulo="Contrato">
                      <ResumoItem label="Plano" value={form.plano_nome} />
                      <ResumoItem label="Valor mensal" value={form.valor_mensal ? brl(form.valor_mensal) : ""} />
                      <ResumoItem label="Setup" value={form.valor_setup ? brl(form.valor_setup) : ""} />
                      <ResumoItem label="Vencimento" value={form.dia_vencimento ? `Dia ${form.dia_vencimento}` : ""} />
                      <ResumoItem label="Forma de pagamento" value={formaFmt(form.forma_pagamento)} />
                      <ResumoItem label="Integração" value={integFmt(form.tipo_integracao)} />
                      <ResumoItem label="Início contrato" value={dataFmt(form.data_inicio_contrato)} />
                    </ResumoSecao>

                    <ResumoSecao titulo="Limites">
                      <ResumoItem label="Documentos/mês" value={form.limite_pedidos_mes} />
                      <ResumoItem label="Usuários" value={form.limite_usuarios} />
                      <ResumoItem label="Valor excedente" value={form.valor_excedente ? brl(form.valor_excedente) : ""} />
                    </ResumoSecao>

                    {!isEdit && (
                      <ResumoSecao titulo="Admin">
                        <ResumoItem label="Nome" value={form.admin_nome} />
                        <ResumoItem label="E-mail" value={form.admin_email} />
                      </ResumoSecao>
                    )}

                    {form.comentarios && (
                      <ResumoSecao titulo="Comentários">
                        <p className="text-sm text-foreground">{form.comentarios}</p>
                      </ResumoSecao>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          <div className="flex items-center justify-between border-t border-border bg-muted/30 px-6 py-4">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={salvando}>Cancelar</Button>
            <div className="flex items-center gap-2">
              {step > 0 && (
                <Button variant="outline" onClick={goBack} disabled={salvando}>
                  <ChevronLeft className="mr-1 h-4 w-4" /> Voltar
                </Button>
              )}
              {!isLast ? (
                <Button onClick={goNext} disabled={carregandoTenant}>
                  Próximo <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              ) : (
                <Button onClick={handleSubmit} disabled={salvando}>
                  {salvando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {isEdit ? "Salvar alterações" : "Salvar cliente"}
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {credData && (
        <CredenciaisDialog
          open={credOpen}
          onOpenChange={(v) => { setCredOpen(v); if (!v) { setCredData(null); onOpenChange(false); } }}
          email={credData.email}
          senha={credData.senha}
          empresaNome={credData.empresa}
        />
      )}
    </>
  );
}

function ResumoSecao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{titulo}</p>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function ResumoItem({ label, value }: { label: string; value: string }) {
  if (!value || value === "—") return null;
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-foreground text-right">{value}</span>
    </div>
  );
}
