const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = "https://arihejdirnhmcwuhkzde.supabase.co";

const STATUS_MENSAGENS: Record<string, { assunto: string; corpo: string }> = {
  pendente: {
    assunto: "Pedido recebido e em análise",
    corpo: `Prezado cliente,

Seu pedido foi recebido com sucesso e está sendo analisado por nossa equipe.

Em breve você receberá uma confirmação.

Atenciosamente,
Equipe de Vendas`,
  },
  aprovado: {
    assunto: "Pedido aprovado!",
    corpo: `Prezado cliente,

Temos o prazer de informar que seu pedido foi APROVADO.

Nossa equipe já está providenciando o processamento e você receberá mais informações em breve.

Atenciosamente,
Equipe de Vendas`,
  },
  reprovado: {
    assunto: "Pedido reprovado",
    corpo: `Prezado cliente,

Informamos que seu pedido não pôde ser aprovado no momento.

Entre em contato conosco para mais informações.

Atenciosamente,
Equipe de Vendas`,
  },
  duplicado: {
    assunto: "Pedido duplicado identificado",
    corpo: `Prezado cliente,

Identificamos que este pedido já foi recebido anteriormente pelo nosso sistema.

Caso tenha dúvidas, entre em contato conosco.

Atenciosamente,
Equipe de Vendas`,
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { pedido_id, status } = await req.json();

    if (!pedido_id || !status) {
      return new Response(JSON.stringify({ error: "pedido_id e status são obrigatórios" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const serviceRole = Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY");
    if (!serviceRole) {
      return new Response(JSON.stringify({ error: "Service role não configurado" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Buscar o pedido
    const pedidoRes = await fetch(
      `${SUPABASE_URL}/rest/v1/pedidos?id=eq.${pedido_id}&select=*`,
      { headers: { apikey: serviceRole, Authorization: `Bearer ${serviceRole}` } },
    );
    const pedidos = await pedidoRes.json();
    const pedido = pedidos[0];

    if (!pedido) {
      return new Response(JSON.stringify({ error: "Pedido não encontrado" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Buscar config do Gmail do tenant
    const configRes = await fetch(
      `${SUPABASE_URL}/rest/v1/tenant_gmail_config?tenant_id=eq.${pedido.tenant_id}&select=*`,
      { headers: { apikey: serviceRole, Authorization: `Bearer ${serviceRole}` } },
    );
    const configs = await configRes.json();
    const config = configs[0];

    if (!config || !config.access_token) {
      return new Response(JSON.stringify({ error: "Gmail não configurado para este tenant" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Renovar token se necessário
    let accessToken = config.access_token;
    const expiresAt = new Date(config.token_expires_at).getTime();
    if (Date.now() > expiresAt - 5 * 60 * 1000) {
      const clientId = Deno.env.get("GMAIL_CLIENT_ID");
      const clientSecret = Deno.env.get("GMAIL_CLIENT_SECRET");
      const refreshRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: config.refresh_token,
          client_id: clientId!,
          client_secret: clientSecret!,
        }),
      });
      const refreshJson = await refreshRes.json();
      if (refreshRes.ok) {
        accessToken = refreshJson.access_token;
        const novaExpiracao = new Date(Date.now() + (refreshJson.expires_in ?? 3600) * 1000).toISOString();
        await fetch(`${SUPABASE_URL}/rest/v1/tenant_gmail_config?tenant_id=eq.${pedido.tenant_id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", apikey: serviceRole, Authorization: `Bearer ${serviceRole}` },
          body: JSON.stringify({ access_token: accessToken, token_expires_at: novaExpiracao }),
        });
      }
    }

    const mensagem = STATUS_MENSAGENS[status] ?? STATUS_MENSAGENS.pendente;
    const destinatario = pedido.remetente_email;
    const numerosPedido = pedido.numero_pedido_cliente ? `Pedido Nº ${pedido.numero_pedido_cliente}` : "Pedido";

    const assunto = `${mensagem.assunto} - ${numerosPedido}`;
    const corpo = `${mensagem.corpo}

---
${numerosPedido}
Empresa: ${pedido.empresa ?? ""}
Data: ${pedido.data_emissao ?? new Date().toLocaleDateString("pt-BR")}`;

    // Montar o e-mail em formato RFC 2822
    const emailLines = [
      `To: ${destinatario}`,
      `Subject: =?UTF-8?B?${btoa(unescape(encodeURIComponent(assunto)))}?=`,
      `Content-Type: text/plain; charset=UTF-8`,
      `Content-Transfer-Encoding: base64`,
      ``,
      btoa(unescape(encodeURIComponent(corpo))),
    ];
    const emailRaw = emailLines.join("\r\n");
    const emailBase64 = btoa(emailRaw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

    // Enviar via Gmail API
    const sendRes = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ raw: emailBase64 }),
      },
    );

    const sendJson = await sendRes.json();
    console.log("Gmail send status:", sendRes.status, JSON.stringify(sendJson).substring(0, 200));

    if (!sendRes.ok) {
      return new Response(JSON.stringify({ error: "Falha ao enviar e-mail", details: sendJson }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Atualizar status do pedido
    await fetch(`${SUPABASE_URL}/rest/v1/pedidos?id=eq.${pedido_id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", apikey: serviceRole, Authorization: `Bearer ${serviceRole}` },
      body: JSON.stringify({ status }),
    });

    return new Response(JSON.stringify({ success: true, message_id: sendJson.id }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error("Erro:", (e as Error).message);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
