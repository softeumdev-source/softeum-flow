// Helper centralizado pra acesso ao Supabase a partir de edge functions.
// Usa as variáveis auto-injetadas pelo runtime (SUPABASE_URL e
// SUPABASE_SERVICE_ROLE_KEY) — não precisa configurar secret manualmente.
//
// O fallback hardcoded em SUPABASE_URL é defensivo: protege caso o runtime
// não injete a variável (cenário raro / dev local). Para a service role
// não há fallback seguro — chamadores devem checar o retorno e responder
// com erro adequado.

export const SUPABASE_URL =
  Deno.env.get("SUPABASE_URL") ?? "https://arihejdirnhmcwuhkzde.supabase.co";

export const getServiceRole = (): string | undefined =>
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
