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
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function processarTenant(config: any, serviceRole: string, claudeKey: string) {
  const accessToken = await getAccessToken(config, serviceRole);

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

async function chamarFuncao(nome: string, body: any, serviceRole: string) {
  try {
    console.log(`Chamando ${nome}...`);
    const res = await fetch(
      `${SUPABASE_URL}/functions/v1/${nome}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceRole}`,
        },
        body: JSON.stringify(body),
      },
    );
    const json = await res.json();
    console.log(`${nome} respondeu:`, res.status, JSON.stringify(json).substring(0, 150));
    return json;
  } catch (e) {
    console.error(`Erro ao chamar ${nome}:`, (e as Error).message);
  }
}

async function salvarPdfNoStorage(pdfBase64: string, filename: string, tenantId: string, serviceRole: string): Promise<string | null> {
  try {
    const binaryString = atob(pdfBase64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: "application/pdf" });

    const path = `${tenantId}/${Date.now()}_${filename}`;
    const uploadRes = await fetch(
      `${SUPABASE_URL}/storage/v1/object/pedidos-pdf/${path}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/pdf",
          apikey: serviceRole,
          Authorization: `Bearer ${serviceRole}`,
        },
        body: blob,
      },
    );

    if (!uploadRes.ok) {
      console.error("Erro ao salvar PDF no storage:", await uploadRes.text());
      return null;
    }

    return `${SUPABASE_URL}/storage/v1/object/public/pedidos-pdf/${path}`;
  } catch (e) {
    console.error("Erro ao salvar PDF:", (e as Error).message);
    return null;
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
  const emailRemetente = de.match(/<(.+)>/)?.[1] ?? de;
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
    if (!pdfBase64) continue;

    // Salvar PDF no storage
    const pdfUrl = await salvarPdfNoStorage(pdfBase64, pdf.filename ?? "pedido.pdf", config.tenant_id, serviceRole);
    console.log("PDF salvo no storage:", pdfUrl);

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
        max_tokens: 4096,
        messages: [{
          role: "user",
          content: [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfBase64 } },
            { type: "text", text: `Você é um especialista em análise de pedidos comerciais. Analise este pedido em PDF e extraia TODAS as informações disponíveis no documento.

Retorne APENAS um JSON válido com esta estrutura (use null para campos não encontrados):
{
  "numero_pedido": "número do pedido",
  "empresa_cliente": "nome da empresa que fez o pedido",
  "cnpj": "CNPJ da empresa (somente números ou formatado)",
  "email_remetente": "email de quem enviou o pedido",
  "nome_comprador": "nome do comprador/representante",
  "email_comprador": "email do comprador",
  "telefone_comprador": "telefone do comprador",
  "data_emissao": "data de emissão no formato YYYY-MM-DD ou null",
  "data_entrega_solicitada": "data de entrega solicitada no formato YYYY-MM-DD ou null",
  "condicao_pagamento": "condição de pagamento (ex: 30/60/90, à vista)",
  "tipo_frete": "tipo de frete (CIF, FOB, etc)",
  "endereco_entrega": "endereço completo de entrega",
  "cidade_entrega": "cidade de entrega",
  "estado_entrega": "UF do estado de entrega",
  "cep_entrega": "CEP de entrega",
  "observacoes": "observações gerais do pedido",
  "valor_total": número total do pedido ou null,
  "confianca": número entre 0.0 e 1.0 indicando sua confiança na extração,
  "itens": [
    {
      "numero_item": número sequencial do item,
      "codigo_cliente": "código do produto usado pelo cliente",
      "descricao": "descrição completa do produto",
      "referencia": "referência ou código de barras se houver",
      "marca": "marca do produto se informada",
      "unidade_medida": "unidade (UN, CX, KG, PC, etc)",
      "quantidade": número da quantidade,
      "preco_unitario": número do preço unitário ou null,
      "preco_total": número do total do item ou null,
      "desconto": número do desconto percentual ou null,
      "observacao_item": "observação específica do item ou null"
    }
  ]
}

Responda APENAS com o JSON, sem explicações, sem markdown.` },
          ],
        }],
      }),
    });

    console.log("Claude status:", claudeRes.status);
    const claudeJson = await claudeRes.json();
    const textoResposta = claudeJson.content?.[0]?.text ?? "{}";

    let dadosPedido: any = {};
    try {
      dadosPedido = JSON.parse(textoResposta.replace(/```json|```/g, "").trim());
    } catch (e) {
      console.error("Erro ao parsear JSON da Claude:", e);
    }

    const pedidoRes = await fetch(`${SUPABASE_URL}/rest/v1/pedidos`, {
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
        numero_pedido_cliente: dadosPedido.numero_pedido ?? null,
        empresa: dadosPedido.empresa_cliente ?? emailRemetente,
        cnpj: dadosPedido.cnpj ?? null,
        email_remetente: dadosPedido.email_remetente ?? emailRemetente,
        nome_comprador: dadosPedido.nome_comprador ?? null,
        email_comprador: dadosPedido.email_comprador ?? null,
        telefone_comprador: dadosPedido.telefone_comprador ?? null,
        data_emissao: dadosPedido.data_emissao ?? null,
        data_entrega_solicitada: dadosPedido.data_entrega_solicitada ?? null,
        condicao_pagamento: dadosPedido.condicao_pagamento ?? null,
        tipo_frete: dadosPedido.tipo_frete ?? null,
        endereco_entrega: dadosPedido.endereco_entrega ?? null,
        cidade_entrega: dadosPedido.cidade_entrega ?? null,
        estado_entrega: dadosPedido.estado_entrega ?? null,
        cep_entrega: dadosPedido.cep_entrega ?? null,
        observacoes_gerais: dadosPedido.observacoes ?? null,
        valor_total: dadosPedido.valor_total ?? null,
        confianca_ia: dadosPedido.confianca ?? 0,
        status: "pendente",
        assunto_email: assunto,
        remetente_email: emailRemetente,
        canal_entrada: "email",
        pdf_url: pdfUrl,
        json_ia_bruto: JSON.stringify(dadosPedido),
      }),
    });

    const pedidoJson = await pedidoRes.json();
    const pedidoId = pedidoJson[0]?.id;
    if (!pedidoId) { console.error("Pedido não salvo!"); continue; }
    console.log("Pedido salvo:", pedidoId);

    const itens = dadosPedido.itens ?? [];
    if (itens.length > 0) {
      await fetch(`${SUPABASE_URL}/rest/v1/pedido_itens`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: serviceRole, Authorization: `Bearer ${serviceRole}` },
        body: JSON.stringify(itens.map((item: any, idx: number) => ({
          pedido_id: pedidoId,
          tenant_id: config.tenant_id,
          numero_item: item.numero_item ?? idx + 1,
          codigo_cliente: item.codigo_cliente ?? null,
          descricao: item.descricao ?? null,
          referencia: item.referencia ?? null,
          marca: item.marca ?? null,
          quantidade: item.quantidade ?? 0,
          unidade_medida: item.unidade_medida ?? null,
          preco_unitario: item.preco_unitario ?? null,
          preco_total: item.preco_total ?? null,
          desconto: item.desconto ?? null,
          observacao_item: item.observacao_item ?? null,
        }))),
      });
    }

    await chamarFuncao("mapear-codigos-ia", { pedido_id: pedidoId }, serviceRole);
    await chamarFuncao("enviar-notificacao-email", { pedido_id: pedidoId, status: "pendente" }, serviceRole);

    await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/modify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ removeLabelIds: ["UNREAD"] }),
    });

    console.log("Email processado com sucesso!");
  }
}
