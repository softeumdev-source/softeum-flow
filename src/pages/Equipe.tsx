import { useEffect, useMemo, useState } from "react";
import { Users, Loader2, ShieldCheck, User as UserIcon, Power, Trash2, AlertTriangle, UserPlus, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ConvidarMembroDialog } from "@/components/equipe/ConvidarMembroDialog";
import { CredenciaisDialog } from "@/components/admin/CredenciaisDialog";
import { AlterarSenhaDialog } from "@/components/equipe/AlterarSenhaDialog";

interface Membro {
  id: string;
  user_id: string;
  nome: string | null;
  papel: "admin" | "operador";
  ativo: boolean;
  criado_em: string | null;
}

const dataFmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }) : "-";

export default function Equipe() {
  const { user, tenantId, papel, isSuperAdmin, nomeTenant, nomeUsuario, loading: authLoading } = useAuth();
  const isAdmin = papel === "admin" || isSuperAdmin;
  const isOperador = !isAdmin;
  const operadorNome = (nomeUsuario && nomeUsuario.trim()) || user?.email || "Usuário";

  const [membros, setMembros] = useState<Membro[]>([]);
  const [limiteUsuarios, setLimiteUsuarios] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [convidarOpen, setConvidarOpen] = useState(false);
  const [credenciais, setCredenciais] = useState<{ email: string; senha: string } | null>(null);
  const [alterarSenhaOpen, setAlterarSenhaOpen] = useState(false);

  const membrosVisiveis = useMemo(() => membros, [membros]);

  const loadingTabela = loading;

  const carregar = async () => {
    if (!tenantId || !user || !isAdmin) return;
    setLoading(true);
    try {
      const sb = supabase as any;

      const [{ data: m, error: errM }, { data: t, error: errT }] = await Promise.all([
        sb
          .from("tenant_membros")
          .select("id, user_id, nome, papel, ativo, criado_em")
          .eq("tenant_id", tenantId)
          .order("criado_em", { ascending: true }),
        sb.from("tenants").select("limite_usuarios").eq("id", tenantId).maybeSingle(),
      ]);
      if (errM) throw errM;
      if (errT) throw errT;
      setMembros((m ?? []) as Membro[]);
      setLimiteUsuarios(t?.limite_usuarios ?? null);
    } catch (err: any) {
      toast.error("Erro ao carregar membros", { description: err.message });
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

  const convidarMembro = async (dados: { nome: string; email: string; papel: "admin" | "operador" }) => {
    if (!tenantId) {
      toast.error("Tenant não identificado");
      return;
    }
    if (limiteAtingido) {
      toast.error("Limite de usuários atingido. Entre em contato com o administrador para aumentar seu plano.");
      return;
    }
    try {
      const payload = {
        tenant_id: tenantId,
        admin_nome: dados.nome,
        admin_email: dados.email,
        empresa_nome: nomeTenant ?? undefined,
        papel: dados.papel,
      };
      console.log("[Equipe] Convidando membro - payload:", payload);

      const { data: resp, error: invokeErr } = await supabase.functions.invoke(
        "criar-usuario-tenant",
        { body: payload },
      );
      if (invokeErr) {
        throw new Error(invokeErr.message ?? "Falha ao criar usuário");
      }
      if (!resp?.sucesso) {
        throw new Error(resp?.error ?? "Falha ao criar usuário");
      }

      console.log("[Equipe] Usuário criado:", {
        admin_user_id: resp.admin_user_id,
        papel_solicitado: dados.papel,
        papel_retornado: resp.papel,
      });

      // Fallback de segurança: se por algum motivo o papel não bater, força via UPDATE.
      if (resp.admin_user_id && resp.papel !== dados.papel) {
        const { error: updateErr } = await (supabase as any)
          .from("tenant_membros")
          .update({ papel: dados.papel })
          .eq("user_id", resp.admin_user_id)
          .eq("tenant_id", tenantId);
        if (updateErr) {
          console.error("[Equipe] Falha ao ajustar papel:", updateErr);
          toast.warning("Acesso criado, mas não foi possível definir o papel", {
            description: updateErr.message,
          });
        }
      }

      setConvidarOpen(false);
      setCredenciais({ email: resp.email, senha: resp.senha_provisoria });
      toast.success("Acesso criado com sucesso");
      await carregar();
    } catch (err: any) {
      toast.error("Não foi possível criar o acesso", { description: err.message });
    }
  };

  const atualizarPapel = async (id: string, novoPapel: "admin" | "operador") => {
    if (!isAdmin) return;
    const anterior = membros;
    setMembros((m) => m.map((x) => (x.id === id ? { ...x, papel: novoPapel } : x)));
    try {
      const { error } = await (supabase as any)
        .from("tenant_membros")
        .update({ papel: novoPapel })
        .eq("id", id);
      if (error) throw error;
      toast.success("Papel atualizado");
    } catch (err: any) {
      setMembros(anterior);
      toast.error("Não foi possível atualizar", { description: err.message });
    }
  };

  const ativosCount = membros.filter((m) => m.ativo).length;
  const limiteAtingido = limiteUsuarios != null && ativosCount >= limiteUsuarios;

  const alternarAtivo = async (id: string, ativo: boolean) => {
    if (!isAdmin) return;
    // Reativar consome uma licença — bloquear se já está no limite.
    if (!ativo && limiteAtingido) {
      toast.error("Limite de usuários atingido. Entre em contato com o administrador para aumentar seu plano.");
      return;
    }
    const anterior = membros;
    setMembros((m) => m.map((x) => (x.id === id ? { ...x, ativo: !ativo } : x)));
    try {
      const { error } = await (supabase as any)
        .from("tenant_membros")
        .update({ ativo: !ativo })
        .eq("id", id);
      if (error) throw error;
      toast.success(!ativo ? "Membro reativado" : "Membro desativado");
    } catch (err: any) {
      setMembros(anterior);
      toast.error("Não foi possível alterar status", { description: err.message });
    }
  };

  const remover = async (id: string) => {
    if (!isAdmin) return;
    if (!confirm("Remover este membro do tenant?")) return;
    const anterior = membros;
    setMembros((m) => m.filter((x) => x.id !== id));
    try {
      const { error } = await (supabase as any).from("tenant_membros").delete().eq("id", id);
      if (error) throw error;
      toast.success("Membro removido");
    } catch (err: any) {
      setMembros(anterior);
      toast.error("Não foi possível remover", { description: err.message });
    }
  };

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
                  {ativosCount} / {limiteUsuarios} licenças em uso
                </p>
                <p className="text-xs text-muted-foreground">
                  {limiteAtingido
                    ? "Limite de usuários atingido. Entre em contato com o administrador para aumentar seu plano."
                    : `${limiteUsuarios - ativosCount} licença(s) disponível(is)`}
                </p>
              </div>
            </div>
            <span className="h-2 w-32 overflow-hidden rounded-full bg-muted">
              <span
                className={`block h-full ${limiteAtingido ? "bg-destructive" : ativosCount / limiteUsuarios >= 0.8 ? "bg-warning" : "bg-success"}`}
                style={{ width: `${Math.min(100, (ativosCount / limiteUsuarios) * 100)}%` }}
              />
            </span>
          </div>
        </div>
      )}

      {isOperador ? (
        <>
          <p className="mb-4 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
            Você está visualizando como operador. Você pode apenas ver seus próprios dados e alterar sua senha.
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
                        Operador
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
                                  <SelectItem value="operador">Operador</SelectItem>
                                </SelectContent>
                              </Select>
                            ) : (
                              <span className="inline-flex items-center rounded-full border border-border px-2.5 py-0.5 text-xs font-medium text-foreground">
                                {m.papel === "admin" ? "Administrador" : "Operador"}
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

          <p className="mt-4 text-xs text-muted-foreground">
            Ao convidar um membro, geramos uma senha provisória que você pode enviar para o primeiro acesso.
          </p>
        </>
      )}

      <ConvidarMembroDialog
        open={convidarOpen}
        onOpenChange={setConvidarOpen}
        onSubmit={convidarMembro}
      />

      <CredenciaisDialog
        open={!!credenciais}
        onOpenChange={(v) => {
          if (!v) setCredenciais(null);
        }}
        email={credenciais?.email ?? ""}
        senha={credenciais?.senha ?? ""}
        empresaNome={nomeTenant ?? undefined}
      />

      <AlterarSenhaDialog
        open={alterarSenhaOpen}
        onOpenChange={setAlterarSenhaOpen}
        email={user?.email ?? ""}
      />
    </div>
  );
}
