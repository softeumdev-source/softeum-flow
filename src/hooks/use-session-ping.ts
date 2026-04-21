import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Atualiza ultimo_acesso e valida se a sessão atual ainda é a sessão "vencedora"
 * em cada navegação dentro do app. Se outro dispositivo logou depois,
 * o pingSession faz signOut local automaticamente.
 */
export function useSessionPing() {
  const { user, pingSession } = useAuth();
  const location = useLocation();

  useEffect(() => {
    if (!user) return;
    pingSession();
  }, [user, location.pathname, pingSession]);
}
