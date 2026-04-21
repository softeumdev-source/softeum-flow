import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Building2, Users, FileText, DollarSign, AlertTriangle, Loader2, Mail, Shield, User as UserIcon, CheckCircle2, Lock, Unlock, MapPin, CreditCard, FileSignature, Gauge, Briefcase } from "lucide-react";
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
  const [motivo, setMotivo] = useState("");
  const [salvandoBloqueio, setSalvandoBloqueio] = useState(false);

  const load = async () => {
    if (!id) return;
    setLoading(true);
    try {
      const sb = supabase as any;
      const [{ data: t, error: e1 }, { data: u, error: e2 }, { data: m, error: e3 }, { data: cfgs, error: e4 }] = await Promise.all([
        sb.from("tenants").select("*").eq("id", id).maybeSingle(),
        sb.from("tenant_uso").select("ano_mes, pedidos_processados, total_previsto_processado, erros_ia").eq("tenant_id", id).order("ano_mes", { ascending: false }).limit(12),
        sb.from("tenant_membros").select("id, nome, papel, ativo, user_id").eq("tenant_id", id).order("papel"),
        sb.from("configuracoes").select("chave, valor").eq("tenant_id", id).in("chave", ["valor_excedente", "excedente_cobrado_em"]),
      ]);
      if (e1) throw e1;
      if (e2) throw e2;
      if (e3) throw e3;
      if (e4) throw e4;
      setTenant(t);
      setUso(u ?? []);
      setMembros(m ?? []);

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
        <div>
          {tenant.bloqueado_em && (
            <Button onClick={() => setDesbloqueioOpen(true)} variant="outline" size="sm" className="gap-1.5 border-success/40 text-success hover:bg-success-soft">
              <Unlock className="h-4 w-4" /> Desbloquear
            </Button>
          )}
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

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
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

        {/* Membros */}
        <div className="rounded-xl border border-border bg-card shadow-softeum-sm">
          <div className="border-b border-border px-6 py-4">
            <h2 className="text-base font-semibold text-foreground">Membros</h2>
            <p className="text-xs text-muted-foreground">{num(membros.length)} usuário(s) vinculado(s)</p>
          </div>
          {membros.length === 0 ? (
            <div className="px-6 py-12 text-center text-sm text-muted-foreground">Nenhum membro cadastrado.</div>
          ) : (
            <ul className="divide-y divide-border">
              {membros.map((m) => (
                <li key={m.id} className="flex items-center justify-between px-6 py-3.5">
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-muted-foreground">
                      <UserIcon className="h-4 w-4" />
                    </span>
                    <div>
                      <p className="text-sm font-medium text-foreground">{m.nome ?? "Sem nome"}</p>
                      <p className="text-xs text-muted-foreground font-mono">{m.user_id.slice(0, 8)}…</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {m.papel === "admin" ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-primary-soft px-2.5 py-0.5 text-xs font-medium text-primary">
                        <Shield className="h-3 w-3" /> Admin
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">Operador</span>
                    )}
                    {!m.ativo && (
                      <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">Inativo</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

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
