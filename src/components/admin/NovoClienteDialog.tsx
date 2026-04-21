import { useEffect, useState } from "react";
import { Loader2, ChevronLeft, ChevronRight, Check } from "lucide-react";
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

interface Plano {
  id: string;
  nome: string;
  limite_pedidos_mes: number;
  preco_mensal: number | null;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated?: () => void;
}

const slugify = (v: string) =>
  v.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50);

const onlyDigits = (v: string) => v.replace(/\D/g, "");

const STEPS = [
  { id: "empresa", label: "Empresa" },
  { id: "endereco", label: "Endereço" },
  { id: "financeiro", label: "Financeiro" },
  { id: "contrato", label: "Contrato" },
  { id: "limites", label: "Limites" },
  { id: "admin", label: "Admin" },
  { id: "obs", label: "Observações" },
] as const;

type FormState = {
  // Empresa
  nome: string; nome_fantasia: string; cnpj: string;
  inscricao_estadual: string; inscricao_municipal: string; slug: string;
  // Endereço
  cep: string; endereco: string; numero_endereco: string; complemento: string;
  bairro: string; cidade: string; estado: string;
  // Financeiro
  responsavel_financeiro: string; email_financeiro: string; telefone: string;
  // Contrato
  plano_id: string; valor_mensal: string; valor_setup: string;
  data_inicio_contrato: string; data_inicio_pagamento: string;
  dia_vencimento: string; forma_pagamento: string;
  data_vencimento_contrato: string; gestor_contrato: string;
  executivo_venda: string; tipo_integracao: string;
  // Limites
  limite_pedidos_mes: string; limite_usuarios: string; valor_excedente: string;
  // Admin
  admin_nome: string; admin_email: string;
  // Obs
  comentarios: string;
};

const initial: FormState = {
  nome: "", nome_fantasia: "", cnpj: "", inscricao_estadual: "", inscricao_municipal: "", slug: "",
  cep: "", endereco: "", numero_endereco: "", complemento: "", bairro: "", cidade: "", estado: "",
  responsavel_financeiro: "", email_financeiro: "", telefone: "",
  plano_id: "", valor_mensal: "", valor_setup: "",
  data_inicio_contrato: "", data_inicio_pagamento: "",
  dia_vencimento: "", forma_pagamento: "",
  data_vencimento_contrato: "", gestor_contrato: "",
  executivo_venda: "", tipo_integracao: "automatizado_api",
  limite_pedidos_mes: "100", limite_usuarios: "5", valor_excedente: "0,50",
  admin_nome: "", admin_email: "",
  comentarios: "",
};

