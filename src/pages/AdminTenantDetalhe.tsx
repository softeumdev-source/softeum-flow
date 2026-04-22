import React, { useEffect, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Building2, Users, FileText, DollarSign, AlertTriangle, Loader2, Mail, Shield, User as UserIcon, CheckCircle2, Lock, Unlock, MapPin, CreditCard, FileSignature, Gauge, Briefcase, Trash2, Pencil, KeyRound, Power, PowerOff, Clock } from "lucide-react";
import { ExcluirTenantDialog } from "@/components/admin/ExcluirTenantDialog";
import { NovoClienteDialog } from "@/components/admin/NovoClienteDialog";
import { DocumentosTenant } from "@/components/admin/DocumentosTenant";
import { CredenciaisDialog } from "@/components/admin/CredenciaisDialog";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Tenant {
  id: string;
  nome: string;
  slug: string;
  ativo: boolean;
  limite_pedidos_mes: number | null;
  limite_usuarios: number | null;
  notas: string | null;
  created_at: string | null;
  plano_id: string | null;
  bloqueado_em: string | null;
  motivo_bloqueio: string | null;
  // Empresa
  nome_fantasia: string | null;
  cnpj: string | null;
  inscricao_estadual: string | null;
  inscricao_municipal: string | null;
  // Endereço
  cep: string | null;
  endereco: string | null;
  numero_endereco: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  estado: string | null;
  // Financeiro
  responsavel_financeiro: string | null;
  email_financeiro: string | null;
  telefone: string | null;
  valor_mensal: number | null;
  valor_setup: number | null;
  valor_excedente: number | null;
  forma_pagamento: string | null;
  dia_vencimento: number | null;
  // Contrato
  data_inicio_contrato: string | null;
  data_inicio_pagamento: string | null;
  data_vencimento_contrato: string | null;
  gestor_contrato: string | null;
  executivo_venda: string | null;
  tipo_integracao: string | null;
  comentarios: string | null;
}

interface UsoMes {
  ano_mes: string;
  pedidos_processados: number;
  total_previsto_processado: number;
  erros_ia: number;
}

interface Membro {
  id: string;
  nome: string | null;
  papel: "admin" | "operador";
  ativo: boolean;
  user_id: string;
  email?: string | null;
  created_at?: string | null;
  ultimo_acesso?: string | null;
  last_sign_in_at?: string | null;
}

interface Plano {
  id: string;
  nome: string;
  preco_mensal: number | null;
}

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const num = (v: number) => v.toLocaleString("pt-BR");
const dataFmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR") : "-");
const formatAnoMes = (am: string) => {
  const [ano, mes] = am.split("-");
  const meses = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  return `${meses[parseInt(mes, 10) - 1]}/${ano}`;
};
const anoMesAtual = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

