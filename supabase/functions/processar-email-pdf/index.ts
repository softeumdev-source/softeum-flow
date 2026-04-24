const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = "https://arihejdirnhmcwuhkzde.supabase.co";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const serviceRole = Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY");
    const claudeKey = Deno.env.get("ANTHROPIC_API_KEY");

    console.log("Secrets:", { temServiceRole: !!serviceRole, temClaudeKey: !!claudeKey });

    if (!serviceRole || !claudeKey) {
      return new Response(JSON.stringify({ error: "Secrets não configurados" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const configRes = await fetch(
      `${SUPABASE_URL}/rest/v1/tenant_gmail_config?ativo=eq.true&select=*`,
      { headers: { apikey: serviceRole, Authorization: `Bearer ${serviceRole}` } },
    );
    const configs = await configRes.json();
    console.log("Configs encontradas:", configs.length);

    if (!Array.isArray(configs) || configs.length === 0) {
      return new Response(JSON.stringify({ message: "Nenhum tenant com Gmail ativo" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const resultados = [];
    for (const config of configs) {
      try {
        const resultado = await processarTenant(config, serviceRole, claudeKey);
        resultados.push({ tenant_id: config.tenant_id, ...resultado });
      } catch (e) {
        console.error("Erro no tenant:", config.tenant_id, (e as Error).message);
        resultados.push({ tenant_id: config.tenant_id, erro: (e as Error).message });
      }
    }

    return new Response(JSON.stringify({ processados: resultados }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("Erro geral:", (e as Error).message);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function processarTenant(config: any, serviceRole: string, claudeKey: string) {
  const accessToken = await getAccessToken(config, serviceRole);
  console.log("Access token obtido para tenant:", config.tenant_id);

  const query = encodeURIComponent(`is:unread has:attachment filename:pdf`);
  const listRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${query}&maxResults=3`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const listJson = await listRes.json();
  const messages = listJson.messages ?? [];
  console.log("E-mails encontrados:", messages.length);

  let processados = 0;
  for (const msg of messages) {
    try {
      await processarEmail(msg.id, accessToken, config, serviceRole, claudeKey);
      processados++;
    } catch (e) {
      console.error(`Erro no email ${msg.id}:`, (e as Error).message);
    }
  }
  return { emails_processados: processados };
}

async function getAccessToken(config: any, serviceRole: string): Promise<string> {
  const expiresAt = new Date(config.token_expires_at).getTime();
  const agora = Date.now();

  if (expiresAt - agora > 5 * 60 * 1000) {
    return config.access_token;
  }

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
  if (!refreshRes.ok) throw new Error(`Falha ao renovar token: ${refreshJson.error}`);

  const novoToken = refreshJson.access_token;
  const novaExpiracao = new Date(Date.now() + (refreshJson.expires_in ?? 3600) * 1000).toISOString();

  await fetch(`${SUPABASE_URL}/rest/v1/tenant_gmail_config?tenant_id=eq.${config.tenant_id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", apikey: serviceRole, Authorization: `Bearer ${serviceRole}` },
    body: JSON.stringify({ access_token: novoToken, token_expires_at: novaExpiracao }),
  });

  return novoToken;
}

async function enviarNotificacao(pedidoId: string, status: string, serviceRole: string) {
  try {
    console.log("Enviando notificação para pedido:", pedidoId, "status:", status);
    const res = await fetch(
      `${SUPABASE_URL}/functions/v1/enviar-notificacao-email`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceRole}`,
        },
        body: JSON.stringify({ pedido_id: pedidoId, status }),
      },
    );
    const json = await res.json();
    console.log("Notificação enviada:", res.status, JSON.stringify(json).substring(0, 100));
  } catch (e) {
    console.error("Erro ao enviar notificação:", (e as Error).message);
  }
}

async function processarEmail(messageId: string, accessToken: string, config: any, serviceRole: string, claudeKey: string) {
  const jaProcessado = await fetch(
    `${SUPABASE_URL}/rest/v1/pedidos?gmail_message_id=eq.${messageId}&select=id`,
    { headers: { apikey: serviceRole, Authorization: `Bearer ${serviceRole}` } },
  );
  const jaProcessadoJson = await jaProcessado.json();
  if (jaProcessadoJson.length > 0) {
    console.log("Email já processado:", messageId);
    return;
  }

  const emailRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const email = await emailRes.json();

  const headers = email.payload?.headers ?? [];
  const assunto = headers.find((h: any) => h.name === "Subject")?.value ?? "";
  const de = headers.find((h: any) => h.name === "From")?.value ?? "";
  console.log("Processando email:", assunto, "de:", de);

  const partes = email.payload?.parts ?? [];
  const pdfs = partes.filter((p: any) => p.mimeType === "application/pdf" || p.filename?.endsWith(".pdf"));
  console.log("PDFs encontrados:", pdfs.length);

  if (pdfs.length === 0) return;

  for (const pdf of pdfs) {
    const attachmentId = pdf.body?.attachmentId;
    if (!attachmentId) continue;

    console.log("Baixando PDF:", pdf.filename);
    const attachRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/attachments/${attachmentId}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const attachJson = await attachRes.json();
    const pdfBase64 = attachJson.data?.replace(/-/g, "+").replace(/_/g, "/");
    if (!pdfBase64) { console.log("PDF base64 vazio"); continue; }

    console.log("Chamando Claude API...");
    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": claudeKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 2048,
        messages: [{
          role: "user",
          content: [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfBase64 } },
            { type: "text", text: `Analise este pedido em PDF e extraia as informações em JSON:
{
  "numero_pedido": "string",
  "empresa_cliente": "string",
  "data_pedido": "YYYY-MM-DD ou null",
  "observacoes": "string ou null",
  "confianca": 0.0 a 1.0,
  "itens": [{"codigo_cliente": "string", "descricao": "string", "quantidade": number, "unidade_medida": "string", "preco_unitario": number, "preco_total": number}]
}
Responda APENAS com o JSON.` },
          ],
        }],
      }),
    });

    console.log("Claude status:", claudeRes.status);
    const claudeJson = await claudeRes.json();
    console.log("Claude resposta:", JSON.stringify(claudeJson).substring(0, 200));

    const textoResposta = claudeJson.content?.[0]?.text ?? "{}";
    let dadosPedido: any = {};
    try {
      dadosPedido = JSON.parse(textoResposta.replace(/```json|```/g, "").trim());
    } catch (e) {
      console.error("Erro ao parsear JSON da Claude:", e);
    }

    console.log("Dados extraídos:", JSON.stringify(dadosPedido).substring(0, 300));

    const pedidoBody = {
      tenant_id: config.tenant_id,
      gmail_message_id: messageId,
      numero_pedido_cliente: dadosPedido.numero_pedido ?? null,
      empresa: dadosPedido.empresa_cliente ?? de,
      data_emissao: dadosPedido.data_pedido ?? null,
      observacoes_gerais: dadosPedido.observacoes ?? null,
      confianca_ia: dadosPedido.confianca ?? 0,
      status: "pendente",
      assunto_email: assunto,
      remetente_email: de,
      canal_entrada: "email",
      json_ia_bruto: JSON.stringify(dadosPedido),
    };

    const pedidoRes = await fetch(`${SUPABASE_URL}/rest/v1/pedidos`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceRole,
        Authorization: `Bearer ${serviceRole}`,
        Prefer: "return=representation",
      },
      body: JSON.stringify(pedidoBody),
    });

    console.log("Pedido response status:", pedidoRes.status);
    const pedidoJson = await pedidoRes.json();
    console.log("Pedido response body:", JSON.stringify(pedidoJson).substring(0, 300));

    const pedidoId = pedidoJson[0]?.id;
    if (!pedidoId) { console.error("Pedido não salvo!"); continue; }

    console.log("Pedido salvo:", pedidoId);

    const itens = dadosPedido.itens ?? [];
    console.log("Itens para salvar:", itens.length);
    if (itens.length > 0) {
      await fetch(`${SUPABASE_URL}/rest/v1/pedido_itens`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: serviceRole, Authorization: `Bearer ${serviceRole}` },
        body: JSON.stringify(itens.map((item: any) => ({
          pedido_id: pedidoId,
          tenant_id: config.tenant_id,
          codigo_cliente: item.codigo_cliente ?? null,
          descricao: item.descricao ?? null,
          quantidade: item.quantidade ?? 0,
          unidade_medida: item.unidade_medida ?? null,
          preco_unitario: item.preco_unitario ?? null,
          preco_total: item.preco_total ?? null,
        }))),
      });
    }

    // Enviar notificação automática para o cliente
    await enviarNotificacao(pedidoId, "pendente", serviceRole);

    await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/modify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ removeLabelIds: ["UNREAD"] }),
    });

    console.log("Email processado com sucesso!");
  }
}
