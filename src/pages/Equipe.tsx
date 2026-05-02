import { useEffect, useMemo, useState } from "react";
import {
  Users,
  Loader2,
  ShieldCheck,
  User as UserIcon,
  Power,
  Trash2,
  AlertTriangle,
  UserPlus,
  KeyRound,
  Mail,
  Send,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ConvidarMembroDialog } from "@/components/equipe/ConvidarMembroDialog";
import { AlterarSenhaDialog } from "@/components/equipe/AlterarSenhaDialog";

interface Membro {
  id: string;
  user_id: string;
  tenant_id?: string;
  nome: string | null;
  email: string | null;
  papel: "admin" | "operador";
  ativo: boolean;
  // ATENÇÃO: coluna é criado_em (NÃO created_at) — banco externo arihejdirnhmcwuhkzde
  criado_em: string | null;
  ultimo_acesso?: string | null;
}

interface Convite {
  id: string;
  email: string;
  papel: "admin" | "operador";
  status: "pendente" | "aceito" | "cancelado";
  created_at: string;
}

const PAPEL_LABEL: Record<"admin" | "operador", string> = {
  admin: "Administrador",
  operador: "Membro",
};

const dataFmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }) : "-";

export default function Equipe() {
  const { user, tenantId, papel, isSuperAdmin, nomeTenant, nomeUsuario, loading: authLoading } = useAuth();
  const isAdmin = papel === "admin" || isSuperAdmin;
  const isOperador = !isAdmin;
  const operadorNome = (nomeUsuario && nomeUsuario.trim()) || user?.email || "Usuário";

  const [membros, setMembros] = useState<Membro[]>([]);
  const [convites, setConvites] = useState<Convite[]>([]);
  const [limiteUsuarios, setLimiteUsuarios] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [convidarOpen, setConvidarOpen] = useState(false);
  const [alterarSenhaOpen, setAlterarSenhaOpen] = useState(false);
  const [removerId, setRemoverId] = useState<string | null>(null);
  const [cancelarConviteId, setCancelarConviteId] = useState<string | null>(null);
  const [conviteAcaoEmAndamento, setConviteAcaoEmAndamento] = useState<string | null>(null);

  const membrosVisiveis = useMemo(() => membros, [membros]);

  const loadingTabela = loading;

  const carregar = async () => {
    if (!tenantId || !user || !isAdmin) return;
    setLoading(true);
    try {
      // Query simples e direta — sem filtro de ativo, sem cache, sem limit.
      // ATENÇÃO: colunas são criado_em e email (banco externo arihejdirnhmcwuhkzde).
      const { data, error } = await supabase
        .from('tenant_membros' as any)
        .select('id, user_id, tenant_id, papel, nome, email, ativo, criado_em, ultimo_acesso')
        .eq('tenant_id', tenantId)
        .order('criado_em', { ascending: true }); // BANCO REAL: criado_em (não created_at) — NÃO ALTERAR

      if (error) {
        console.error('Erro membros:', error);
        toast.error("Erro ao carregar membros", { description: error.message });
      } else {
        console.log("[Equipe] Membros carregados do banco:", data);
        setMembros((data || []) as unknown as Membro[]);
      }

      const { data: t, error: errT } = await (supabase as any)
        .from("tenants")
        .select("limite_usuarios")
        .eq("id", tenantId)
        .maybeSingle();
      if (errT) console.error('Erro tenant:', errT);
      else setLimiteUsuarios(t?.limite_usuarios ?? null);

      const { data: convs, error: convsErr } = await (supabase as any)
        .from("tenant_convites")
        .select("id, email, papel, status, created_at")
        .eq("tenant_id", tenantId)
        .eq("status", "pendente")
        .order("created_at", { ascending: false });
      if (convsErr) console.error("Erro convites:", convsErr);
      else setConvites((convs ?? []) as Convite[]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (authLoading || !user) return;

    if (!isAdmin) {
      setLoading(false);
      return;
    }

    if (!tenantId) return;
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, authLoading, tenantId, isAdmin]);

  const convidarMembro = async (dados: { email: string; papel: "admin" | "operador" }) => {
    if (!tenantId) {
      toast.error("Tenant não identificado");
      return;
    }
    if (limiteAtingido) {
      toast.error(
        "Limite de usuários atingido (incluindo convites pendentes). Cancele algum convite ou aumente seu plano.",
      );
      return;
    }

    const { data: resp, error: invokeErr } = await supabase.functions.invoke(
      "enviar-convite-membro",
      { body: { tenant_id: tenantId, email: dados.email, papel: dados.papel } },
    );

    if (invokeErr) {
      toast.error("Não foi possível enviar o convite", {
        description: invokeErr.message,
      });
      throw invokeErr;
    }
    if (!resp?.sucesso) {
      toast.error("Não foi possível enviar o convite", {
        description: resp?.error ?? "Erro desconhecido",
      });
      throw new Error(resp?.error ?? "Erro desconhecido");
    }

    setConvidarOpen(false);

    if (resp.email_enviado === false) {
      // Convite gravado mas envio falhou — mostra URL como fallback.
      toast.warning("Convite criado, mas o email falhou", {
        description: `Compartilhe este link manualmente: ${resp.accept_url ?? ""}`,
        duration: 15000,
      });
    } else {
      toast.success(`Convite enviado para ${resp.email}`);
    }

    await carregar();
  };

  const reenviarConvite = async (convite: Convite) => {
    if (!tenantId) return;
    setConviteAcaoEmAndamento(convite.id);
    try {
      const { data: resp, error: invokeErr } = await supabase.functions.invoke(
        "enviar-convite-membro",
        { body: { tenant_id: tenantId, email: convite.email, papel: convite.papel } },
      );
      if (invokeErr) throw invokeErr;
      if (!resp?.sucesso) throw new Error(resp?.error ?? "Falha ao reenviar");
      if (resp.email_enviado === false) {
        toast.warning("Convite reenviado, mas o email falhou", {
          description: `Link: ${resp.accept_url ?? ""}`,
          duration: 15000,
        });
      } else {
        toast.success(`Convite reenviado para ${convite.email}`);
      }
      await carregar();
    } catch (err: any) {
      toast.error("Não foi possível reenviar", { description: err.message });
    } finally {
      setConviteAcaoEmAndamento(null);
    }
  };

  const confirmarCancelarConvite = async () => {
    const id = cancelarConviteId;
    if (!id) return;
    setCancelarConviteId(null);
    setConviteAcaoEmAndamento(id);
    const anterior = convites;
    setConvites((c) => c.filter((x) => x.id !== id));
    try {
      const { error } = await (supabase as any)
        .from("tenant_convites")
        .update({ status: "cancelado" })
        .eq("id", id)
        .eq("tenant_id", tenantId);
      if (error) throw error;
      toast.success("Convite cancelado");
    } catch (err: any) {
      setConvites(anterior);
      toast.error("Não foi possível cancelar", { description: err.message });
    } finally {
      setConviteAcaoEmAndamento(null);
    }
  };

  const conviteParaCancelar = cancelarConviteId
    ? convites.find((c) => c.id === cancelarConviteId)
    : null;

  const atualizarPapel = async (id: string, novoPapel: "admin" | "operador") => {
    if (!isAdmin) return;
    // Bloqueia rebaixar o último admin ativo do tenant — caso contrário
    // o tenant fica órfão sem ninguém pra gerenciar membros/configs.
    if (novoPapel === "operador") {
      const alvo = membros.find((m) => m.id === id);
      if (alvo?.papel === "admin" && alvo.ativo) {
        const adminsAtivos = membros.filter((m) => m.papel === "admin" && m.ativo).length;
        if (adminsAtivos <= 1) {
          toast.error("Não é possível rebaixar", {
            description:
              "Este é o único administrador ativo do tenant. Promova outro membro a administrador antes de rebaixar este.",
          });
          return;
        }
      }
    }
    const anterior = membros;
    setMembros((m) => m.map((x) => (x.id === id ? { ...x, papel: novoPapel } : x)));
    try {
      const { error } = await (supabase as any)
        .from("tenant_membros")
        .update({ papel: novoPapel })
        .eq("id", id)
        .eq("tenant_id", tenantId);
      if (error) throw error;
      toast.success("Papel atualizado");
    } catch (err: any) {
      setMembros(anterior);
      toast.error("Não foi possível atualizar", { description: err.message });
    }
  };

  const ativosCount = membros.filter((m) => m.ativo).length;
  const convitesPendentesCount = convites.length;
  const totalUsando = ativosCount + convitesPendentesCount;
  const limiteAtingido = limiteUsuarios != null && totalUsando >= limiteUsuarios;

  const alternarAtivo = async (id: string, ativo: boolean) => {
    if (!isAdmin || !tenantId) return;
    // Reativar consome uma licença — bloquear se já está no limite.
    if (!ativo && limiteAtingido) {
      toast.error("Limite de usuários atingido. Entre em contato com o administrador para aumentar seu plano.");
      return;
    }
    // Bloqueia desativar o último admin ativo do tenant.
    if (ativo) {
      const alvo = membros.find((m) => m.id === id);
      if (alvo?.papel === "admin") {
        const adminsAtivos = membros.filter((m) => m.papel === "admin" && m.ativo).length;
        if (adminsAtivos <= 1) {
          toast.error("Não é possível desativar", {
            description:
              "Este é o único administrador ativo do tenant. Promova ou ative outro administrador antes de desativar este.",
          });
          return;
        }
      }
    }
    const novoAtivo = !ativo;
    const anterior = membros;
    setMembros((m) => m.map((x) => (x.id === id ? { ...x, ativo: novoAtivo } : x)));
    try {
      // UPDATE direto em tenant_membros — sem Edge Function.
      // A invalidação da sessão acontece no AuthContext do membro desativado:
      // ao recarregar o contexto, detecta ativo=false e força signOut.
      const { error } = await (supabase as any)
        .from("tenant_membros")
        .update({ ativo: novoAtivo })
        .eq("id", id)
        .eq("tenant_id", tenantId);
      if (error) throw error;
      toast.success(novoAtivo ? "Membro reativado" : "Membro desativado");
      // Recarrega para garantir consistência (inclui membros inativos)
      await carregar();
    } catch (err: any) {
      setMembros(anterior);
      toast.error("Não foi possível alterar status", { description: err.message });
    }
  };

  const remover = (id: string) => {
    if (!isAdmin) return;
    const alvo = membros.find((m) => m.id === id);
    if (alvo?.papel === "admin" && alvo.ativo) {
      const adminsAtivos = membros.filter((m) => m.papel === "admin" && m.ativo).length;
      if (adminsAtivos <= 1) {
        toast.error("Não é possível remover", {
          description:
            "Este é o único administrador ativo do tenant. Promova outro membro a administrador antes de remover.",
        });
        return;
      }
    }
    setRemoverId(id);
  };

  const confirmarRemocao = async () => {
    const id = removerId;
    if (!id) return;
    setRemoverId(null);
    const anterior = membros;
    setMembros((m) => m.filter((x) => x.id !== id));
    try {
      const { error } = await (supabase as any).from("tenant_membros").delete().eq("id", id).eq("tenant_id", tenantId);
      if (error) throw error;
      toast.success("Membro removido");
    } catch (err: any) {
      setMembros(anterior);
      toast.error("Não foi possível remover", { description: err.message });
    }
  };

  const membroParaRemover = removerId ? membros.find((m) => m.id === removerId) : null;

  return (
    <div className="mx-auto w-full max-w-[1100px] px-8 py-8">
      <div className="mb-7 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Equipe</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isAdmin
              ? "Membros que têm acesso a este tenant."
              : "Seus dados de acesso a este tenant."}
          </p>
        </div>
        {isAdmin && (
          <Button
            size="sm"
            disabled={limiteAtingido}
            onClick={() => {
              if (limiteAtingido) {
                toast.error("Limite de usuários atingido. Entre em contato com o administrador para aumentar seu plano.");
                return;
              }
              setConvidarOpen(true);
            }}
            className="gap-1.5"
          >
            <UserPlus className="h-4 w-4" /> Convidar membro
          </Button>
        )}
      </div>

      {isAdmin && limiteUsuarios != null && (
        <div className={`mb-4 rounded-xl border p-4 shadow-softeum-sm ${limiteAtingido ? "border-destructive/30 bg-destructive/5" : "border-border bg-card"}`}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${limiteAtingido ? "bg-destructive/10 text-destructive" : "bg-primary-soft text-primary"}`}>
                {limiteAtingido ? <AlertTriangle className="h-4 w-4" /> : <Users className="h-4 w-4" />}
              </span>
              <div>
                <p className="text-sm font-semibold text-foreground">
                  {totalUsando} / {limiteUsuarios} licenças em uso
                </p>
                <p className="text-xs text-muted-foreground">
                  {limiteAtingido
                    ? "Limite atingido. Cancele algum convite pendente ou aumente seu plano."
                    : `${limiteUsuarios - totalUsando} licença(s) disponível(is)${convitesPendentesCount > 0 ? ` · ${convitesPendentesCount} convite(s) pendente(s)` : ""}`}
                </p>
              </div>
            </div>
            <span className="h-2 w-32 overflow-hidden rounded-full bg-muted">
              <span
                className={`block h-full ${limiteAtingido ? "bg-destructive" : totalUsando / limiteUsuarios >= 0.8 ? "bg-warning" : "bg-success"}`}
                style={{ width: `${Math.min(100, (totalUsando / limiteUsuarios) * 100)}%` }}
              />
            </span>
          </div>
        </div>
      )}

      {isOperador ? (
        <>
          <p className="mb-4 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
            Você está visualizando como membro. Você pode apenas ver seus próprios dados e alterar sua senha.
          </p>

          <div className="rounded-xl border border-border bg-card shadow-softeum-sm">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-base font-semibold text-foreground">1 membro</h2>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/20 text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-5 py-3 text-left font-medium">Nome</th>
                    <th className="px-5 py-3 text-left font-medium">Papel</th>
                    <th className="px-5 py-3 text-left font-medium">Status</th>
                    <th className="px-5 py-3 text-left font-medium">Entrou em</th>
                    <th className="px-5 py-3 text-right font-medium">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  <tr className="transition-colors hover:bg-muted/30">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
                          <UserIcon className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <p className="truncate font-medium text-foreground">
                            {operadorNome}
                            <span className="ml-2 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
                              Você
                            </span>
                          </p>
                          <p className="truncate text-xs text-muted-foreground font-mono">
                            {user?.id?.slice(0, 8)}…
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="inline-flex items-center rounded-full border border-border px-2.5 py-0.5 text-xs font-medium text-foreground">
                        Membro
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="inline-flex items-center rounded-full border border-status-aprovado/20 bg-status-aprovado-soft px-2.5 py-0.5 text-xs font-medium text-status-aprovado">
                        <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-current" />
                        Ativo
                      </span>
                    </td>
                    <td className="px-5 py-3.5 tabular-nums text-muted-foreground">
                      {dataFmt(user?.created_at ?? null)}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <div className="flex justify-end gap-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setAlterarSenhaOpen(true)}
                          className="gap-1.5"
                        >
                          <KeyRound className="h-3.5 w-3.5" />
                          Alterar senha
                        </Button>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="rounded-xl border border-border bg-card shadow-softeum-sm">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-base font-semibold text-foreground">
                  {loadingTabela ? "Carregando..." : `${membrosVisiveis.length} ${membrosVisiveis.length === 1 ? "membro" : "membros"}`}
                </h2>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/20 text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-5 py-3 text-left font-medium">Nome</th>
                    <th className="px-5 py-3 text-left font-medium">Papel</th>
                    <th className="px-5 py-3 text-left font-medium">Status</th>
                    <th className="px-5 py-3 text-left font-medium">Entrou em</th>
                    <th className="px-5 py-3 text-right font-medium">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {loadingTabela ? (
                    <tr>
                      <td colSpan={5} className="px-5 py-16 text-center text-muted-foreground">
                        <div className="flex items-center justify-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Carregando membros...
                        </div>
                      </td>
                    </tr>
                  ) : membrosVisiveis.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-5 py-16 text-center text-muted-foreground">
                        Nenhum membro encontrado.
                      </td>
                    </tr>
                  ) : (
                    membrosVisiveis.map((m) => {
                      const isSelf = m.user_id === user?.id;
                      return (
                        <tr key={m.id} className="transition-colors hover:bg-muted/30">
                          <td className="px-5 py-3.5">
                            <div className="flex items-center gap-3">
                              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
                                {m.papel === "admin" ? (
                                  <ShieldCheck className="h-4 w-4" />
                                ) : (
                                  <UserIcon className="h-4 w-4" />
                                )}
                              </div>
                              <div className="min-w-0">
                                <p className="truncate font-medium text-foreground">
                                  {m.nome || "Sem nome"}
                                  {isSelf && (
                                    <span className="ml-2 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
                                      Você
                                    </span>
                                  )}
                                </p>
                                <p className="truncate text-xs text-muted-foreground font-mono">
                                  {m.user_id.slice(0, 8)}…
                                </p>
                              </div>
                            </div>
                          </td>
                          <td className="px-5 py-3.5">
                            {isAdmin && !isSelf ? (
                              <Select
                                value={m.papel}
                                onValueChange={(v) => atualizarPapel(m.id, v as "admin" | "operador")}
                              >
                                <SelectTrigger className="w-[140px]">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="admin">Administrador</SelectItem>
                                  <SelectItem value="operador">Membro</SelectItem>
                                </SelectContent>
                              </Select>
                            ) : (
                              <span className="inline-flex items-center rounded-full border border-border px-2.5 py-0.5 text-xs font-medium text-foreground">
                                {PAPEL_LABEL[m.papel]}
                              </span>
                            )}
                          </td>
                          <td className="px-5 py-3.5">
                            <span
                              className={
                                m.ativo
                                  ? "inline-flex items-center rounded-full border border-status-aprovado/20 bg-status-aprovado-soft px-2.5 py-0.5 text-xs font-medium text-status-aprovado"
                                  : "inline-flex items-center rounded-full border border-status-ignorado/20 bg-status-ignorado-soft px-2.5 py-0.5 text-xs font-medium text-status-ignorado"
                              }
                            >
                              <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-current" />
                              {m.ativo ? "Ativo" : "Inativo"}
                            </span>
                          </td>
                          <td className="px-5 py-3.5 tabular-nums text-muted-foreground">
                            {dataFmt(m.criado_em)}
                          </td>
                          <td className="px-5 py-3.5 text-right">
                            <div className="flex justify-end gap-1.5">
                              {isSelf && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => setAlterarSenhaOpen(true)}
                                  className="gap-1.5"
                                >
                                  <KeyRound className="h-3.5 w-3.5" />
                                  Alterar senha
                                </Button>
                              )}
                              {isAdmin && !isSelf && (
                                <>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => alternarAtivo(m.id, m.ativo)}
                                    className="gap-1.5"
                                  >
                                    <Power className="h-3.5 w-3.5" />
                                    {m.ativo ? "Desativar" : "Ativar"}
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => remover(m.id)}
                                    className="gap-1.5 text-destructive hover:text-destructive"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {convites.length > 0 && (
            <div className="mt-6 rounded-xl border border-border bg-card shadow-softeum-sm">
              <div className="flex items-center justify-between border-b border-border px-5 py-4">
                <div className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  <h2 className="text-base font-semibold text-foreground">
                    {convites.length} convite{convites.length === 1 ? "" : "s"} pendente{convites.length === 1 ? "" : "s"}
                  </h2>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/20 text-xs uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-5 py-3 text-left font-medium">E-mail</th>
                      <th className="px-5 py-3 text-left font-medium">Papel</th>
                      <th className="px-5 py-3 text-left font-medium">Enviado em</th>
                      <th className="px-5 py-3 text-right font-medium">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {convites.map((c) => {
                      const emAndamento = conviteAcaoEmAndamento === c.id;
                      return (
                        <tr key={c.id} className="transition-colors hover:bg-muted/30">
                          <td className="px-5 py-3.5">
                            <div className="flex items-center gap-3">
                              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-warning/10 text-warning">
                                <Mail className="h-4 w-4" />
                              </div>
                              <p className="truncate font-medium text-foreground">{c.email}</p>
                            </div>
                          </td>
                          <td className="px-5 py-3.5">
                            <span className="inline-flex items-center rounded-full border border-border px-2.5 py-0.5 text-xs font-medium text-foreground">
                              {PAPEL_LABEL[c.papel]}
                            </span>
                          </td>
                          <td className="px-5 py-3.5 tabular-nums text-muted-foreground">
                            {dataFmt(c.created_at)}
                          </td>
                          <td className="px-5 py-3.5 text-right">
                            <div className="flex justify-end gap-1.5">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => reenviarConvite(c)}
                                disabled={emAndamento}
                                className="gap-1.5"
                              >
                                {emAndamento ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Send className="h-3.5 w-3.5" />
                                )}
                                Reenviar
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setCancelarConviteId(c.id)}
                                disabled={emAndamento}
                                className="gap-1.5 text-destructive hover:text-destructive"
                              >
                                <X className="h-3.5 w-3.5" />
                                Cancelar
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <p className="mt-4 text-xs text-muted-foreground">
            Ao convidar um membro, enviamos um link por email para que ele defina o próprio nome e senha.
          </p>
        </>
      )}

      <ConvidarMembroDialog
        open={convidarOpen}
        onOpenChange={setConvidarOpen}
        onSubmit={convidarMembro}
      />

      <AlterarSenhaDialog
        open={alterarSenhaOpen}
        onOpenChange={setAlterarSenhaOpen}
        email={user?.email ?? ""}
      />

      <AlertDialog open={removerId !== null} onOpenChange={(o) => !o && setRemoverId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover membro?</AlertDialogTitle>
            <AlertDialogDescription>
              {membroParaRemover
                ? `${membroParaRemover.nome ?? membroParaRemover.email ?? "Este membro"} perderá o acesso ao tenant. Esta ação não pode ser desfeita.`
                : "Esta ação não pode ser desfeita."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmarRemocao}>Remover</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={cancelarConviteId !== null}
        onOpenChange={(o) => !o && setCancelarConviteId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar convite?</AlertDialogTitle>
            <AlertDialogDescription>
              {conviteParaCancelar
                ? `O link enviado para ${conviteParaCancelar.email} ficará inválido. Você poderá enviar um novo convite depois se quiser.`
                : "O link do convite ficará inválido."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmarCancelarConvite}>
              Cancelar convite
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
