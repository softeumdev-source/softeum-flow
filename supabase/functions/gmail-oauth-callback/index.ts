// Edge Function: gmail-oauth-callback
// Recebe o "code" do Google OAuth, troca por tokens e salva no
// tenant_gmail_config do projeto Supabase externo (arihejdirnhmcwuhkzde).
//
// Esta função é PÚBLICA (chamada pelo redirect do Google), então
// não exige JWT. A autenticidade vem do "state" + troca do code com
// o GMAIL_CLIENT_SECRET.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const EXTERNAL_SUPABASE_URL = "https://arihejdirnhmcwuhkzde.supabase.co";

// Onde redirecionar o usuário no app no fim do fluxo
const APP_REDIRECT_DEFAULT =
  "https://orderflo-ai.lovable.app/configuracoes";

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
    const state = url.searchParams.get("state"); // tenant_id
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
    const serviceRoleExterno = Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY");

    if (!clientId || !clientSecret || !serviceRoleExterno) {
      console.error("Secrets faltando", {
        hasClientId: !!clientId,
        hasClientSecret: !!clientSecret,
        hasServiceRole: !!serviceRoleExterno,
      });
      return htmlResponse(
        "<h1>Configuração incompleta</h1><p>Secrets do Gmail não configurados.</p>",
        500,
      );
    }

    // O redirect_uri DEVE ser idêntico ao usado na URL de autorização
    const redirectUri = `https://mgxnwtynaaawlfnaxidj.supabase.co/functions/v1/gmail-oauth-callback`;

    // Troca o code por tokens
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

    // Buscar o e-mail da conta autorizada
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

    // Upsert no tenant_gmail_config do Supabase externo
    const upsertRes = await fetch(
      `${EXTERNAL_SUPABASE_URL}/rest/v1/tenant_gmail_config?on_conflict=tenant_id`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: serviceRoleExterno,
          Authorization: `Bearer ${serviceRoleExterno}`,
          Prefer: "resolution=merge-duplicates,return=representation",
        },
        body: JSON.stringify({
          tenant_id: state,
          email,
          access_token: accessToken,
          refresh_token: refreshToken ?? null,
          token_expires_at: tokenExpiresAt,
          ativo: true,
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
