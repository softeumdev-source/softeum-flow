// redeploy 24/04/2026
// Edge Function: gmail-oauth-callback
import { SUPABASE_URL, getServiceRole } from "../_shared/supabase-client.ts";
import { verifyOAuthState } from "../_shared/oauth-state.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const APP_REDIRECT_DEFAULT = "https://plataforma.softeum.com.br/configuracoes";

function htmlResponse(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" },
  });
}

function redirectResponse(url: string) {
  return new Response(null, {
    status: 302,
    headers: { ...corsHeaders, Location: url },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    const appRedirect = APP_REDIRECT_DEFAULT;

    if (error) {
      return redirectResponse(
        `${appRedirect}?gmail=erro&motivo=${encodeURIComponent(error)}`,
      );
    }

    if (!code || !state) {
      return htmlResponse(
        "<h1>Parâmetros ausentes</h1><p>code ou state não foram informados.</p>",
        400,
      );
    }

    const clientId = Deno.env.get("GMAIL_CLIENT_ID");
    const clientSecret = Deno.env.get("GMAIL_CLIENT_SECRET");
    const serviceRole = getServiceRole();

    if (!clientId || !clientSecret || !serviceRole) {
      console.error("Secrets faltando", {
        hasClientId: !!clientId,
        hasClientSecret: !!clientSecret,
        hasServiceRole: !!serviceRole,
      });
      return htmlResponse(
        "<h1>Configuração incompleta</h1><p>Secrets do Gmail não configurados.</p>",
        500,
      );
    }

    // Verifica assinatura HMAC do state. Sem isso atacante poderia
    // engatilhar OAuth com state=<tenant_alheio> e fazer com que os
    // tokens do próprio Gmail fossem gravados sob outro tenant.
    // signOAuthState usa SUPABASE_SERVICE_ROLE_KEY como segredo (mesmo
    // que getServiceRole acima), então mesma fonte de verdade.
    const statePayload = await verifyOAuthState(state, serviceRole);
    if (!statePayload) {
      console.warn("[oauth-callback] state inválido ou expirado");
      return redirectResponse(
        `${appRedirect}?gmail=erro&motivo=${encodeURIComponent("state_invalido")}`,
      );
    }
    const tenantId = statePayload.tid;

    const redirectUri = `https://arihejdirnhmcwuhkzde.supabase.co/functions/v1/gmail-oauth-callback`;

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    const tokenJson = await tokenRes.json();

    if (!tokenRes.ok) {
      console.error("Erro ao trocar code por token", tokenJson);
      return redirectResponse(
        `${appRedirect}?gmail=erro&motivo=${encodeURIComponent(
          tokenJson.error_description || tokenJson.error || "token_exchange",
        )}`,
      );
    }

    const accessToken: string = tokenJson.access_token;
    const refreshToken: string | undefined = tokenJson.refresh_token;
    const expiresIn: number = tokenJson.expires_in ?? 3600;
    const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    let email = "";
    try {
      const profileRes = await fetch(
        "https://www.googleapis.com/oauth2/v2/userinfo",
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (profileRes.ok) {
        const profile = await profileRes.json();
        email = profile.email ?? "";
      }
    } catch (e) {
      console.warn("Não foi possível obter userinfo", e);
    }

    const upsertRes = await fetch(
      `${SUPABASE_URL}/rest/v1/tenant_gmail_config?on_conflict=tenant_id`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: serviceRole,
          Authorization: `Bearer ${serviceRole}`,
          Prefer: "resolution=merge-duplicates,return=representation",
        },
        body: JSON.stringify({
          tenant_id: tenantId,
          email,
          access_token: accessToken,
          refresh_token: refreshToken ?? null,
          token_expires_at: tokenExpiresAt,
          ativo: true,
          alerta_desconexao_enviado: false,
        }),
      },
    );

    if (!upsertRes.ok) {
      const errText = await upsertRes.text();
      console.error("Erro ao salvar tenant_gmail_config", errText);
      return redirectResponse(
        `${appRedirect}?gmail=erro&motivo=${encodeURIComponent("save_failed")}`,
      );
    }

    return redirectResponse(`${appRedirect}?gmail=ok`);
  } catch (e) {
    console.error("Erro inesperado", e);
    return htmlResponse(
      `<h1>Erro inesperado</h1><pre>${(e as Error).message}</pre>`,
      500,
    );
  }
});
