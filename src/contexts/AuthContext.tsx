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
      const { data: membros } = await sb
        .from("tenant_membros")
        .select("id, tenant_id, papel, nome, session_token, ativo")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(5);
      const membro =
        Array.isArray(membros) && membros.length > 0
          ? membros.find((m: any) => m.ativo !== false) ?? null
          : null;

      if (membro) {
        setTenantId(membro.tenant_id);
        setPapel((ehSuperAdmin ? "admin" : membro.papel) as Papel);
        setNomeUsuario(membro.nome);
        membroIdRef.current = membro.id;

        // Validação de sessão única — pulada para super admin (acesso multi-dispositivo)
        const localToken = localStorage.getItem(SESSION_TOKEN_KEY);
        if (!ehSuperAdmin && membro.session_token && localToken && membro.session_token !== localToken) {
          setSessaoInvalidada(true);
          await supabase.auth.signOut();
          localStorage.removeItem(SESSION_TOKEN_KEY);
          return;
        }

        const { data: tenant } = await sb
          .from("tenants")
          .select("nome, bloqueado_em, motivo_bloqueio")
          .eq("id", membro.tenant_id)
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
    if (!user || !membroIdRef.current) return;
    const localToken = localStorage.getItem(SESSION_TOKEN_KEY);
    if (!localToken) return;
    try {
      const sb = supabase as any;
      const { data } = await sb
        .from("tenant_membros")
        .select("session_token")
        .eq("id", membroIdRef.current)
        .maybeSingle();

      if (data?.session_token && data.session_token !== localToken) {
        setSessaoInvalidada(true);
        await supabase.auth.signOut();
        localStorage.removeItem(SESSION_TOKEN_KEY);
        return;
      }

      await sb
        .from("tenant_membros")
        .update({ ultimo_acesso: new Date().toISOString() })
        .eq("id", membroIdRef.current);
    } catch {
      // silencioso
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
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };

    // Sessão única: gera novo token e grava em tenant_membros, expulsando sessões anteriores.
    const userId = data.user?.id;
    if (userId) {
      try {
        const sb = supabase as any;
        const { data: membro } = await sb
          .from("tenant_membros")
          .select("id")
          .eq("user_id", userId)
          .maybeSingle();
        if (membro?.id) {
          const novoToken = crypto.randomUUID();
          await sb
            .from("tenant_membros")
            .update({ session_token: novoToken, ultimo_acesso: new Date().toISOString() })
            .eq("id", membro.id);
          localStorage.setItem(SESSION_TOKEN_KEY, novoToken);
        }
      } catch {
        // tenant_membros pode não existir para super admin puro — ignora
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
