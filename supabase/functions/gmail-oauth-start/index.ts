// Edge Function: gmail-oauth-start
// Recebe tenant_id, valida que o caller é admin do tenant (ou super
// admin), gera state assinado com HMAC e devolve a URL de autorização
// do Google OAuth. Usado pelo botão "Conectar Gmail" em /configuracoes.
//
// Estado anterior aceitava qualquer um (verify_jwt=false) e usava
// state=tenant_id sem assinatura — vulnerável a CSRF / impersonação
// de tenant. Agora exige JWT do user + checa is_super_admin OR
// is_tenant_admin antes de emitir o state.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { SUPABASE_URL, getServiceRole } from "../_shared/supabase-client.ts";
import { signOAuthState } from "../_shared/oauth-state.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};
const REDIRECT_URI =
  "https://arihejdirnhmcwuhkzde.supabase.co/functions/v1/gmail-oauth-callback";
const SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");

function jsonResp(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    const url = new URL(req.url);
    const tenantId = url.searchParams.get("tenant_id");
    if (!tenantId) return jsonResp(400, { error: "tenant_id obrigatório" });

    const clientId = Deno.env.get("GMAIL_CLIENT_ID");
    if (!clientId) return jsonResp(500, { error: "GMAIL_CLIENT_ID não configurado" });

    const serviceRole = getServiceRole();
    if (!serviceRole) return jsonResp(500, { error: "Service role não configurado" });

    // Authz: caller precisa estar logado E ser admin do tenant (ou super admin).
    // OAuth do Gmail conecta a conta do tenant; só admin tem direito.
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return jsonResp(401, { error: "Não autenticado" });
    }
    const anon = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY");
    if (!anon) return jsonResp(500, { error: "Anon key não configurada" });

    const userClient = createClient(SUPABASE_URL, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: userRes } = await userClient.auth.getUser();
    if (!userRes?.user) return jsonResp(401, { error: "Sessão inválida" });

    const { data: isSuper } = await userClient.rpc("is_super_admin");
    const { data: isAdmin } = isSuper ? { data: true } : await userClient.rpc("is_tenant_admin", { p_tenant_id: tenantId });
    if (!isSuper && !isAdmin) {
      console.warn(`[oauth-start] User ${userRes.user.id} sem permissão de admin no tenant ${tenantId}`);
      return jsonResp(403, { error: "Apenas admins do tenant podem conectar o Gmail" });
    }

    // State assinado com HMAC + nonce + 10min de TTL. Sem isso atacante
    // poderia forjar state=<tenant_alheio> e gravar tokens do próprio
    // Gmail no tenant da vítima (substituindo a integração).
    const state = await signOAuthState(tenantId, serviceRole);

    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", SCOPES);
    authUrl.searchParams.set("access_type", "offline");
    authUrl.searchParams.set("prompt", "consent");
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("include_granted_scopes", "true");

    return jsonResp(200, { url: authUrl.toString() });
  } catch (e) {
    return jsonResp(500, { error: (e as Error).message });
  }
});
