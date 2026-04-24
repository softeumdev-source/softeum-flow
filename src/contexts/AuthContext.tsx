import { createContext, useContext, useEffect, useState, ReactNode, useRef } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type Papel = "admin" | "operador";

const SESSION_TOKEN_KEY = "softeum.session_token";
const SUPER_ADMIN_DEMO_TENANT_ID = "2b0389b5-e9bd-4279-8b2f-794ba132cdf5";

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  tenantId: string | null;
  papel: Papel | null;
  isSuperAdmin: boolean;
  nomeTenant: string | null;
  nomeUsuario: string | null;
  tenantBloqueado: boolean;
  motivoBloqueio: string | null;
  sessaoInvalidada: boolean;
  acessoDesativado: boolean;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  /** Atualiza ultimo_acesso e valida se session_token local ainda é o atual no banco. */
  pingSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [papel, setPapel] = useState<Papel | null>(null);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [nomeTenant, setNomeTenant] = useState<string | null>(null);
  const [nomeUsuario, setNomeUsuario] = useState<string | null>(null);
  const [tenantBloqueado, setTenantBloqueado] = useState(false);
  const [motivoBloqueio, setMotivoBloqueio] = useState<string | null>(null);
  const [sessaoInvalidada, setSessaoInvalidada] = useState(false);
  const [acessoDesativado, setAcessoDesativado] = useState(false);
  const [loading, setLoading] = useState(true);
  const membroIdRef = useRef<string | null>(null);

  const resetState = () => {
    setTenantId(null);
    setPapel(null);
    setIsSuperAdmin(false);
    setNomeTenant(null);
    setNomeUsuario(null);
    setTenantBloqueado(false);
    setMotivoBloqueio(null);
    membroIdRef.current = null;
  };

  const loadContext = async (userId: string) => {
    try {
      const sb = supabase as any;

      // 1) Verifica super admin PRIMEIRO — super admin tem acesso irrestrito
      //    e nunca deve ser bloqueado por falta de vínculo com tenant.
      const { data: superAdm } = await sb
        .from("super_admins")
        .select("user_id")
        .eq("user_id", userId)
        .maybeSingle();
      const ehSuperAdmin = !!superAdm;
      setIsSuperAdmin(ehSuperAdmin);

      // 2) Carrega vínculo de tenant (se houver). Não filtra por `ativo` aqui
      //    porque rows antigas podem ter `ativo = null` (default true), o que
      //    excluiria o vínculo e zeraria o papel do usuário. Filtramos em JS.
      const { data: membros, error: membrosError } = await sb
        .from("tenant_membros")
        .select("id, user_id, tenant_id, papel, nome, ativo")
        .eq("user_id", userId)
        .limit(5);

      const lista = Array.isArray(membros) ? membros : [];
      const membroAtivo = lista.find((m: any) => m.ativo !== false) ?? null;
      const temAlgumMembro = lista.length > 0;
      const todosInativos = temAlgumMembro && !membroAtivo;

      console.log("[AuthContext] userId logado:", userId);
      console.log("[AuthContext] membros retornados do banco:", membros);
      console.log("[AuthContext] membro selecionado:", membroAtivo);
      console.log("[AuthContext] papel do banco:", membroAtivo?.papel);
      console.log("[AuthContext] erro query:", membrosError);

      // Se o usuário tem vínculo(s) mas TODOS estão inativos e NÃO é super admin,
      // o acesso foi desativado pelo admin. Encerra a sessão imediatamente.
      if (todosInativos && !ehSuperAdmin) {
        console.warn("[AuthContext] Acesso desativado — forçando signOut.");
        setAcessoDesativado(true);
        resetState();
        try {
          await supabase.auth.signOut();
        } catch (e) {
          console.warn("signOut local falhou:", e);
        }
        return;
      }

      if (membroAtivo) {
        setTenantId(membroAtivo.tenant_id);
        setPapel((ehSuperAdmin ? "admin" : membroAtivo.papel) as Papel);
        setNomeUsuario(membroAtivo.nome);
        membroIdRef.current = membroAtivo.id;

        const { data: tenant } = await sb
          .from("tenants")
          .select("nome, bloqueado_em, motivo_bloqueio")
          .eq("id", membroAtivo.tenant_id)
          .maybeSingle();
        if (tenant) {
          setNomeTenant(tenant.nome);
          // Super admin nunca é bloqueado por bloqueio de tenant
          setTenantBloqueado(!ehSuperAdmin && !!tenant.bloqueado_em);
          setMotivoBloqueio(tenant.motivo_bloqueio ?? null);
        }
      } else if (ehSuperAdmin) {
        // Fallback obrigatório: super admin usa o tenant Demo quando a página exige tenant.
        setTenantId(SUPER_ADMIN_DEMO_TENANT_ID);
        setPapel("admin");
        setNomeUsuario(null);
        setTenantBloqueado(false);
        setMotivoBloqueio(null);
        membroIdRef.current = null;

        const { data: tenantDemo } = await sb
          .from("tenants")
          .select("nome")
          .eq("id", SUPER_ADMIN_DEMO_TENANT_ID)
          .maybeSingle();
        setNomeTenant(tenantDemo?.nome ?? "Demo Softeum");
      } else {
        // Sem vínculo de tenant — ok para super admin, problema para os demais
        setTenantId(null);
        setPapel(null);
        setNomeTenant(null);
        setNomeUsuario(null);
        setTenantBloqueado(false);
        setMotivoBloqueio(null);
        membroIdRef.current = null;
      }
    } catch {
      resetState();
    }
  };

  const pingSession = async () => {
    if (!user) return;
    try {
      const sb = supabase as any;
      const localToken = localStorage.getItem(SESSION_TOKEN_KEY);

      // Localiza membro: usa cache se disponível, senão busca por user_id.
      let membroId = membroIdRef.current;
      let remoteToken: string | null = null;

      if (membroId) {
        const { data: row } = await sb
          .from("tenant_membros")
          .select("session_token")
          .eq("id", membroId)
          .maybeSingle();
        remoteToken = row?.session_token ?? null;
      } else {
        const { data: row } = await sb
          .from("tenant_membros")
          .select("id, session_token")
          .eq("user_id", user.id)
          .maybeSingle();
        if (row?.id) {
          membroId = row.id;
          membroIdRef.current = row.id;
          remoteToken = row.session_token ?? null;
        }
      }

      console.log("[pingSession] localToken:", localToken, "remoteToken:", remoteToken);

      // Se há token remoto e ele é diferente do local => outra sessão venceu.
      // Também invalida quando o local existe mas o remoto está nulo (foi resetado).
      if (localToken && remoteToken && remoteToken !== localToken) {
        console.warn("[AuthContext] Sessão substituída por outro dispositivo. Encerrando.");
        localStorage.removeItem(SESSION_TOKEN_KEY);
        setSessaoInvalidada(true);
        resetState();
        try {
          await supabase.auth.signOut();
        } catch (e) {
          console.warn("signOut local falhou:", e);
        }
        return;
      }

      if (membroId) {
        await sb
          .from("tenant_membros")
          .update({ ultimo_acesso: new Date().toISOString() })
          .eq("id", membroId);
      }
    } catch (e) {
      console.warn("[pingSession] erro:", e);
    }
  };

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      setUser(newSession?.user ?? null);
      if (newSession?.user) {
        setTimeout(() => loadContext(newSession.user.id), 0);
      } else {
        resetState();
      }
    });

    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) loadContext(s.user.id).finally(() => setLoading(false));
      else setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    setSessaoInvalidada(false);
    setAcessoDesativado(false);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };

    // Sessão única: gera novo token, salva no banco (invalida sessões antigas)
    // e armazena localmente para o pingSession comparar nas próximas navegações.
    const userId = data.user?.id;
    if (userId) {
      try {
        const sb = supabase as any;
        const novoToken =
          (globalThis.crypto as any)?.randomUUID?.() ??
          `${Date.now()}-${Math.random().toString(36).slice(2)}`;

        const { data: membro } = await sb
          .from("tenant_membros")
          .select("id")
          .eq("user_id", userId)
          .maybeSingle();

        if (membro?.id) {
          await sb
            .from("tenant_membros")
            .update({
              session_token: novoToken,
              ultimo_acesso: new Date().toISOString(),
            })
            .eq("id", membro.id);
          membroIdRef.current = membro.id;
        }

        localStorage.setItem(SESSION_TOKEN_KEY, novoToken);
        console.log("[signIn] novo session_token gravado:", novoToken, "membroId:", membro?.id);
      } catch (e) {
        console.warn("[signIn] falha ao gravar session_token:", e);
      }
    }

    return { error: null };
  };

  const signOut = async () => {
    localStorage.removeItem(SESSION_TOKEN_KEY);
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        tenantId,
        papel,
        isSuperAdmin,
        nomeTenant,
        nomeUsuario,
        tenantBloqueado,
        motivoBloqueio,
        sessaoInvalidada,
        acessoDesativado,
        loading,
        signIn,
        signOut,
        pingSession,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth deve ser usado dentro de AuthProvider");
  return ctx;
}
