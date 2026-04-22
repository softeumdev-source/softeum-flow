// Cliente Supabase secundário apontando para o projeto externo
// arihejdirnhmcwuhkzde — usado para leitura/escrita de pedidos e tabelas
// que vivem nesse projeto (não no Lovable Cloud).
import { createClient } from "@supabase/supabase-js";

const EXTERNAL_URL = "https://arihejdirnhmcwuhkzde.supabase.co";
const EXTERNAL_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFyaWhlamRpcm5obWN3dWhremRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3Mzk5MzAsImV4cCI6MjA5MjMxNTkzMH0.JNcv6mm_eNS__TvctUCalot1OcKxIUZPAtkslRya1Cg";

export const supabaseExternal = createClient(EXTERNAL_URL, EXTERNAL_ANON_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});
