const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = "https://arihejdirnhmcwuhkzde.supabase.co";
const APP_URL = "https://softeum-flow.vercel.app";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { tenant_id } = await req.json();
    if (!tenant_id) {
      return new Response(JSON.stringify({ error: "tenant_id é obrigatório" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const serviceRole = Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY");
    const clientId = Deno.env.get("GMAIL_CLIENT_ID");
    const clientSecret = Deno.env.get("GMAIL_CLIENT_SECRET");
    const systemRefreshToken = Deno.env.get("SYSTEM_GMAIL_REFRESH_TOKEN");
    const systemEmail = Deno.env.get("SYSTEM_GMAIL_EMAIL");

    if (!serviceRole || !clientId || !clientSecret || !systemRefreshToken || !systemEmail) {
      console.error("Secrets faltando", {
        hasServiceRole: !!serviceRole,
        hasClientId: !!clientId,
        hasClientSecret: !!clientSecret,
        hasSystemRefreshToken: !!systemRefreshToken,
        hasSystemEmail: !!systemEmail,
      });
      return new Response(JSON.stringify({ error: "Secrets do sistema não configurados" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1. Buscar nome do tenant
    const tenantRes = await fetch(
      `${SUPABASE_URL}/rest/v1/tenants?id=eq.${tenant_id}&select=nome`,
      { headers: { apikey: serviceRole, Authorization: `Bearer ${serviceRole}` } },
    );
    const tenants = await tenantRes.json();
    const nomeTenant = tenants[0]?.nome ?? "sua empresa";

    // 2. Determinar destinatário: configuração explícita ou primeiro admin
    const destinatario = await resolverDestinatario(tenant_id, serviceRole);
    if (!destinatario) {
      console.warn(`Sem destinatário para alerta — tenant ${tenant_id}`);
      // Mesmo sem destinatário, registramos no painel
      await criarNotificacaoPainel(tenant_id, serviceRole);
      return new Response(JSON.stringify({
        message: "Notificação de painel criada, mas sem destinatário de e-mail",
      }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3. Renovar token do Gmail do sistema
    const accessToken = await renovarTokenSistema(clientId, clientSecret, systemRefreshToken);

    // 4. Enviar e-mail
    const { assunto, html } = gerarEmail(nomeTenant);
    console.log(`Enviando alerta de Gmail desconectado para ${destinatario} (tenant ${tenant_id})`);
    const sendRes = await enviarEmail(accessToken, systemEmail, destinatario, assunto, html);
    if (!sendRes.ok) {
      const errBody = await sendRes.text();
      console.error("Falha ao enviar alerta:", errBody);
      // Mesmo com falha no e-mail, garantimos a notificação de painel
      await criarNotificacaoPainel(tenant_id, serviceRole);
      return new Response(JSON.stringify({ error: "Falha ao enviar e-mail", details: errBody }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 5. Notificação no painel
    await criarNotificacaoPainel(tenant_id, serviceRole);

    return new Response(JSON.stringify({ success: true, destinatario }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error("Erro:", (e as Error).message);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function resolverDestinatario(tenantId: string, serviceRole: string): Promise<string | null> {
  // 1. Tenta a chave email_alerta_gmail
  const cfgRes = await fetch(
    `${SUPABASE_URL}/rest/v1/configuracoes?tenant_id=eq.${tenantId}&chave=eq.email_alerta_gmail&select=valor`,
    { headers: { apikey: serviceRole, Authorization: `Bearer ${serviceRole}` } },
  );
  const cfgs = await cfgRes.json();
  const emailConfigurado = String(cfgs[0]?.valor ?? "").trim();
  if (emailConfigurado) return emailConfigurado;

  // 2. Fallback: e-mail do primeiro admin ativo do tenant
  const membrosRes = await fetch(
    `${SUPABASE_URL}/rest/v1/tenant_membros?tenant_id=eq.${tenantId}&papel=eq.admin&ativo=eq.true&select=user_id&order=created_at.asc&limit=1`,
    { headers: { apikey: serviceRole, Authorization: `Bearer ${serviceRole}` } },
  );
  const membros = await membrosRes.json();
  const userId = membros[0]?.user_id;
  if (!userId) return null;

  const userRes = await fetch(
    `${SUPABASE_URL}/auth/v1/admin/users/${userId}`,
    { headers: { apikey: serviceRole, Authorization: `Bearer ${serviceRole}` } },
  );
  if (!userRes.ok) {
    console.error("Falha ao buscar admin user:", await userRes.text());
    return null;
  }
  const userJson = await userRes.json();
  return String(userJson?.email ?? "").trim() || null;
}

async function renovarTokenSistema(clientId: string, clientSecret: string, refreshToken: string): Promise<string> {
  const refreshRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  const refreshJson = await refreshRes.json();
  if (!refreshRes.ok) {
    throw new Error(`Falha ao renovar token do Gmail do sistema: ${refreshJson.error ?? "desconhecido"}`);
  }
  return refreshJson.access_token;
}

async function enviarEmail(accessToken: string, remetente: string, destinatario: string, assunto: string, html: string): Promise<Response> {
  const boundary = "boundary_softeum_" + Date.now();
  const emailLines = [
    `From: ${remetente}`,
    `To: ${destinatario}`,
    `Subject: =?UTF-8?B?${btoa(unescape(encodeURIComponent(assunto)))}?=`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/html; charset=UTF-8`,
    `Content-Transfer-Encoding: base64`,
    ``,
    btoa(unescape(encodeURIComponent(html))),
    `--${boundary}--`,
  ];
  const emailRaw = emailLines.join("\r\n");
  const emailBase64 = btoa(emailRaw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  return await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ raw: emailBase64 }),
  });
}

async function criarNotificacaoPainel(tenantId: string, serviceRole: string): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/notificacoes_painel`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: serviceRole,
      Authorization: `Bearer ${serviceRole}`,
    },
    body: JSON.stringify({
      tenant_id: tenantId,
      tipo: "gmail_desconectado",
      titulo: "Gmail desconectado",
      mensagem: "A integração do Gmail desconectou. Pedidos por e-mail não serão processados até a reconexão. Acesse Configurações → Integração Gmail → Conectar Gmail.",
    }),
  });
  if (!res.ok) {
    console.error("Falha ao criar notificação de painel:", await res.text());
  }
}

function gerarEmail(nomeTenant: string): { assunto: string; html: string } {
  const assunto = "⚠️ Gmail desconectado no Softeum — ação necessária";
  const link = `${APP_URL}/configuracoes`;
  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>Gmail desconectado</title>
</head>
<body style="margin:0;padding:0;background-color:#f0f2f5;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f0f2f5;padding:30px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:linear-gradient(135deg,#1a1a2e,#16213e);padding:32px 40px;text-align:center;">
            <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">Softeum</h1>
            <p style="margin:6px 0 0;color:#90A4AE;font-size:13px;">Alerta do sistema</p>
          </td>
        </tr>
        <tr>
          <td style="padding:32px 40px 12px;">
            <div style="border-left:4px solid #F44336;padding:16px 20px;background:#fff5f5;border-radius:0 8px 8px 0;">
              <p style="margin:0;font-size:20px;font-weight:700;color:#263238;">⚠️ Gmail desconectado</p>
              <p style="margin:8px 0 0;font-size:14px;color:#546E7A;line-height:1.6;">
                A conexão da conta Gmail vinculada a <strong>${nomeTenant}</strong> caiu e o Softeum não conseguiu renová-la automaticamente.
              </p>
            </div>
          </td>
        </tr>
        <tr>
          <td style="padding:8px 40px 16px;font-size:14px;color:#37474F;line-height:1.6;">
            <p style="margin:16px 0 8px;"><strong>Impacto:</strong> novos pedidos enviados por e-mail <u>não serão processados</u> até a reconexão.</p>
            <p style="margin:16px 0 8px;"><strong>O que fazer:</strong></p>
            <ol style="margin:0 0 16px;padding-left:20px;">
              <li>Acesse o painel do Softeum.</li>
              <li>Vá em <strong>Configurações → Integração Gmail</strong>.</li>
              <li>Clique em <strong>Reconectar Gmail</strong> e autorize novamente.</li>
            </ol>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:0 40px 30px;">
            <a href="${link}" style="display:inline-block;background:#1a1a2e;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 28px;border-radius:8px;">
              Abrir Configurações
            </a>
          </td>
        </tr>
        <tr>
          <td style="background:#ECEFF1;padding:16px 40px;text-align:center;border-top:1px solid #e0e0e0;">
            <p style="margin:0;font-size:12px;color:#78909C;">Este é um e-mail automático enviado pelo Softeum. Não é necessário responder.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  return { assunto, html };
}