export function NovoClienteDialog({ open, onOpenChange, onCreated }: Props) {
  const [planos, setPlanos] = useState<Plano[]>([]);
  const [loadingPlanos, setLoadingPlanos] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [buscandoCep, setBuscandoCep] = useState(false);
  const [step, setStep] = useState(0);
  const [slugTouched, setSlugTouched] = useState(false);
  const [form, setForm] = useState<FormState>(initial);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((p) => ({ ...p, [k]: v }));

  // Carrega planos quando abre
  useEffect(() => {
    if (!open) return;
    setStep(0);
    setSlugTouched(false);
    setForm(initial);
    setLoadingPlanos(true);
    (supabase as any)
      .from("planos")
      .select("id, nome, limite_pedidos_mes, preco_mensal")
      .order("preco_mensal", { ascending: true, nullsFirst: true })
      .then(({ data, error }: any) => {
        if (error) toast.error("Erro ao carregar planos: " + error.message);
        else setPlanos(data ?? []);
        setLoadingPlanos(false);
      });
  }, [open]);

  // Slug automático a partir do nome
  const onNomeChange = (v: string) => {
    set("nome", v);
    if (!slugTouched) set("slug", slugify(v));
  };

  // Plano: ao escolher, sugere limite e valor mensal
  const onPlanoChange = (id: string) => {
    set("plano_id", id);
    const p = planos.find((x) => x.id === id);
    if (p) {
      set("limite_pedidos_mes", String(p.limite_pedidos_mes));
      if (p.preco_mensal != null) set("valor_mensal", String(p.preco_mensal).replace(".", ","));
    }
  };

  // Busca CEP via ViaCEP
  const buscarCep = async () => {
    const cepLimpo = onlyDigits(form.cep);
    if (cepLimpo.length !== 8) return;
    setBuscandoCep(true);
    try {
      const r = await fetch(`https://viacep.com.br/ws/${cepLimpo}/json/`);
      const d = await r.json();
      if (d.erro) {
        toast.error("CEP não encontrado");
        return;
      }
      setForm((p) => ({
        ...p,
        endereco: d.logradouro ?? p.endereco,
        bairro: d.bairro ?? p.bairro,
        cidade: d.localidade ?? p.cidade,
        estado: d.uf ?? p.estado,
        complemento: d.complemento || p.complemento,
      }));
    } catch (e: any) {
      toast.error("Falha ao buscar CEP");
    } finally {
      setBuscandoCep(false);
    }
  };

  // Validação por step
  const validateStep = (s: number): string | null => {
    if (s === 0) {
      if (!form.nome.trim()) return "Informe o nome da empresa";
      if (!form.slug.trim()) return "Informe o slug";
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
    if (s === 5) {
      if (!form.admin_nome.trim()) return "Informe o nome do admin da empresa";
      if (!form.admin_email.trim() || !/^\S+@\S+\.\S+$/.test(form.admin_email)) return "Informe um e-mail válido para o admin";
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
    // valida último passo
    const err = validateStep(step);
    if (err) return toast.error(err);

    setSalvando(true);
    try {
      const dados = {
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
        plano_id: form.plano_id || null,
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

      // Insere o tenant diretamente. O usuário admin será cadastrado manualmente depois.
      const { error } = await (supabase as any).from("tenants").insert(dados);
      if (error) throw error;

      toast.success("Cliente cadastrado com sucesso");
      onOpenChange(false);
      onCreated?.();
    } catch (e: any) {
      toast.error("Erro ao cadastrar: " + (e?.message ?? e));
    } finally {
      setSalvando(false);
    }
  };

  const isLast = step === STEPS.length - 1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-hidden p-0 sm:max-w-[720px]">
        <DialogHeader className="border-b border-border px-6 pb-4 pt-6">
          <DialogTitle>Novo cliente</DialogTitle>
          <DialogDescription>
            Etapa {step + 1} de {STEPS.length} — {STEPS[step].label}
          </DialogDescription>

          {/* Stepper */}
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
                  aria-current={i === step ? "step" : undefined}
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
          {loadingPlanos ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : (
            <>
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
                      <Input id="cnpj" value={form.cnpj} onChange={(e) => set("cnpj", e.target.value)} placeholder="00.000.000/0000-00" />
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

              {step === 1 && (
                <div className="grid gap-4">
                  <div className="grid grid-cols-[1fr_auto] items-end gap-2">
                    <div className="grid gap-1.5">
                      <Label htmlFor="cep">CEP</Label>
                      <Input
                        id="cep"
                        value={form.cep}
                        onChange={(e) => set("cep", e.target.value)}
                        onBlur={buscarCep}
                        placeholder="00000-000"
                      />
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
                      <Label htmlFor="estado">Estado</Label>
                      <Input id="estado" value={form.estado} maxLength={2} onChange={(e) => set("estado", e.target.value.toUpperCase())} placeholder="SP" />
                    </div>
                  </div>
                </div>
              )}

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

              {step === 3 && (
                <div className="grid gap-4">
                  <div className="grid gap-1.5">
                    <Label htmlFor="plano">Plano</Label>
                    <Select value={form.plano_id || undefined} onValueChange={onPlanoChange}>
                      <SelectTrigger id="plano"><SelectValue placeholder={planos.length === 0 ? "Nenhum plano cadastrado" : "Selecione um plano"} /></SelectTrigger>
                      <SelectContent>
                        {planos.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.nome}
                            {Number.isFinite(Number(p.limite_pedidos_mes)) ? ` — ${Number(p.limite_pedidos_mes).toLocaleString("pt-BR")} pedidos/mês` : ""}
                            {p.preco_mensal != null ? ` · R$ ${Number(p.preco_mensal).toFixed(2).replace(".", ",")}` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
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

              {step === 5 && (
                <div className="grid gap-4">
                  <p className="text-sm text-muted-foreground">
                    Será criado um usuário admin para essa empresa. Se o e-mail já existir no sistema, ele será apenas vinculado ao novo cliente como admin.
                  </p>
                  <div className="grid gap-1.5">
                    <Label htmlFor="admin_nome">Nome do admin *</Label>
                    <Input id="admin_nome" value={form.admin_nome} onChange={(e) => set("admin_nome", e.target.value)} placeholder="João Silva" />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="admin_email">E-mail do admin *</Label>
                    <Input id="admin_email" type="email" value={form.admin_email} onChange={(e) => set("admin_email", e.target.value)} placeholder="admin@empresa.com" />
                  </div>
                </div>
              )}

              {step === 6 && (
                <div className="grid gap-2">
                  <Label htmlFor="comentarios">Comentários</Label>
                  <Textarea id="comentarios" rows={6} value={form.comentarios} onChange={(e) => set("comentarios", e.target.value)} placeholder="Anotações internas sobre este cliente…" />
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border bg-muted/30 px-6 py-4">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={salvando}>
            Cancelar
          </Button>
          <div className="flex items-center gap-2">
            {step > 0 && (
              <Button variant="outline" onClick={goBack} disabled={salvando}>
                <ChevronLeft className="mr-1 h-4 w-4" /> Voltar
              </Button>
            )}
            {!isLast ? (
              <Button onClick={goNext} disabled={loadingPlanos}>
                Próximo <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            ) : (
              <Button onClick={handleSubmit} disabled={salvando}>
                {salvando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Salvar cliente
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
