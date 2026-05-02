// Edge function: lê metadata pública de um convite pelo token, sem exigir
// auth. Usada pela tela /aceitar-convite pra decidir o que mostrar antes
// do form (estado inválido / cancelado / aceito / valido).
//
// Não retorna o token nem dados sensíveis — só o necessário pra renderizar
// a tela: status, email, papel e nome do tenant. RLS sobre tenant_convites
// não tem policy SELECT pública, então a leitura passa pela service role.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.104.0";
import { SUPABASE_URL, getServiceRole } from "../_shared/supabase-client.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResp(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SERVICE_ROLE = getServiceRole();
    if (!SERVICE_ROLE) return jsonResp(500, { error: "Configuração inválida" });

    const body = await req.json().catch(() => ({}));
    const token = String(body?.token ?? "").trim();
    if (!token) return jsonResp(400, { error: "token obrigatório" });

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    const { data: convite, error } = await admin
      .from("tenant_convites")
      .select("status, email, papel, tenant_id")
      .eq("token", token)
      .maybeSingle();
    if (error) throw error;

    if (!convite) {
      return jsonResp(200, { encontrado: false });
    }

    const { data: tenant } = await admin
      .from("tenants")
      .select("nome")
      .eq("id", convite.tenant_id)
      .maybeSingle();

    return jsonResp(200, {
      encontrado: true,
      status: convite.status,
      email: convite.email,
      papel: convite.papel,
      tenant_nome: tenant?.nome ?? null,
    });
  } catch (e: any) {
    console.error("validar-convite error:", e?.message ?? e);
    return jsonResp(500, { error: e?.message ?? String(e) });
  }
});