export default function AdminTenantDetalhe() {
  const { id } = useParams<{ id: string }>();
  const [loading, setLoading] = useState(true);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [plano, setPlano] = useState<Plano | null>(null);
  const [uso, setUso] = useState<UsoMes[]>([]);
  const [membros, setMembros] = useState<Membro[]>([]);
  const [valorExcedente, setValorExcedente] = useState<number>(0);
  const [excedenteCobradoEm, setExcedenteCobradoEm] = useState<string | null>(null);
  const [marcando, setMarcando] = useState(false);
  const [bloqueioOpen, setBloqueioOpen] = useState(false);
  const [desbloqueioOpen, setDesbloqueioOpen] = useState(false);
  const [excluirOpen, setExcluirOpen] = useState(false);
  const [editarOpen, setEditarOpen] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [salvandoBloqueio, setSalvandoBloqueio] = useState(false);

  // Gestão de membros
  const [resetTarget, setResetTarget] = useState<Membro | null>(null);
  const [resetando, setResetando] = useState(false);
  const [credOpen, setCredOpen] = useState(false);
  const [credDados, setCredDados] = useState<{ email: string; senha: string; nome?: string } | null>(null);
  const [toggleTarget, setToggleTarget] = useState<Membro | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const navigate = useNavigate();

  const carregarMembros = async () => {
    if (!id) return;
    try {
      const sb = supabase as any;
      const { data, error } = await sb
        .from("tenant_membros")
        .select("id, nome, papel, ativo, user_id, created_at, ultimo_acesso")
        .eq("tenant_id", id)
        .order("ativo", { ascending: false })
        .order("papel", { ascending: true });
      if (error) throw error;
      setMembros((data ?? []) as Membro[]);
    } catch (e: any) {
      console.error("carregarMembros erro:", e);
      toast.error("Erro ao carregar membros: " + (e?.message ?? e));
      setMembros([]);
    }
  };

  const load = async () => {
    if (!id) return;
    setLoading(true);
    try {
      const sb = supabase as any;
      const [{ data: t, error: e1 }, { data: u, error: e2 }, { data: cfgs, error: e4 }] = await Promise.all([
        sb.from("tenants").select("*").eq("id", id).maybeSingle(),
        sb.from("tenant_uso").select("ano_mes, pedidos_processados, total_previsto_processado, erros_ia").eq("tenant_id", id).order("ano_mes", { ascending: false }).limit(12),
        sb.from("configuracoes").select("chave, valor").eq("tenant_id", id).in("chave", ["valor_excedente", "excedente_cobrado_em"]),
      ]);
      if (e1) throw e1;
      if (e2) throw e2;
      if (e4) throw e4;
      setTenant(t);
      setUso(u ?? []);

      // Membros (com email/last_sign_in via edge function)
      await carregarMembros();

      const cfgMap = new Map<string, string | null>();
      (cfgs ?? []).forEach((c: any) => cfgMap.set(c.chave, c.valor));
      setValorExcedente(parseFloat(cfgMap.get("valor_excedente") ?? "0") || 0);
      setExcedenteCobradoEm(cfgMap.get("excedente_cobrado_em") ?? null);

      if (t?.plano_id) {
        const { data: p } = await sb.from("planos").select("id, nome, preco_mensal").eq("id", t.plano_id).maybeSingle();
        setPlano(p);
      } else {
        setPlano(null);
      }
    } catch (e: any) {
      toast.error("Erro ao carregar tenant: " + (e?.message ?? e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [id]);

  const confirmarReset = async () => {
    if (!resetTarget || !id) return;
    if (!resetTarget.email) {
      toast.error("Membro sem e-mail cadastrado — não é possível redefinir senha.");
      return;
    }
    setResetando(true);
    try {
      // Reusa a edge function criar-usuario-tenant: ela detecta usuário existente
      // pelo e-mail e gera uma nova senha provisória (Softeum1234!).
      const { data, error } = await supabase.functions.invoke("criar-usuario-tenant", {
        body: {
          tenant_id: id,
          admin_email: resetTarget.email,
          admin_nome: resetTarget.nome ?? resetTarget.email,
          papel: resetTarget.papel,
        },
      });
      if (error) throw error;
      const payload = data as any;
      if (payload?.error) throw new Error(payload.error);
      setCredDados({
        email: payload.email ?? resetTarget.email,
        senha: payload.senha_provisoria,
        nome: resetTarget.nome ?? undefined,
      });
      setResetTarget(null);
      setCredOpen(true);
      toast.success("Senha redefinida com sucesso");
    } catch (e: any) {
      toast.error("Erro ao redefinir senha: " + (e?.message ?? e));
    } finally {
      setResetando(false);
    }
  };

  const confirmarToggle = async () => {
    if (!toggleTarget || !id) return;
    const novoAtivo = !toggleTarget.ativo;
    setTogglingId(toggleTarget.id);
    try {
      const sb = supabase as any;
      const { error } = await sb
        .from("tenant_membros")
        .update({ ativo: novoAtivo })
        .eq("id", toggleTarget.id)
        .eq("tenant_id", id);
      if (error) throw error;
      toast.success(novoAtivo ? "Membro ativado" : "Membro desativado");
      setToggleTarget(null);
      await carregarMembros();
    } catch (e: any) {
      toast.error("Erro ao atualizar membro: " + (e?.message ?? e));
    } finally {
      setTogglingId(null);
    }
  };

  const marcarComoCobrado = async () => {
    if (!id) return;
    setMarcando(true);
    try {
      const agora = new Date().toISOString();
      const sb = supabase as any;
      const { error } = await sb
        .from("configuracoes")
        .upsert(
          { tenant_id: id, chave: "excedente_cobrado_em", valor: agora, descricao: "Última data em que o excedente do mês foi marcado como cobrado" },
          { onConflict: "tenant_id,chave" },
        );
      if (error) throw error;
      setExcedenteCobradoEm(agora);
      toast.success("Excedente marcado como cobrado");
    } catch (e: any) {
      toast.error("Erro ao marcar como cobrado: " + (e?.message ?? e));
    } finally {
      setMarcando(false);
    }
  };

  const confirmarBloqueio = async () => {
    if (!id) return;
    if (!motivo.trim()) {
      toast.error("Informe o motivo do bloqueio");
      return;
    }
    setSalvandoBloqueio(true);
    try {
      const sb = supabase as any;
      const { error } = await sb
        .from("tenants")
        .update({ bloqueado_em: new Date().toISOString(), motivo_bloqueio: motivo.trim() })
        .eq("id", id);
      if (error) throw error;
      toast.success("Cliente bloqueado");
      setBloqueioOpen(false);
      setMotivo("");
      await load();
    } catch (e: any) {
      toast.error("Erro ao bloquear: " + (e?.message ?? e));
    } finally {
      setSalvandoBloqueio(false);
    }
  };

  const confirmarDesbloqueio = async () => {
    if (!id) return;
    setSalvandoBloqueio(true);
    try {
      const sb = supabase as any;
      const { error } = await sb
        .from("tenants")
        .update({ bloqueado_em: null, motivo_bloqueio: null })
        .eq("id", id);
      if (error) throw error;
      toast.success("Cliente desbloqueado");
      setDesbloqueioOpen(false);
      await load();
    } catch (e: any) {
      toast.error("Erro ao desbloquear: " + (e?.message ?? e));
    } finally {
      setSalvandoBloqueio(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!tenant) {
    return (
      <div className="mx-auto w-full max-w-[1400px] px-8 py-8">
        <Link to="/admin/tenants" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Voltar
        </Link>
        <div className="mt-6 rounded-xl border border-dashed border-border bg-card p-12 text-center">
          <p className="text-sm font-medium text-foreground">Cliente não encontrado.</p>
        </div>
      </div>
    );
  }

  const mesCorrente = anoMesAtual();
  const usoAtual = uso.find((u) => u.ano_mes === mesCorrente);
  const limite = tenant.limite_pedidos_mes ?? 0;
  const pedidosMes = usoAtual?.pedidos_processados ?? 0;
  const valorMes = Number(usoAtual?.total_previsto_processado ?? 0);
  const errosMes = usoAtual?.erros_ia ?? 0;
  const pctReal = limite > 0 ? Math.round((pedidosMes / limite) * 100) : 0;
  const pctBar = Math.min(100, pctReal);
  const excedeu = limite > 0 && pedidosMes > limite;
  const qtdExcedente = excedeu ? pedidosMes - limite : 0;
  const valorACobrar = qtdExcedente * valorExcedente;
  const cobradoEsteMes = excedenteCobradoEm?.startsWith(mesCorrente) ?? false;
  const corBarra = pctReal > 100 ? "bg-destructive" : pctReal >= 80 ? "bg-warning" : "bg-success";

  return (
    <div className="mx-auto w-full max-w-[1400px] px-8 py-8">
      <Link to="/admin/tenants" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Voltar para clientes
      </Link>

      <div className="mb-7 flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary-soft text-primary">
            <Building2 className="h-5 w-5" />
          </span>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight text-foreground">{tenant.nome}</h1>
              {tenant.bloqueado_em ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-destructive/15 px-2.5 py-0.5 text-xs font-semibold text-destructive">
                  <Lock className="h-3 w-3" /> Bloqueado
                </span>
              ) : tenant.ativo ? (
                <span className="inline-flex items-center rounded-full bg-success-soft px-2.5 py-0.5 text-xs font-medium text-success">Ativo</span>
              ) : (
                <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">Inativo</span>
              )}
              {plano && (
                <span className="inline-flex items-center rounded-full bg-primary-soft px-2.5 py-0.5 text-xs font-medium text-primary">
                  Plano {plano.nome}
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">slug: <span className="font-mono">{tenant.slug}</span> · cadastrado em {dataFmt(tenant.created_at)}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {tenant.bloqueado_em && (
            <Button onClick={() => setDesbloqueioOpen(true)} variant="outline" size="sm" className="gap-1.5 border-success/40 text-success hover:bg-success-soft">
              <Unlock className="h-4 w-4" /> Desbloquear
            </Button>
          )}
          <Button onClick={() => setEditarOpen(true)} variant="outline" size="sm" className="gap-1.5">
            <Pencil className="h-4 w-4" /> Editar cliente
          </Button>
          <Button
            onClick={() => setExcluirOpen(true)}
            variant="outline"
            size="sm"
            className="gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" /> Excluir empresa
          </Button>
        </div>
      </div>

      {tenant.bloqueado_em && (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
          <Lock className="mt-0.5 h-4 w-4 text-destructive" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-destructive">
              Cliente bloqueado em {new Date(tenant.bloqueado_em).toLocaleString("pt-BR")}
            </p>
            {tenant.motivo_bloqueio && (
              <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">
                <span className="font-medium">Motivo:</span> {tenant.motivo_bloqueio}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Métricas do mês */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card titulo="Pedidos no mês" valor={num(pedidosMes)} sub={limite > 0 ? `de ${num(limite)} permitidos` : "Sem limite definido"} icon={FileText} cor="text-primary" bg="bg-primary-soft" />
        <Card titulo="Volume processado" valor={brl(valorMes)} sub="Soma do mês atual" icon={DollarSign} cor="text-success" bg="bg-success-soft" />
        <Card titulo="Erros de IA" valor={num(errosMes)} sub="Pedidos com falha" icon={AlertTriangle} cor="text-destructive" bg="bg-destructive/10" />
        <Card titulo="Membros" valor={num(membros.filter((m) => m.ativo).length)} sub={`${num(membros.length)} no total`} icon={Users} cor="text-info" bg="bg-info/10" />
      </div>

      {/* Card de uso do plano */}
      {limite > 0 && (
        <div className="mt-4 rounded-xl border border-border bg-card p-5 shadow-softeum-sm">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="font-medium text-foreground">Uso do plano</span>
                <span className="tabular-nums text-muted-foreground">{num(pedidosMes)} / {num(limite)} ({pctReal}%)</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div className={`h-full ${corBarra}`} style={{ width: `${pctBar}%` }} />
              </div>
              {excedeu && (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3.5">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="mt-0.5 h-4 w-4 text-destructive" />
                    <div>
                      <p className="text-sm font-semibold text-destructive">
                        {num(qtdExcedente)} documento(s) acima do limite
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Valor a cobrar: <span className="font-semibold text-foreground">{brl(valorACobrar)}</span>
                        {valorExcedente > 0 && <> ({num(qtdExcedente)} × {brl(valorExcedente)})</>}
                      </p>
                    </div>
                  </div>
                  {cobradoEsteMes ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-success-soft px-3 py-1 text-xs font-medium text-success">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Cobrado em {new Date(excedenteCobradoEm!).toLocaleDateString("pt-BR")}
                    </span>
                  ) : (
                    <Button onClick={marcarComoCobrado} disabled={marcando} size="sm">
                      {marcando && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                      Marcar como cobrado
                    </Button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="mt-8">
        {/* Histórico de uso */}
        <div className="rounded-xl border border-border bg-card shadow-softeum-sm">
          <div className="border-b border-border px-6 py-4">
            <h2 className="text-base font-semibold text-foreground">Histórico de uso</h2>
            <p className="text-xs text-muted-foreground">Últimos 12 meses</p>
          </div>
          {uso.length === 0 ? (
            <div className="px-6 py-12 text-center text-sm text-muted-foreground">Sem histórico de uso.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-5 py-2.5 text-left font-medium">Mês</th>
                  <th className="px-5 py-2.5 text-right font-medium">Pedidos</th>
                  <th className="px-5 py-2.5 text-right font-medium">Volume</th>
                  <th className="px-5 py-2.5 text-right font-medium">Erros</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {uso.map((u) => (
                  <tr key={u.ano_mes} className="hover:bg-muted/30">
                    <td className="px-5 py-2.5 capitalize text-foreground">{formatAnoMes(u.ano_mes)}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums text-foreground">{num(u.pedidos_processados ?? 0)}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums text-muted-foreground">{brl(Number(u.total_previsto_processado ?? 0))}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums text-muted-foreground">{num(u.erros_ia ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>


      {/* Membros do tenant */}
      <div className="mt-6 rounded-xl border border-border bg-card shadow-softeum-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">Membros</h2>
            <p className="text-xs text-muted-foreground">Usuários vinculados a este cliente</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-success-soft px-3 py-1 text-xs font-medium text-success">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {num(membros.filter((m) => m.ativo).length)} ativos
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
              <PowerOff className="h-3.5 w-3.5" />
              {num(membros.filter((m) => !m.ativo).length)} inativos
            </span>
          </div>
        </div>
        {membros.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-muted-foreground">Nenhum membro cadastrado.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-5 py-2.5 text-left font-medium">Membro</th>
                  <th className="px-5 py-2.5 text-left font-medium">E-mail</th>
                  <th className="px-5 py-2.5 text-left font-medium">Papel</th>
                  <th className="px-5 py-2.5 text-left font-medium">Status</th>
                  <th className="px-5 py-2.5 text-left font-medium">Entrada</th>
                  <th className="px-5 py-2.5 text-left font-medium">Último acesso</th>
                  <th className="px-5 py-2.5 text-right font-medium">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {membros.map((m) => {
                  const ultimo = m.last_sign_in_at ?? m.ultimo_acesso ?? null;
                  return (
                    <tr key={m.id} className="hover:bg-muted/30">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-muted-foreground">
                            <UserIcon className="h-4 w-4" />
                          </span>
                          <div>
                            <p className="text-sm font-medium text-foreground">{m.nome ?? "Sem nome"}</p>
                            <p className="text-xs text-muted-foreground font-mono">{m.user_id.slice(0, 8)}…</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3 text-sm text-foreground">
                        {m.email ? (
                          <span className="inline-flex items-center gap-1.5">
                            <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                            {m.email}
                          </span>
                        ) : (
                          <span className="italic text-muted-foreground/60">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        {m.papel === "admin" ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-primary-soft px-2.5 py-0.5 text-xs font-medium text-primary">
                            <Shield className="h-3 w-3" /> Admin
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                            Operador
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        {m.ativo ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2.5 py-0.5 text-xs font-medium text-success">
                            <CheckCircle2 className="h-3 w-3" /> Ativo
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                            <PowerOff className="h-3 w-3" /> Inativo
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-xs text-muted-foreground">{dataFmt(m.created_at ?? null)}</td>
                      <td className="px-5 py-3 text-xs text-muted-foreground">
                        {ultimo ? (
                          <span className="inline-flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {new Date(ultimo).toLocaleString("pt-BR")}
                          </span>
                        ) : (
                          <span className="italic text-muted-foreground/60">Nunca</span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 gap-1.5"
                            onClick={() => setResetTarget(m)}
                          >
                            <KeyRound className="h-3.5 w-3.5" />
                            Redefinir senha
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={togglingId === m.id}
                            className={`h-8 gap-1.5 ${
                              m.ativo
                                ? "border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                                : "border-success/40 text-success hover:bg-success-soft hover:text-success"
                            }`}
                            onClick={() => setToggleTarget(m)}
                          >
                            {togglingId === m.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : m.ativo ? (
                              <PowerOff className="h-3.5 w-3.5" />
                            ) : (
                              <Power className="h-3.5 w-3.5" />
                            )}
                            {m.ativo ? "Desativar" : "Ativar"}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>


      {/* Seções de detalhes */}
      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Section icon={Building2} titulo="Dados da empresa">
          <Field label="Razão social" value={tenant.nome} />
          <Field label="Nome fantasia" value={tenant.nome_fantasia} />
          <Field label="CNPJ" value={tenant.cnpj} />
          <Field label="Inscrição estadual" value={tenant.inscricao_estadual} />
          <Field label="Inscrição municipal" value={tenant.inscricao_municipal} />
          <Field label="Slug" value={tenant.slug} mono />
        </Section>

        <Section icon={MapPin} titulo="Endereço">
          <Field label="CEP" value={tenant.cep} />
          <Field label="Endereço" value={[tenant.endereco, tenant.numero_endereco].filter(Boolean).join(", ") || null} />
          <Field label="Complemento" value={tenant.complemento} />
          <Field label="Bairro" value={tenant.bairro} />
          <Field label="Cidade / UF" value={[tenant.cidade, tenant.estado].filter(Boolean).join(" / ") || null} />
        </Section>

        <Section icon={CreditCard} titulo="Financeiro">
          <Field label="Responsável" value={tenant.responsavel_financeiro} />
          <Field label="E-mail financeiro" value={tenant.email_financeiro} />
          <Field label="Telefone" value={tenant.telefone} />
          <Field label="Valor mensal" value={tenant.valor_mensal != null ? brl(Number(tenant.valor_mensal)) : null} />
          <Field label="Valor de setup" value={tenant.valor_setup != null ? brl(Number(tenant.valor_setup)) : null} />
          <Field label="Valor por excedente" value={tenant.valor_excedente != null ? brl(Number(tenant.valor_excedente)) : null} />
          <Field label="Forma de pagamento" value={tenant.forma_pagamento} />
          <Field label="Dia de vencimento" value={tenant.dia_vencimento != null ? `Dia ${tenant.dia_vencimento}` : null} />
        </Section>

        <Section icon={FileSignature} titulo="Contrato">
          <Field label="Início do contrato" value={dataFmt(tenant.data_inicio_contrato)} />
          <Field label="Início do pagamento" value={dataFmt(tenant.data_inicio_pagamento)} />
          <Field label="Vencimento do contrato" value={dataFmt(tenant.data_vencimento_contrato)} />
          <Field label="Gestor do contrato" value={tenant.gestor_contrato} />
          <Field label="Executivo de venda" value={tenant.executivo_venda} />
          <Field label="Tipo de integração" value={tenant.tipo_integracao} />
        </Section>

        <Section icon={Gauge} titulo="Limites">
          <Field label="Plano" value={plano?.nome ?? null} />
          <Field label="Limite de pedidos / mês" value={tenant.limite_pedidos_mes != null ? num(tenant.limite_pedidos_mes) : null} />
          <Field label="Limite de usuários" value={tenant.limite_usuarios != null ? num(tenant.limite_usuarios) : null} />
        </Section>

        <Section icon={Briefcase} titulo="Admin">
          {(() => {
            const admins = membros.filter((mb) => mb.papel === "admin");
            if (admins.length === 0) {
              return (
                <p className="text-sm text-muted-foreground">
                  Nenhum admin vinculado. Crie o usuário no Supabase Auth e adicione em <span className="font-mono">tenant_membros</span> com papel <span className="font-mono">admin</span>.
                </p>
              );
            }
            return (
              <ul className="space-y-2">
                {admins.map((a) => (
                  <li key={a.id} className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-2">
                    <div>
                      <p className="text-sm font-medium text-foreground">{a.nome ?? "Sem nome"}</p>
                      <p className="text-xs font-mono text-muted-foreground">{a.user_id.slice(0, 8)}…</p>
                    </div>
                    {!a.ativo && (
                      <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">Inativo</span>
                    )}
                  </li>
                ))}
              </ul>
            );
          })()}
        </Section>
      </div>

      {/* Documentos do cliente */}
      <div className="mt-8">
        <DocumentosTenant tenantId={tenant.id} />
      </div>

      {tenant.comentarios && (
        <div className="mt-6 rounded-xl border border-border bg-card p-5 shadow-softeum-sm">
          <div className="mb-2 flex items-center gap-2">
            <Mail className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground">Comentários</h3>
          </div>
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">{tenant.comentarios}</p>
        </div>
      )}

      {tenant.notas && (
        <div className="mt-6 rounded-xl border border-border bg-card p-5 shadow-softeum-sm">
          <div className="mb-2 flex items-center gap-2">
            <Mail className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground">Observações internas</h3>
          </div>
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">{tenant.notas}</p>
        </div>
      )}

      {/* Modal: bloquear */}
      <AlertDialog open={bloqueioOpen} onOpenChange={setBloqueioOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Bloquear por inadimplência</AlertDialogTitle>
            <AlertDialogDescription>
              Ao confirmar, todos os usuários de <strong className="text-foreground">{tenant.nome}</strong> não
              conseguirão mais acessar o sistema. O super admin continuará tendo acesso ao painel.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="motivo-bloqueio-detalhe">Motivo do bloqueio</Label>
            <Textarea
              id="motivo-bloqueio-detalhe"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ex: Inadimplência — fatura de set/2025 em aberto"
              rows={3}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={salvandoBloqueio}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                confirmarBloqueio();
              }}
              disabled={salvandoBloqueio || !motivo.trim()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {salvandoBloqueio && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
              Bloquear cliente
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Modal: desbloquear */}
      <AlertDialog open={desbloqueioOpen} onOpenChange={setDesbloqueioOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desbloquear cliente</AlertDialogTitle>
            <AlertDialogDescription>
              Liberar o acesso de <strong className="text-foreground">{tenant.nome}</strong> ao sistema?
              Os usuários poderão entrar normalmente novamente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={salvandoBloqueio}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                confirmarDesbloqueio();
              }}
              disabled={salvandoBloqueio}
            >
              {salvandoBloqueio && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
              Desbloquear
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ExcluirTenantDialog
        open={excluirOpen}
        onOpenChange={setExcluirOpen}
        tenantId={tenant.id}
        tenantNome={tenant.nome}
        onExcluido={() => navigate("/admin/tenants", { replace: true })}
      />

      <NovoClienteDialog
        open={editarOpen}
        onOpenChange={setEditarOpen}
        tenantId={tenant.id}
        onCreated={() => load()}
      />

      {/* Modal: confirmar redefinição de senha */}
      <AlertDialog open={!!resetTarget} onOpenChange={(o) => !o && setResetTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Redefinir senha do membro</AlertDialogTitle>
            <AlertDialogDescription>
              Será gerada uma nova senha provisória no formato{" "}
              <span className="font-mono text-foreground">Softeum1234!</span> para{" "}
              <strong className="text-foreground">
                {resetTarget?.nome ?? resetTarget?.email ?? "este membro"}
              </strong>
              . A senha atual deixará de funcionar imediatamente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={resetando}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                confirmarReset();
              }}
              disabled={resetando}
            >
              {resetando && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
              Gerar nova senha
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Modal: confirmar ativar/desativar membro */}
      <AlertDialog open={!!toggleTarget} onOpenChange={(o) => !o && setToggleTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {toggleTarget?.ativo ? "Desativar membro" : "Ativar membro"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {toggleTarget?.ativo
                ? "Ao desativar, o membro perderá o acesso ao sistema, mas o usuário e o histórico permanecerão."
                : "Ao reativar, o membro voltará a poder acessar o sistema com a senha atual."}
              <br />
              <span className="mt-2 inline-block text-foreground">
                {toggleTarget?.nome ?? toggleTarget?.email ?? "Membro"}
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!togglingId}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                confirmarToggle();
              }}
              disabled={!!togglingId}
              className={
                toggleTarget?.ativo
                  ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  : ""
              }
            >
              {togglingId && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
              {toggleTarget?.ativo ? "Desativar" : "Ativar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Modal: nova senha gerada */}
      {credDados && (
        <CredenciaisDialog
          open={credOpen}
          onOpenChange={(o) => {
            setCredOpen(o);
            if (!o) setCredDados(null);
          }}
          email={credDados.email}
          senha={credDados.senha}
          empresaNome={tenant.nome}
        />
      )}
    </div>
  );
}

function Card({ titulo, valor, sub, icon: Icon, cor, bg }: { titulo: string; valor: string; sub: string; icon: any; cor: string; bg: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-softeum-sm">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{titulo}</span>
        <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${bg}`}>
          <Icon className={`h-4 w-4 ${cor}`} />
        </span>
      </div>
      <p className="mt-3 text-2xl font-bold text-foreground">{valor}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>
    </div>
  );
}

function Section({ icon: Icon, titulo, children }: { icon: any; titulo: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card shadow-softeum-sm">
      <div className="flex items-center gap-2 border-b border-border px-6 py-4">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-base font-semibold text-foreground">{titulo}</h2>
      </div>
      <div className="space-y-3 px-6 py-5">{children}</div>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string | null | undefined; mono?: boolean }) {
  const empty = value === null || value === undefined || value === "" || value === "-";
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-dashed border-border/60 pb-2 last:border-0 last:pb-0">
      <span className="text-xs uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className={`text-sm text-right ${empty ? "text-muted-foreground/60 italic" : "text-foreground font-medium"} ${mono ? "font-mono" : ""}`}>
        {empty ? "—" : value}
      </span>
    </div>
  );
}
