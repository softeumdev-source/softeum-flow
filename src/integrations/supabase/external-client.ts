// Cliente Supabase secundário apontando para o projeto externo
// arihejdirnhmcwuhkzde — usado para leitura/escrita de pedidos.
// Cria uma instância autenticada com o token da sessão atual.
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "./client";

const EXTERNAL_URL = "https://arihejdirnhmcwuhkzde.supabase.co";
const EXTERNAL_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFyaWhlamRpcm5obWN3dWhremRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3Mzk5MzAsImV4cCI6MjA5MjMxNTkzMH0.JNcv6mm_eNS__TvctUCalot1OcKxIUZPAtkslRya1Cg";

// Instância base (sem autenticação) — fallback
export const supabaseExternal = createClient(EXTERNAL_URL, EXTERNAL_ANON_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

// Cria uma instância autenticada com o token JWT da sessão atual.
// Use sempre que precisar respeitar RLS no projeto externo.
export async function getAuthedExternalClient(): Promise<SupabaseClient> {
  const { data: { session } } = await supabase.auth.getSession();
  const accessToken = session?.access_token;

  return createClient(EXTERNAL_URL, EXTERNAL_ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: accessToken
      ? {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      : undefined,
  });
}
