import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type Papel = "admin" | "operador";

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  tenantId: string | null;
  papel: Papel | null;
  isSuperAdmin: boolean;
  nomeTenant: string | null;
  nomeUsuario: string | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
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
  const [loading, setLoading] = useState(true);

  const loadContext = async (userId: string) => {
    try {
      // Nota: as tabelas tenant_membros, tenants, super_admins são do Supabase existente.
      // Quando o usuário conectar ao Supabase dele, essas queries funcionarão.
      // Usando `as any` para não falhar o build antes da conexão real.
      const sb = supabase as any;

      const [{ data: membro }, { data: superAdm }] = await Promise.all([
        sb.from("tenant_membros").select("tenant_id, papel, nome").eq("user_id", userId).maybeSingle(),
        sb.from("super_admins").select("user_id").eq("user_id", userId).maybeSingle(),
      ]);

      if (membro) {
        setTenantId(membro.tenant_id);
        setPapel(membro.papel as Papel);
        setNomeUsuario(membro.nome);

        const { data: tenant } = await sb.from("tenants").select("nome").eq("id", membro.tenant_id).maybeSingle();
        if (tenant) setNomeTenant(tenant.nome);
      } else {
        setTenantId(null);
        setPapel(null);
        setNomeUsuario(null);
        setNomeTenant(null);
      }

      setIsSuperAdmin(!!superAdm);
    } catch {
      // Tabelas ainda não disponíveis — mantém estado mínimo
      setTenantId(null);
      setPapel(null);
      setIsSuperAdmin(false);
    }
  };

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      setUser(newSession?.user ?? null);
      if (newSession?.user) {
        setTimeout(() => loadContext(newSession.user.id), 0);
      } else {
        setTenantId(null);
        setPapel(null);
        setIsSuperAdmin(false);
        setNomeTenant(null);
        setNomeUsuario(null);
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
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider
      value={{ user, session, tenantId, papel, isSuperAdmin, nomeTenant, nomeUsuario, loading, signIn, signOut }}
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
