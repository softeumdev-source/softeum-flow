// Edge Function: processar-email-pdf
// Busca e-mails não lidos com PDF no Gmail e processa com Claude API

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = "https://arihejdirnhmcwuhkzde.supabase.co";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const serviceRole = Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY");
    const claudeKey = Deno.env.get("ANTHROPIC_API_KEY");

    if (!serviceRole || !claudeKey) {
      return new Response(
        JSON.stringify({ error: "Secrets não configurados" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Buscar todos os tenants com Gmail ativo
    const configRes = await fetch(
      `${SUPABASE_URL}/rest/v1/tenant_gmail_config?ativo=eq.true&select=*`,
      {
        headers: {
          apikey: serviceRole,
          Authorization: `Bearer ${serviceRole}`,
        },
      },
    );

    const configs = await configRes.json();

    if (!Array.isArray(configs) || configs.length === 0) {
      return new Response(
        JSON.stringify({ message: "Nenhum tenant com Gmail ativo" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const resultados = [];

    for (const config of configs) {
      try {
        const resultado = await processarTenant(config, serviceRole, claudeKey);
        resultados.push({ tenant_id: config.tenant_id, ...resultado });
      } catch (e) {
        resultados.push({ tenant_id: config.tenant_id, erro: (e as Error).message });
      }
    }

    return new Response(
      JSON.stringify({ processados: resultados }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

async function processarTenant(config: any, serviceRole: string, claudeKey: string) {
  const accessToken = await getAccessToken(config, serviceRole);

  // Buscar e-mails não lidos com PDF
  const query = encodeURIComponent(`is:unread has:attachment filename:pdf`);
  const listRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${query}&maxResults=10`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );

  const listJson = await listRes.json();
  const messages = listJson.messages ?? [];

  if (messages.length === 0) {
    return { emails_processados: 0 };
  }

  let processados = 0;

  for (const msg of messages) {
    try {
      await processarEmail(msg.id, accessToken, config, serviceRole, claudeKey);
      processados++;
    } catch (e) {
      console.error(`Erro no email ${msg.id}:`, e);
    }
  }

  return { emails_processados: processados };
}

async function getAccessToken(config: any, serviceRole: string): Promise<string> {
  const expiresAt = new Date(config.token_expires_at).getTime();
  const agora = Date.now();

  // Se o token ainda é válido (com margem de 5 min), usa direto
  if (expiresAt - agora > 5 * 60 * 1000) {
    return config.access_token;
  }

  // Refresh do token
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

  if (!refreshRes.ok) {
    throw new Error(`Falha ao renovar token: ${refreshJson.error}`);
  }

  const novoToken = refreshJson.access_token;
  const novaExpiracao = new Date(Date.now() + (refreshJson.expires_in ?? 3600) * 1000).toISOString();

  // Atualizar token no banco
  await fetch(
    `${SUPABASE_URL}/rest/v1/tenant_gmail_config?tenant_id=eq.${config.tenant_id}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceRole,
        Authorization: `Bearer ${serviceRole}`,
      },
      body: JSON.stringify({ access_token: novoToken, token_expires_at: novaExpiracao }),
    },
  );

  return novoToken;
}

async function processarEmail(
  messageId: string,
  accessToken: string,
  config: any,
  serviceRole: string,
  claudeKey: string,
) {
  // Verificar se já foi processado
  const jaProcessado = await fetch(
    `${SUPABASE_URL}/rest/v1/pedidos?gmail_message_id=eq.${messageId}&select=id`,
    {
      headers: { apikey: serviceRole, Authorization: `Bearer ${serviceRole}` },
    },
  );
  const jaProcessadoJson = await jaProcessado.json();
  if (jaProcessadoJson.length > 0) return;

  // Buscar o e-mail completo
  const emailRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const email = await emailRes.json();

  // Extrair assunto e remetente
  const headers = email.payload?.headers ?? [];
  const assunto = headers.find((h: any) => h.name === "Subject")?.value ?? "";
  const de = headers.find((h: any) => h.name === "From")?.value ?? "";

  // Encontrar anexos PDF
  const partes = email.payload?.parts ?? [];
  const pdfs = partes.filter(
    (p: any) => p.mimeType === "application/pdf" || p.filename?.endsWith(".pdf"),
  );

  if (pdfs.length === 0) return;

  for (const pdf of pdfs) {
    const attachmentId = pdf.body?.attachmentId;
    if (!attachmentId) continue;

    // Baixar o PDF
    const attachRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/attachments/${attachmentId}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const attachJson = await attachRes.json();
    const pdfBase64 = attachJson.data?.replace(/-/g, "+").replace(/_/g, "/");

    if (!pdfBase64) continue;

    // Enviar para Claude API
    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": claudeKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-opus-4-5",
        max_tokens: 4096,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "document",
                source: {
                  type: "base64",
                  media_type: "application/pdf",
                  data: pdfBase64,
                },
              },
              {
                type: "text",
                text: `Analise este pedido em PDF e extraia as informações em JSON com o seguinte formato:
{
  "numero_pedido": "string",
  "empresa_cliente": "string",
  "data_pedido": "YYYY-MM-DD ou null",
  "observacoes": "string ou null",
  "confianca": 0.0 a 1.0,
  "itens": [
    {
      "codigo_cliente": "string",
      "descricao": "string",
      "quantidade": number,
      "unidade_medida": "string",
      "preco_unitario": number ou null,
      "preco_total": number ou null
    }
  ]
}
Responda APENAS com o JSON, sem explicações.`,
              },
            ],
          },
        ],
      }),
    });

    const claudeJson = await claudeRes.json();
    const textoResposta = claudeJson.content?.[0]?.text ?? "{}";

    let dadosPedido: any = {};
    try {
      const limpo = textoResposta.replace(/```json|```/g, "").trim();
      dadosPedido = JSON.parse(limpo);
    } catch {
      dadosPedido = { confianca: 0, itens: [] };
    }

    // Salvar pedido no banco
    const pedidoRes = await fetch(
      `${SUPABASE_URL}/rest/v1/pedidos`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: serviceRole,
          Authorization: `Bearer ${serviceRole}`,
          Prefer: "return=representation",
        },
        body: JSON.stringify({
          tenant_id: config.tenant_id,
          gmail_message_id: messageId,
          numero_pedido: dadosPedido.numero_pedido ?? null,
          empresa_cliente: dadosPedido.empresa_cliente ?? de,
          data_pedido: dadosPedido.data_pedido ?? null,
          observacoes: dadosPedido.observacoes ?? null,
          confianca_ia: dadosPedido.confianca ?? 0,
          status: "pendente",
          assunto_email: assunto,
          remetente_email: de,
        }),
      },
    );

    const pedidoJson = await pedidoRes.json();
    const pedidoId = pedidoJson[0]?.id;

    if (!pedidoId) continue;

    // Salvar itens do pedido
    const itens = dadosPedido.itens ?? [];
    if (itens.length > 0) {
      await fetch(
        `${SUPABASE_URL}/rest/v1/pedido_itens`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: serviceRole,
            Authorization: `Bearer ${serviceRole}`,
          },
          body: JSON.stringify(
            itens.map((item: any) => ({
              pedido_id: pedidoId,
              tenant_id: config.tenant_id,
              codigo_cliente: item.codigo_cliente ?? null,
              descricao: item.descricao ?? null,
              quantidade: item.quantidade ?? 0,
              unidade_medida: item.unidade_medida ?? null,
              preco_unitario: item.preco_unitario ?? null,
              preco_total: item.preco_total ?? null,
            })),
          ),
        },
      );
    }

    // Marcar e-mail como lido
    await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/modify`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ removeLabelIds: ["UNREAD"] }),
      },
    );
  }
}

