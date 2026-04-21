import { useEffect, useState } from "react";
import { Users, Loader2, ShieldCheck, User as UserIcon, Power, Trash2, AlertTriangle, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

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
  const { user, tenantId, papel, loading: authLoading } = useAuth();
  const isAdmin = papel === "admin";

  const [membros, setMembros] = useState<Membro[]>([]);
  const [limiteUsuarios, setLimiteUsuarios] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user || authLoading || !tenantId) return;
    const load = async () => {
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
    load();
  }, [user, authLoading, tenantId]);

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

  const alternarAtivo = async (id: string, ativo: boolean) => {
    if (!isAdmin) return;
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
            Membros que têm acesso a este tenant.
          </p>
        </div>
      </div>

      {!isAdmin && (
        <p className="mb-4 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
          Você está visualizando como operador. Apenas administradores podem alterar membros.
        </p>
      )}

      <div className="rounded-xl border border-border bg-card shadow-softeum-sm">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-base font-semibold text-foreground">
              {loading ? "Carregando..." : `${membros.length} ${membros.length === 1 ? "membro" : "membros"}`}
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
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-5 py-16 text-center text-muted-foreground">
                    <div className="flex items-center justify-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Carregando membros...
                    </div>
                  </td>
                </tr>
              ) : membros.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-16 text-center text-muted-foreground">
                    Nenhum membro encontrado.
                  </td>
                </tr>
              ) : (
                membros.map((m) => (
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
                          </p>
                          <p className="truncate text-xs text-muted-foreground font-mono">
                            {m.user_id.slice(0, 8)}…
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      {isAdmin && m.user_id !== user?.id ? (
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
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!isAdmin || m.user_id === user?.id}
                          onClick={() => alternarAtivo(m.id, m.ativo)}
                          className="gap-1.5"
                        >
                          <Power className="h-3.5 w-3.5" />
                          {m.ativo ? "Desativar" : "Ativar"}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!isAdmin || m.user_id === user?.id}
                          onClick={() => remover(m.id)}
                          className="gap-1.5 text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        Para convidar novos membros, eles precisam primeiro criar uma conta no login. Depois você poderá adicioná-los aqui (em breve).
      </p>
    </div>
  );
}
