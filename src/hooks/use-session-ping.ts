import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

const POLL_INTERVAL_MS = 10_000;

/**
 * Garante que apenas uma sessão por usuário esteja ativa.
 *
 * Estratégias combinadas:
 *  1. pingSession em toda navegação (mudança de rota)
 *  2. Polling a cada 10s enquanto a aba estiver aberta
 *  3. Ping ao voltar o foco / visibilidade da aba
 *  4. Realtime: escuta UPDATE em tenant_membros do usuário e dispara ping
 *     imediatamente quando outro dispositivo grava um novo session_token.
 *
 * Se o session_token local divergir do remoto, pingSession faz signOut.
 */
export function useSessionPing() {
  const { user, pingSession } = useAuth();
  const location = useLocation();

  // Ping em cada navegação
  useEffect(() => {
    if (!user) return;
    pingSession();
  }, [user, location.pathname, pingSession]);

  // Polling + foco/visibilidade
  useEffect(() => {
    if (!user) return;

    const interval = window.setInterval(() => {
      pingSession();
    }, POLL_INTERVAL_MS);

    const onFocus = () => pingSession();
    const onVisibility = () => {
      if (document.visibilityState === "visible") pingSession();
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [user, pingSession]);

  // Realtime: detecta troca de session_token quase instantaneamente
  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel(`session-watch-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "tenant_membros",
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          pingSession();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, pingSession]);
}
