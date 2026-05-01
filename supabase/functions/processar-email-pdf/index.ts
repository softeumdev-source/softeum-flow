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
        await registrarErro("edge_function_error", "processar-email-pdf", (e as Error).message, {
          tenant_id: config.tenant_id,
          severidade: "alta",
          detalhes: { stack: (e as Error).stack },
        });
        resultados.push({ tenant_id: config.tenant_id, erro: (e as Error).message });
      }
    }

    return new Response(JSON.stringify({ processados: resultados }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    await registrarErro("edge_function_error", "processar-email-pdf", (e as Error).message, {
      severidade: "critica",
      detalhes: { stack: (e as Error).stack },
    });
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function registrarErro(
  tipo: string,
  origem: string,
  mensagem: string,
  opts: { detalhes?: any; tenant_id?: string | null; severidade?: "baixa" | "media" | "alta" | "critica" } = {},
): Promise<void> {
  try {
    const sr = Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY");
    if (!sr) return;
    await fetch(`${SUPABASE_URL}/functions/v1/registrar-erro`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${sr}` },
      body: JSON.stringify({ tipo, origem, mensagem, ...opts }),
    });
  } catch {
    // best-effort
  }
}

async function processarTenant(config: any, serviceRole: string, claudeKey: string) {
  const accessToken = await getAccessToken(config, serviceRole);
  const query = encodeURIComponent(`is:unread has:attachment filename:pdf`);
  const listRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${query}&maxResults=50`,
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
      await registrarErro("edge_function_error", "processar-email-pdf", `Erro no email ${msg.id}: ${(e as Error).message}`, {
        tenant_id: config.tenant_id,
        severidade: "media",
        detalhes: { gmail_message_id: msg.id, stack: (e as Error).stack },
      });
    }
  }
  return { emails_processados: processados };
}

async function getAccessToken(config: any, serviceRole: string): Promise<string> {
  const expiresAt = new Date(config.token_expires_at).getTime();
  const agora = Date.now();
  if (expiresAt - agora > 5 * 60 * 1000) return config.access_token;

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
    console.error(`Falha ao renovar token Gmail do tenant ${config.tenant_id}:`, refreshJson);
    await marcarGmailDesconectado(config, serviceRole);
    throw new Error(`Falha ao renovar token: ${refreshJson.error}`);
  }

  const novoToken = refreshJson.access_token;
  const novaExpiracao = new Date(Date.now() + (refreshJson.expires_in ?? 3600) * 1000).toISOString();

  await fetch(`${SUPABASE_URL}/rest/v1/tenant_gmail_config?tenant_id=eq.${config.tenant_id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", apikey: serviceRole, Authorization: `Bearer ${serviceRole}` },
    body: JSON.stringify({ access_token: novoToken, token_expires_at: novaExpiracao }),
  });

  return novoToken;
}

async function marcarGmailDesconectado(config: any, serviceRole: string) {
  const jaAlertado = !!config.alerta_desconexao_enviado;
  const patchBody: Record<string, any> = { ativo: false };
  if (!jaAlertado) patchBody.alerta_desconexao_enviado = true;

  const patchRes = await fetch(
    `${SUPABASE_URL}/rest/v1/tenant_gmail_config?tenant_id=eq.${config.tenant_id}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json", apikey: serviceRole, Authorization: `Bearer ${serviceRole}` },
      body: JSON.stringify(patchBody),
    },
  );
  if (!patchRes.ok) {
    console.error("Falha ao marcar Gmail como desconectado:", await patchRes.text());
  }

  if (!jaAlertado) {
    await chamarFuncao("enviar-alerta-gmail-desconectado", { tenant_id: config.tenant_id }, serviceRole);
  }
}

async function chamarFuncao(nome: string, body: any, serviceRole: string) {
  try {
    console.log(`Chamando ${nome}...`);
    const res = await fetch(`${SUPABASE_URL}/functions/v1/${nome}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceRole}` },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    console.log(`${nome} respondeu:`, res.status, JSON.stringify(json).substring(0, 150));
    return json;
  } catch (e) {
    console.error(`Erro ao chamar ${nome}:`, (e as Error).message);
  }
}

async function lerConfigBoolean(
  tenantId: string, chave: string, fallback: boolean, serviceRole: string,
): Promise<boolean> {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/configuracoes?tenant_id=eq.${tenantId}&chave=eq.${encodeURIComponent(chave)}&select=valor&limit=1`,
      { headers: { apikey: serviceRole, Authorization: `Bearer ${serviceRole}` } },
    );
    if (!res.ok) return fallback;
    const rows = await res.json();
    const valor = rows?.[0]?.valor;
    if (valor === undefined || valor === null) return fallback;
    return String(valor).toLowerCase() === "true";
  } catch {
    return fallback;
  }
}

async function calcularPdfHash(pdfBase64: string): Promise<string | null> {
  try {
    const binaryString = atob(pdfBase64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
    const buffer = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(buffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch (e) {
    console.error("Falha ao calcular pdf_hash:", (e as Error).message);
    return null;
  }
}

async function salvarPdfNoStorage(pdfBase64: string, filename: string, tenantId: string, serviceRole: string): Promise<string | null> {
  try {
    const binaryString = atob(pdfBase64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
    const blob = new Blob([bytes], { type: "application/pdf" });
    const path = `${tenantId}/${Date.now()}_${filename}`;

    const uploadRes = await fetch(`${SUPABASE_URL}/storage/v1/object/pedidos-pdf/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/pdf", apikey: serviceRole, Authorization: `Bearer ${serviceRole}` },
      body: blob,
    });

    if (!uploadRes.ok) { console.error("Erro ao salvar PDF:", await uploadRes.text()); return null; }
    return `${SUPABASE_URL}/storage/v1/object/public/pedidos-pdf/${path}`;
  } catch (e) {
    console.error("Erro ao salvar PDF:", (e as Error).message);
    return null;
  }
}

/**
 * Resolve qual e-mail receberá a notificação de status. Regra de
 * negócio: SEMPRE o varejo original que enviou o pedido — independente
 * de quantos intermediários (indústria, redirecionamento, gateway)
 * passou no caminho.
 *
 * Cadeia de prioridade (1 = mais confiável):
 *   1. From: — em filter forward do Gmail e redirect rule do Outlook
 *      (cenário programado mais comum) o From: original é preservado.
 *   2. X-Original-From / X-Forwarded-From / X-Original-Sender —
 *      cobre o caso raro do Google Workspace routing rule reescrever
 *      o From: e mover o original pra X-Original-From.
 *   3. Resent-From / Resent-Sender — RFC define como "quem reenviou",
 *      ou seja, é o INTERMEDIÁRIO. Só useful como fallback caso
 *      From: esteja ausente (forward "as attachment" agressivo).
 *   4. Reply-To: — geralmente igual a From: ou ao varejo, mas pode
 *      ser sobrescrito.
 *   5. e-mail extraído do corpo (regex, quando forward "as attachment"
 *      perdeu os headers).
 *   6. e-mail do PDF (IA) — só fallback final, porque o PDF carrega
 *      e-mail de contato administrativo (assistente, financeiro), não
 *      necessariamente do varejo que enviou.
 *
 * Retorna { email, fonte } pra observabilidade — fonte vai pra
 * pedidos.remetente_origem e ajuda diagnóstico futuro.
 */
function identificarVarejoOriginal(c: {
  xOriginal: string | null;
  resent: string | null;
  from: string | null;
  replyTo: string | null;
  body: string | null;
  iaCompradorEmail: string | null;
  iaRemetenteEmail: string | null;
}): { email: string; fonte: string } {
  if (c.from) return { email: c.from, fonte: "header_from" };
  if (c.xOriginal) return { email: c.xOriginal, fonte: "header_x_original" };
  if (c.resent) return { email: c.resent, fonte: "header_resent" };
  if (c.replyTo) return { email: c.replyTo, fonte: "header_reply_to" };
  if (c.body) return { email: c.body, fonte: "corpo_regex" };
  if (c.iaCompradorEmail) return { email: c.iaCompradorEmail, fonte: "ia_pdf_email_comprador" };
  if (c.iaRemetenteEmail) return { email: c.iaRemetenteEmail, fonte: "ia_pdf_email_remetente" };
  return { email: "", fonte: "nenhum" };
}

function extrairEmail(str: string): string {
  if (!str) return "";
  const match = str.match(/<([^>]+)>/);
  if (match) return match[1].trim().toLowerCase();
  const emailMatch = str.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
  if (emailMatch) return emailMatch[0].trim().toLowerCase();
  return str.trim().toLowerCase();
}

function isEncaminhado(assunto: string): boolean {
  return /^(fw|fwd|enc|res|rv|tr|encaminhado|reenvio):/i.test(assunto.trim());
}

function extrairEmailDoCorpo(corpo: string): string | null {
  if (!corpo) return null;
  const separadores = [
    /-----+\s*mensagem original\s*-----+/i,
    /-----+\s*original message\s*-----+/i,
    /-----+\s*forwarded message\s*-----+/i,
    /-----+\s*mensagem encaminhada\s*-----+/i,
    /_{3,}/,
  ];
  let corpoOriginal = corpo;
  for (const sep of separadores) {
    const match = corpo.match(sep);
    if (match && match.index !== undefined) { corpoOriginal = corpo.slice(match.index + match[0].length); break; }
  }
  const padroes = [
    /^\s*De:\s*[^<\n]*<([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})>/im,
    /^\s*From:\s*[^<\n]*<([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})>/im,
    /^\s*De:\s*([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/im,
    /^\s*From:\s*([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/im,
  ];
  for (const padrao of padroes) {
    const match = corpoOriginal.match(padrao);
    if (match) { console.log("Email original extraído do corpo:", match[1]); return match[1].trim().toLowerCase(); }
  }
  const todosEmails: string[] = [];
  const regexGlobal = /(?:De|From):\s*[^<\n]*<([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})>/gim;
  let m;
  while ((m = regexGlobal.exec(corpo)) !== null) todosEmails.push(m[1].trim().toLowerCase());
  if (todosEmails.length > 0) { console.log("Email original (último):", todosEmails[todosEmails.length - 1]); return todosEmails[todosEmails.length - 1]; }
  return null;
}

function coletarPdfs(payload: any): any[] {
  const encontrados: any[] = [];
  const vistos = new Set<string>();
  const visitar = (parte: any) => {
    if (!parte) return;
    const ehPdf = parte.mimeType === "application/pdf"
      || (typeof parte.filename === "string" && parte.filename.toLowerCase().endsWith(".pdf"));
    if (ehPdf && parte.body?.attachmentId && !vistos.has(parte.body.attachmentId)) {
      vistos.add(parte.body.attachmentId);
      encontrados.push(parte);
    }
    for (const sub of parte.parts ?? []) visitar(sub);
  };
  visitar(payload);
  return encontrados;
}

function decodificarBase64Gmail(data: string): string {
  const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
  try { return atob(base64); } catch { return ""; }
}

function extrairCorpoEmail(payload: any): string {
  if (!payload) return "";
  if (payload.body?.data) return decodificarBase64Gmail(payload.body.data);
  const partes = payload.parts ?? [];
  for (const parte of partes) {
    if (parte.mimeType === "text/plain" && parte.body?.data) return decodificarBase64Gmail(parte.body.data);
  }
  for (const parte of partes) {
    const subPartes = parte.parts ?? [];
    for (const sub of subPartes) {
      if (sub.mimeType === "text/plain" && sub.body?.data) return decodificarBase64Gmail(sub.body.data);
    }
  }
  for (const parte of partes) {
    if (parte.mimeType === "text/html" && parte.body?.data) {
      return decodificarBase64Gmail(parte.body.data).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    }
  }
  return "";
}

async function verificarDuplicado(
  opts: {
    numeroPedido?: string | null;
    cnpj?: string | null;
    pdfHash?: string | null;
    pedidoAtualId: string;
    tenantId: string;
  },
  serviceRole: string,
): Promise<boolean> {
  const { numeroPedido, cnpj, pdfHash, pedidoAtualId, tenantId } = opts;
  const headers = { apikey: serviceRole, Authorization: `Bearer ${serviceRole}` };

  // (A) Hash do PDF — só checa se temos hash gerado para o pedido atual.
  if (pdfHash) {
    const hashRes = await fetch(
      `${SUPABASE_URL}/rest/v1/pedidos?tenant_id=eq.${tenantId}&pdf_hash=eq.${encodeURIComponent(pdfHash)}&id=neq.${pedidoAtualId}&select=id&limit=1`,
      { headers },
    );
    if (hashRes.ok) {
      const rows = await hashRes.json();
      if (Array.isArray(rows) && rows.length > 0) return true;
    }
  }

  // (B) Número do pedido + CNPJ. Exige número não-vazio E cnpj não-vazio
  //     pra evitar falso positivo quando dois clientes diferentes mandam
  //     o mesmo "PED-001".
  if (numeroPedido && numeroPedido.trim() !== "" && cnpj && cnpj.trim() !== "") {
    const numCnpjRes = await fetch(
      `${SUPABASE_URL}/rest/v1/pedidos?tenant_id=eq.${tenantId}&numero_pedido_cliente=eq.${encodeURIComponent(numeroPedido)}&cnpj=eq.${encodeURIComponent(cnpj)}&id=neq.${pedidoAtualId}&select=id&limit=1`,
      { headers },
    );
    if (numCnpjRes.ok) {
      const rows = await numCnpjRes.json();
      if (Array.isArray(rows) && rows.length > 0) return true;
    }
  }

  return false;
}

async function processarEmail(messageId: string, accessToken: string, config: any, serviceRole: string, claudeKey: string) {
  const jaProcessado = await fetch(
    `${SUPABASE_URL}/rest/v1/pedidos?gmail_message_id=eq.${messageId}&select=id`,
    { headers: { apikey: serviceRole, Authorization: `Bearer ${serviceRole}` } },
  );
  const jaProcessadoJson = await jaProcessado.json();
  if (jaProcessadoJson.length > 0) { console.log("Email já processado:", messageId); return; }

  const emailRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const email = await emailRes.json();

  const headers = email.payload?.headers ?? [];
  const headerVal = (name: string): string =>
    (headers.find((h: any) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "") as string;

  const assunto = headerVal("Subject");
  const de = headerVal("From");
  const replyTo = headerVal("Reply-To");
  const xOriginalFrom =
    headerVal("X-Original-From") || headerVal("X-Forwarded-From") || headerVal("X-Original-Sender");
  const senderHeader = headerVal("Sender"); // M1
  const deliveredTo = headerVal("Delivered-To"); // M2
  const toHeader = headerVal("To");
  const resentFrom = headerVal("Resent-From");
  const resentSender = headerVal("Resent-Sender");
  const autoSubmitted = headerVal("Auto-Submitted");

  const emailFrom = extrairEmail(de);
  const emailReplyTo = replyTo ? extrairEmail(replyTo) : null;
  const emailXOriginal = xOriginalFrom ? extrairEmail(xOriginalFrom) : null;
  const emailResent = (resentFrom || resentSender) ? extrairEmail(resentFrom || resentSender) : null;
  const emailDelivered = deliveredTo ? extrairEmail(deliveredTo) : null;
  const emailTo = toHeader ? extrairEmail(toHeader) : null;

  // Detecção ampliada de forward — qualquer um dos sinais conta:
  // - prefixo "Fwd:"/"Enc:"/etc no assunto
  // - presença de header gerenciado de forward (X-Forwarded-*, X-Original-*)
  // - presença de header Resent-*
  // - Auto-Submitted: auto-forwarded
  // - Delivered-To diferente do To: (Workspace seta isso em forward por filtro)
  // - Sender: presente e diferente de From: (encaminhador autenticado)
  const senderDifere = !!senderHeader && extrairEmail(senderHeader) !== emailFrom;
  const deliveredDifere = !!emailDelivered && !!emailTo && emailDelivered !== emailTo;
  const encaminhado =
    isEncaminhado(assunto) ||
    !!xOriginalFrom ||
    !!resentFrom || !!resentSender ||
    /auto-?forwarded/i.test(autoSubmitted) ||
    deliveredDifere ||
    senderDifere;

  console.log("Email encaminhado:", encaminhado, "Assunto:", assunto, "Delivered≠To:", deliveredDifere, "Sender≠From:", senderDifere);

  // Quando suspeitarmos de forward, sempre tenta extrair email original
  // do corpo (mesmo sem "Fwd:" no assunto).
  let emailOriginalDoCorpo: string | null = null;
  const corpo = extrairCorpoEmail(email.payload);
  if (encaminhado && corpo) {
    emailOriginalDoCorpo = extrairEmailDoCorpo(corpo);
    console.log("Email original extraído do corpo:", emailOriginalDoCorpo);
  }

  const emailRemetente = emailXOriginal ?? emailResent ?? emailOriginalDoCorpo ?? emailReplyTo ?? emailFrom;
  console.log("Email remetente (cadeia legada — só pra empresa fallback):", emailRemetente);

  const pdfs = coletarPdfs(email.payload);
  console.log("PDFs encontrados:", pdfs.length, pdfs.map((p: any) => p.filename));
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

    const pdfUrl = await salvarPdfNoStorage(pdfBase64, pdf.filename ?? "pedido.pdf", config.tenant_id, serviceRole);
    console.log("PDF salvo no storage:", pdfUrl);

    const pdfHash = await calcularPdfHash(pdfBase64);

    console.log("Chamando Claude API...");
    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": claudeKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 8096,
        messages: [{
          role: "user",
          content: [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfBase64 } },
            {
              type: "text",
              text: `Você é um especialista em análise de pedidos comerciais B2B brasileiros. Analise este pedido em PDF e extraia TODAS as informações disponíveis com máxima precisão.

Retorne APENAS um JSON válido com esta estrutura (use null para campos não encontrados):
{
  "numero_pedido": "número do pedido do cliente",
  "numero_pedido_fornecedor": "número interno do fornecedor",
  "numero_edi": "número EDI se existir",
  "tipo_pedido": "Compra, Bonificação, Troca, Consignação, Devolução",
  "canal_venda": "Direto, Distribuidor, E-commerce, Televendas",
  "campanha": "nome da campanha ou promoção",
  "numero_contrato": "número do contrato ou acordo comercial",
  "numero_cotacao": "número da cotação",
  "numero_nf_referencia": "número da NF de referência",
  "validade_proposta": "YYYY-MM-DD",
  "empresa_cliente": "razão social de quem faz o pedido",
  "nome_fantasia_cliente": "nome fantasia do cliente",
  "cnpj": "CNPJ do cliente XX.XXX.XXX/XXXX-XX",
  "inscricao_estadual_cliente": "inscrição estadual do cliente",
  "email_remetente": "email de quem fez o pedido",
  "nome_comprador": "nome do comprador ou representante",
  "email_comprador": "email do comprador",
  "telefone_comprador": "telefone do comprador",
  "codigo_comprador": "código do comprador no sistema do fornecedor",
  "departamento_comprador": "departamento ou setor",
  "razao_social_fornecedor": "razão social do fornecedor",
  "cnpj_fornecedor": "CNPJ do fornecedor",
  "codigo_fornecedor": "código do fornecedor no sistema do comprador",
  "data_emissao": "YYYY-MM-DD",
  "data_entrega_solicitada": "YYYY-MM-DD",
  "data_limite_entrega": "YYYY-MM-DD",
  "prazo_entrega_dias": número ou null,
  "transportadora": "nome da transportadora",
  "valor_frete": número ou null,
  "tipo_frete": "CIF, FOB, CIP, DAP",
  "peso_total_bruto": número kg ou null,
  "peso_total_liquido": número kg ou null,
  "volume_total": número m³ ou null,
  "quantidade_volumes": número inteiro ou null,
  "endereco_entrega": "logradouro completo",
  "numero_entrega": "número do endereço",
  "complemento_entrega": "complemento",
  "bairro_entrega": "bairro",
  "cidade_entrega": "cidade",
  "estado_entrega": "UF 2 letras",
  "cep_entrega": "CEP",
  "local_entrega": "código ou nome do local de entrega",
  "instrucoes_entrega": "instruções especiais de entrega",
  "condicao_pagamento": "condição ex: 30/60/90 dias",
  "prazo_pagamento_dias": número ou null,
  "forma_pagamento": "Boleto, PIX, Cartão, Depósito",
  "desconto_canal": número percentual ou null,
  "desconto_financeiro": número percentual ou null,
  "desconto_adicional": número percentual ou null,
  "numero_acordo": "número do acordo comercial",
  "vendor": "código ou nome do vendor ou verba",
  "rebate": número percentual ou null,
  "valor_entrada": número ou null,
  "instrucoes_faturamento": "instruções de faturamento",
  "ipi_percentual": número ou null,
  "valor_ipi": número ou null,
  "icms_st_percentual": número ou null,
  "valor_icms_st": número ou null,
  "base_calculo_st": número ou null,
  "mva_percentual": número ou null,
  "cfop": "código CFOP",
  "natureza_operacao": "descrição da natureza da operação",
  "ncm": "código NCM",
  "pis_percentual": número ou null,
  "cofins_percentual": número ou null,
  "nome_vendedor": "nome do vendedor ou representante",
  "codigo_vendedor": "código do vendedor",
  "centro_custo": "centro de custo",
  "projeto_obra": "nome do projeto ou obra",
  "responsavel_aprovacao": "nome do responsável pela aprovação",
  "observacoes": "observações gerais do pedido",
  "valor_total": número ou null,
  "confianca": número entre 0.0 e 1.0,
  "itens": [
    {
      "numero_item": número sequencial,
      "codigo_cliente": "código do produto usado pelo cliente",
      "ean": "código EAN ou código de barras ou SKU",
      "part_number": "part number ou código OEM",
      "referencia": "referência do produto",
      "descricao": "descrição completa do produto",
      "marca": "marca ou fabricante",
      "modelo": "modelo do produto",
      "cor": "cor se aplicável",
      "tamanho": "tamanho se aplicável",
      "grade": "grade completa ex: P/M/G/GG",
      "unidade_medida": "UN, CX, KG, L, M, PC, PAR, SC",
      "quantidade": número,
      "quantidade_minima": número MOQ ou null,
      "multiplo_venda": número ou null,
      "data_entrega_item": "YYYY-MM-DD ou null",
      "preco_unitario": número sem impostos ou null,
      "preco_unitario_com_impostos": número com impostos ou null,
      "ipi_item_percentual": número ou null,
      "valor_ipi_item": número ou null,
      "icms_st_item_percentual": número ou null,
      "valor_icms_st_item": número ou null,
      "base_calculo_st_item": número ou null,
      "desconto_comercial": número percentual ou null,
      "desconto_adicional_item": número percentual ou null,
      "desconto": número percentual total ou null,
      "vendor_item": "vendor ou verba do item",
      "preco_total": número total sem impostos ou null,
      "preco_total_com_impostos": número total com impostos ou null,
      "peso_bruto_item": número kg ou null,
      "peso_liquido_item": número kg ou null,
      "volume_item": número m³ ou null,
      "ncm_item": "NCM do item",
      "cfop_item": "CFOP do item",
      "numero_serie": "número de série",
      "lote": "número do lote",
      "data_validade": "YYYY-MM-DD validade do produto",
      "shelf_life_dias": número dias ou null,
      "temperatura_conservacao": "ex: 2-8°C, ambiente",
      "registro_anvisa": "número registro ANVISA",
      "aplicacao": "aplicação do produto ex: Gol G4 2008-2012",
      "cultura_destino": "cultura agrícola ex: Soja, Milho",
      "principio_ativo": "princípio ativo defensivo agrícola",
      "concentracao": "concentração ex: 250g/L",
      "registro_mapa": "número registro MAPA",
      "composicao": "composição do produto",
      "codigo_marketplace": "código no marketplace",
      "numero_empenho": "número do empenho público",
      "codigo_catmat": "código CATMAT",
      "observacao_item": "observação específica do item"
    }
  ]
}

IMPORTANTE:
- Extraia TODOS os campos que conseguir encontrar no documento
- Para valores numéricos use ponto como separador decimal
- Datas sempre no formato YYYY-MM-DD
- Percentuais como números ex: 15 para 15%
- Se não encontrar um campo use null
- Responda APENAS com o JSON, sem explicações, sem markdown`,
            },
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

    // Resolve o varejo original (quem enviou o e-mail), não o e-mail
    // do PDF — esse último vira fallback porque é dado de contato e
    // pode ser de qualquer pessoa (assistente, financeiro etc.).
    const varejo = identificarVarejoOriginal({
      xOriginal: emailXOriginal,
      resent: emailResent,
      from: emailFrom || null,
      replyTo: emailReplyTo,
      body: emailOriginalDoCorpo,
      iaCompradorEmail: dadosPedido.email_comprador ?? null,
      iaRemetenteEmail: dadosPedido.email_remetente ?? null,
    });
    console.log(`Varejo original resolvido: ${varejo.email} (fonte=${varejo.fonte})`);

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
        numero_pedido_fornecedor: dadosPedido.numero_pedido_fornecedor ?? null,
        numero_edi: dadosPedido.numero_edi ?? null,
        tipo_pedido: dadosPedido.tipo_pedido ?? null,
        canal_venda: dadosPedido.canal_venda ?? null,
        campanha: dadosPedido.campanha ?? null,
        numero_contrato: dadosPedido.numero_contrato ?? null,
        numero_cotacao: dadosPedido.numero_cotacao ?? null,
        numero_nf_referencia: dadosPedido.numero_nf_referencia ?? null,
        validade_proposta: dadosPedido.validade_proposta ?? null,
        empresa: dadosPedido.empresa_cliente ?? emailRemetente,
        nome_fantasia_cliente: dadosPedido.nome_fantasia_cliente ?? null,
        cnpj: dadosPedido.cnpj ?? null,
        inscricao_estadual_cliente: dadosPedido.inscricao_estadual_cliente ?? null,
        email_remetente: varejo.email,
        nome_comprador: dadosPedido.nome_comprador ?? null,
        email_comprador: dadosPedido.email_comprador ?? null,
        telefone_comprador: dadosPedido.telefone_comprador ?? null,
        codigo_comprador: dadosPedido.codigo_comprador ?? null,
        departamento_comprador: dadosPedido.departamento_comprador ?? null,
        razao_social_fornecedor: dadosPedido.razao_social_fornecedor ?? null,
        cnpj_fornecedor: dadosPedido.cnpj_fornecedor ?? null,
        codigo_fornecedor: dadosPedido.codigo_fornecedor ?? null,
        data_emissao: dadosPedido.data_emissao ?? null,
        data_entrega_solicitada: dadosPedido.data_entrega_solicitada ?? null,
        data_limite_entrega: dadosPedido.data_limite_entrega ?? null,
        prazo_entrega_dias: dadosPedido.prazo_entrega_dias ?? null,
        transportadora: dadosPedido.transportadora ?? null,
        valor_frete: dadosPedido.valor_frete ?? null,
        tipo_frete: dadosPedido.tipo_frete ?? null,
        peso_total_bruto: dadosPedido.peso_total_bruto ?? null,
        peso_total_liquido: dadosPedido.peso_total_liquido ?? null,
        volume_total: dadosPedido.volume_total ?? null,
        quantidade_volumes: dadosPedido.quantidade_volumes ?? null,
        endereco_entrega: dadosPedido.endereco_entrega ?? null,
        numero_entrega: dadosPedido.numero_entrega ?? null,
        complemento_entrega: dadosPedido.complemento_entrega ?? null,
        bairro_entrega: dadosPedido.bairro_entrega ?? null,
        cidade_entrega: dadosPedido.cidade_entrega ?? null,
        estado_entrega: dadosPedido.estado_entrega ?? null,
        cep_entrega: dadosPedido.cep_entrega ?? null,
        local_entrega: dadosPedido.local_entrega ?? null,
        instrucoes_entrega: dadosPedido.instrucoes_entrega ?? null,
        condicao_pagamento: dadosPedido.condicao_pagamento ?? null,
        prazo_pagamento_dias: dadosPedido.prazo_pagamento_dias ?? null,
        forma_pagamento: dadosPedido.forma_pagamento ?? null,
        desconto_canal: dadosPedido.desconto_canal ?? null,
        desconto_financeiro: dadosPedido.desconto_financeiro ?? null,
        desconto_adicional: dadosPedido.desconto_adicional ?? null,
        numero_acordo: dadosPedido.numero_acordo ?? null,
        vendor: dadosPedido.vendor ?? null,
        rebate: dadosPedido.rebate ?? null,
        valor_entrada: dadosPedido.valor_entrada ?? null,
        instrucoes_faturamento: dadosPedido.instrucoes_faturamento ?? null,
        ipi_percentual: dadosPedido.ipi_percentual ?? null,
        valor_ipi: dadosPedido.valor_ipi ?? null,
        icms_st_percentual: dadosPedido.icms_st_percentual ?? null,
        valor_icms_st: dadosPedido.valor_icms_st ?? null,
        base_calculo_st: dadosPedido.base_calculo_st ?? null,
        mva_percentual: dadosPedido.mva_percentual ?? null,
        cfop: dadosPedido.cfop ?? null,
        natureza_operacao: dadosPedido.natureza_operacao ?? null,
        ncm: dadosPedido.ncm ?? null,
        pis_percentual: dadosPedido.pis_percentual ?? null,
        cofins_percentual: dadosPedido.cofins_percentual ?? null,
        nome_vendedor: dadosPedido.nome_vendedor ?? null,
        codigo_vendedor: dadosPedido.codigo_vendedor ?? null,
        centro_custo: dadosPedido.centro_custo ?? null,
        projeto_obra: dadosPedido.projeto_obra ?? null,
        responsavel_aprovacao: dadosPedido.responsavel_aprovacao ?? null,
        observacoes_gerais: dadosPedido.observacoes ?? null,
        valor_total: dadosPedido.valor_total ?? null,
        confianca_ia: dadosPedido.confianca ?? 0,
        status: "pendente",
        assunto_email: assunto,
        remetente_email: varejo.email,
        remetente_origem: varejo.fonte,
        email_envelope_from: emailFrom || null,
        canal_entrada: "email",
        pdf_url: pdfUrl,
        pdf_hash: pdfHash,
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
          ean: item.ean ?? null,
          part_number: item.part_number ?? null,
          referencia: item.referencia ?? null,
          descricao: item.descricao ?? null,
          marca: item.marca ?? null,
          modelo: item.modelo ?? null,
          cor: item.cor ?? null,
          tamanho: item.tamanho ?? null,
          grade: item.grade ?? null,
          unidade_medida: item.unidade_medida ?? null,
          quantidade: item.quantidade ?? 0,
          quantidade_minima: item.quantidade_minima ?? null,
          multiplo_venda: item.multiplo_venda ?? null,
          data_entrega_item: item.data_entrega_item ?? null,
          preco_unitario: item.preco_unitario ?? null,
          preco_unitario_com_impostos: item.preco_unitario_com_impostos ?? null,
          ipi_item_percentual: item.ipi_item_percentual ?? null,
          valor_ipi_item: item.valor_ipi_item ?? null,
          icms_st_item_percentual: item.icms_st_item_percentual ?? null,
          valor_icms_st_item: item.valor_icms_st_item ?? null,
          base_calculo_st_item: item.base_calculo_st_item ?? null,
          desconto_comercial: item.desconto_comercial ?? null,
          desconto_adicional_item: item.desconto_adicional_item ?? null,
          desconto: item.desconto ?? null,
          vendor_item: item.vendor_item ?? null,
          preco_total: item.preco_total ?? null,
          preco_total_com_impostos: item.preco_total_com_impostos ?? null,
          peso_bruto_item: item.peso_bruto_item ?? null,
          peso_liquido_item: item.peso_liquido_item ?? null,
          volume_item: item.volume_item ?? null,
          ncm_item: item.ncm_item ?? null,
          cfop_item: item.cfop_item ?? null,
          numero_serie: item.numero_serie ?? null,
          lote: item.lote ?? null,
          data_validade: item.data_validade ?? null,
          shelf_life_dias: item.shelf_life_dias ?? null,
          temperatura_conservacao: item.temperatura_conservacao ?? null,
          registro_anvisa: item.registro_anvisa ?? null,
          aplicacao: item.aplicacao ?? null,
          cultura_destino: item.cultura_destino ?? null,
          principio_ativo: item.principio_ativo ?? null,
          concentracao: item.concentracao ?? null,
          registro_mapa: item.registro_mapa ?? null,
          composicao: item.composicao ?? null,
          codigo_marketplace: item.codigo_marketplace ?? null,
          numero_empenho: item.numero_empenho ?? null,
          codigo_catmat: item.codigo_catmat ?? null,
          observacao_item: item.observacao_item ?? null,
        }))),
      });
    }

    const validacaoDuplicidade = await lerConfigBoolean(
      config.tenant_id, "validacao_duplicidade_ativa", true, serviceRole,
    );
    const isDuplicado = validacaoDuplicidade
      ? await verificarDuplicado(
          {
            numeroPedido: dadosPedido.numero_pedido ?? null,
            cnpj: dadosPedido.cnpj ?? null,
            pdfHash,
            pedidoAtualId: pedidoId,
            tenantId: config.tenant_id,
          },
          serviceRole,
        )
      : false;

    if (isDuplicado) {
      console.log("Pedido duplicado detectado!");
      await fetch(`${SUPABASE_URL}/rest/v1/pedidos?id=eq.${pedidoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", apikey: serviceRole, Authorization: `Bearer ${serviceRole}` },
        body: JSON.stringify({ status: "duplicado" }),
      });
      await chamarFuncao("enviar-notificacao-email", { pedido_id: pedidoId, status: "duplicado" }, serviceRole);
      await criarNotificacaoDuplicado(config.tenant_id, dadosPedido.numero_pedido ?? "", serviceRole);
    } else {
      const cfgAutoRes = await fetch(
        `${SUPABASE_URL}/rest/v1/configuracoes?tenant_id=eq.${config.tenant_id}&chave=in.(aprovacao_automatica,confianca_minima_aprovacao,valor_maximo_aprovacao_automatica,quantidade_maxima_item_automatica,comportamento_codigo_novo)&select=chave,valor`,
        { headers: { apikey: serviceRole, Authorization: `Bearer ${serviceRole}` } },
      );
      const cfgsAuto = await cfgAutoRes.json();
      const cfgAutoMap = new Map(cfgsAuto.map((c: any) => [c.chave, c.valor]));
      const comportamento = (cfgAutoMap.get("comportamento_codigo_novo") ?? "aprovar_parcial") as
        | "bloquear" | "aprovar_original" | "aprovar_parcial";

      const pendentesCount = await aplicarDeParaELevantarPendencias(
        pedidoId, config.tenant_id, dadosPedido, serviceRole,
      );

      let statusFinal: string | null = null;
      if (pendentesCount > 0) {
        if (comportamento === "bloquear") {
          statusFinal = "aguardando_de_para";
        } else if (comportamento === "aprovar_parcial") {
          statusFinal = "aprovado_parcial";
        }
        await criarNotificacaoCodigosNovos(config.tenant_id, pedidoId, pendentesCount, serviceRole);
      }

      if (statusFinal) {
        await fetch(`${SUPABASE_URL}/rest/v1/pedidos?id=eq.${pedidoId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", apikey: serviceRole, Authorization: `Bearer ${serviceRole}` },
          body: JSON.stringify({ status: statusFinal }),
        });
      } else {
        const itensSalvos = await buscarItensPedido(pedidoId, serviceRole);
        const avaliacao = avaliarAprovacaoAutomatica({
          dadosPedido,
          itens: itensSalvos,
          pendentesCount,
          cfg: cfgAutoMap as Map<string, string>,
        });

        if (avaliacao.aprovado) {
          console.log("Aprovando pedido automaticamente!", avaliacao.metadata);
          await fetch(`${SUPABASE_URL}/rest/v1/pedidos?id=eq.${pedidoId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json", apikey: serviceRole, Authorization: `Bearer ${serviceRole}` },
            body: JSON.stringify({ status: "aprovado" }),
          });
          await registrarAprovacaoAutomatica({
            pedidoId, tenantId: config.tenant_id,
            tipoEvento: "aprovacao_automatica",
            valorAnterior: "pendente", valorNovo: "aprovado",
            metadata: avaliacao.metadata,
          }, serviceRole);
          await chamarFuncao("enviar-notificacao-email", { pedido_id: pedidoId, status: "aprovado" }, serviceRole);
        } else {
          console.log(`Aprovação automática reprovada (${avaliacao.regraReprovada}):`, avaliacao.motivo);
          await registrarAprovacaoAutomatica({
            pedidoId, tenantId: config.tenant_id,
            tipoEvento: "aprovacao_automatica_recusada",
            valorAnterior: null, valorNovo: "pendente",
            metadata: avaliacao.metadata,
          }, serviceRole);
          // Só envia notif_recebimento quando a aprovação automática
          // está simplesmente desligada (regra "toggle_ativo"). Quando
          // reprovou por regra real (confiança, valor, etc.), espera
          // ação humana — o e-mail definitivo virá quando admin
          // aprovar/reprovar manualmente.
          if (avaliacao.regraReprovada === "toggle_ativo") {
            await chamarFuncao("enviar-notificacao-email", { pedido_id: pedidoId, status: "pendente" }, serviceRole);
          }
        }
      }
    }

    await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/modify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ removeLabelIds: ["UNREAD"] }),
    });

    console.log("Email processado com sucesso!");
  }
}

interface AvaliacaoAprovacaoAutomatica {
  aprovado: boolean;
  regraReprovada?: string;
  motivo?: string;
  metadata: Record<string, any>;
}

function avaliarAprovacaoAutomatica(opts: {
  dadosPedido: any;
  itens: Array<{ quantidade?: number | null; preco_total?: number | null; codigo_produto_erp?: string | null }>;
  pendentesCount: number;
  cfg: Map<string, string>;
}): AvaliacaoAprovacaoAutomatica {
  const { dadosPedido, itens, pendentesCount, cfg } = opts;

  const aprovacaoAutomatica = cfg.get("aprovacao_automatica") === "true";
  const confiancaMinPct = parseNumOrNull(cfg.get("confianca_minima_aprovacao"));
  const valorMaximo = parseNumOrNull(cfg.get("valor_maximo_aprovacao_automatica"));
  const qtdMaxima = parseNumOrNull(cfg.get("quantidade_maxima_item_automatica"));

  const confiancaPedido = Number(dadosPedido.confianca ?? 0); // 0..1
  const numeroPedido = String(dadosPedido.numero_pedido ?? "").trim();
  const cnpj = String(dadosPedido.cnpj ?? "").trim();
  const dataPedido = dadosPedido.data_pedido ?? dadosPedido.data_emissao ?? null;
  const valorTotal = Number(dadosPedido.valor_total ?? 0);
  const somaItens = itens.reduce((acc, it) => acc + Number(it.preco_total ?? 0), 0);
  const tolerancia = Math.max(0.01, valorTotal * 0.005); // 0,5% ou 1 centavo

  const regrasOk: string[] = [];
  const metadata: Record<string, any> = {
    usuario: "sistema_automatico",
    confianca_ia: confiancaPedido,
    confianca_minima_pct: confiancaMinPct,
    valor_total: valorTotal,
    soma_itens: Math.round(somaItens * 100) / 100,
    diferenca_valor: Math.round((valorTotal - somaItens) * 100) / 100,
    tolerancia: Math.round(tolerancia * 100) / 100,
    valor_maximo_config: valorMaximo,
    quantidade_maxima_config: qtdMaxima,
    pendentes_de_para: pendentesCount,
    qtd_itens: itens.length,
  };

  // Avaliação sequencial — early return na primeira reprovação.
  if (!aprovacaoAutomatica) {
    return reprovar("toggle_ativo", "aprovacao_automatica desligada");
  }
  regrasOk.push("toggle_ativo");

  if (confiancaMinPct === null) {
    return reprovar("confianca_suficiente", "confianca_minima_aprovacao não configurada");
  }
  if (confiancaPedido * 100 < confiancaMinPct) {
    return reprovar("confianca_suficiente", `confiança ${(confiancaPedido * 100).toFixed(1)}% < mínimo ${confiancaMinPct}%`);
  }
  regrasOk.push("confianca_suficiente");

  if (pendentesCount > 0) {
    return reprovar("todos_itens_com_de_para", `${pendentesCount} item(ns) sem DE-PARA`);
  }
  regrasOk.push("todos_itens_com_de_para");

  if (!numeroPedido) {
    return reprovar("numero_pedido_legivel", "numero_pedido_cliente vazio");
  }
  regrasOk.push("numero_pedido_legivel");

  if (valorMaximo === null) {
    return reprovar("valor_dentro_do_limite", "valor_maximo_aprovacao_automatica não configurado");
  }
  if (valorTotal > valorMaximo) {
    return reprovar("valor_dentro_do_limite", `valor ${valorTotal} > limite ${valorMaximo}`);
  }
  regrasOk.push("valor_dentro_do_limite");

  if (qtdMaxima === null) {
    return reprovar("quantidade_itens_dentro_do_limite", "quantidade_maxima_item_automatica não configurada");
  }
  const itemAcimaLimite = itens.find((it) => Number(it.quantidade ?? 0) > qtdMaxima);
  if (itemAcimaLimite) {
    return reprovar("quantidade_itens_dentro_do_limite", `item com quantidade ${itemAcimaLimite.quantidade} > limite ${qtdMaxima}`);
  }
  regrasOk.push("quantidade_itens_dentro_do_limite");

  // Campos obrigatórios + tolerância valor_total vs soma
  const camposFalhando: string[] = [];
  if (!cnpj) camposFalhando.push("cnpj");
  if (!dataPedido) camposFalhando.push("data_pedido");
  if (itens.length === 0) camposFalhando.push("itens");
  if (!(valorTotal > 0)) camposFalhando.push("valor_total>0");
  if (valorTotal > 0 && Math.abs(valorTotal - somaItens) > tolerancia) {
    camposFalhando.push(`valor_total~soma (diff ${(valorTotal - somaItens).toFixed(2)})`);
  }
  if (camposFalhando.length > 0) {
    return reprovar("campos_obrigatorios_completos", `faltando: ${camposFalhando.join(", ")}`);
  }
  regrasOk.push("campos_obrigatorios_completos");

  metadata.regras_validadas = regrasOk;
  return { aprovado: true, metadata };

  function reprovar(regra: string, motivo: string): AvaliacaoAprovacaoAutomatica {
    metadata.regras_validadas = regrasOk;
    metadata.regra_reprovada = regra;
    metadata.motivo = motivo;
    return { aprovado: false, regraReprovada: regra, motivo, metadata };
  }
}

function parseNumOrNull(s: string | undefined): number | null {
  if (s === undefined || s === null || String(s).trim() === "") return null;
  const n = Number(String(s).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

async function buscarItensPedido(
  pedidoId: string, serviceRole: string,
): Promise<Array<{ quantidade?: number | null; preco_total?: number | null; codigo_produto_erp?: string | null }>> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/pedido_itens?pedido_id=eq.${pedidoId}&select=quantidade,preco_total,codigo_produto_erp`,
    { headers: { apikey: serviceRole, Authorization: `Bearer ${serviceRole}` } },
  );
  if (!res.ok) {
    console.error("Falha ao buscar itens p/ aprovação automática:", await res.text());
    return [];
  }
  return await res.json();
}

async function registrarAprovacaoAutomatica(
  opts: {
    pedidoId: string; tenantId: string;
    tipoEvento: "aprovacao_automatica" | "aprovacao_automatica_recusada";
    valorAnterior: string | null; valorNovo: string;
    metadata: Record<string, any>;
  },
  serviceRole: string,
): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/pedido_logs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: serviceRole,
      Authorization: `Bearer ${serviceRole}`,
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      pedido_id: opts.pedidoId,
      tenant_id: opts.tenantId,
      campo: "status",
      valor_anterior: opts.valorAnterior,
      valor_novo: opts.valorNovo,
      alterado_por: null,
      tipo_evento: opts.tipoEvento,
      metadata: opts.metadata,
    }),
  });
  if (!res.ok) {
    console.error("Falha ao gravar pedido_logs auditoria:", await res.text());
  }
}

async function aplicarDeParaELevantarPendencias(
  pedidoId: string,
  tenantId: string,
  dadosPedido: any,
  serviceRole: string,
): Promise<number> {
  const itensRes = await fetch(
    `${SUPABASE_URL}/rest/v1/pedido_itens?pedido_id=eq.${pedidoId}&select=id,codigo_cliente,descricao,ean`,
    { headers: { apikey: serviceRole, Authorization: `Bearer ${serviceRole}` } },
  );
  if (!itensRes.ok) {
    console.error("Falha ao listar pedido_itens:", await itensRes.text());
    return 0;
  }
  const itens = await itensRes.json() as Array<{
    id: string; codigo_cliente: string | null; descricao: string | null; ean: string | null;
  }>;
  if (!Array.isArray(itens) || itens.length === 0) return 0;

  let pendentes = 0;
  for (const item of itens) {
    const codigoCliente = (item.codigo_cliente ?? "").trim();
    if (!codigoCliente) continue;

    const lookup = await fetch(
      `${SUPABASE_URL}/rest/v1/de_para?tenant_id=eq.${tenantId}&tipo=eq.PRODUTO_CODIGO&valor_origem=eq.${encodeURIComponent(codigoCliente)}&ativo=eq.true&select=valor_destino&limit=1`,
      { headers: { apikey: serviceRole, Authorization: `Bearer ${serviceRole}` } },
    );
    const matches = lookup.ok ? await lookup.json() : [];
    if (Array.isArray(matches) && matches.length > 0 && matches[0]?.valor_destino) {
      await fetch(`${SUPABASE_URL}/rest/v1/pedido_itens?id=eq.${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", apikey: serviceRole, Authorization: `Bearer ${serviceRole}` },
        body: JSON.stringify({ codigo_produto_erp: matches[0].valor_destino }),
      });
      continue;
    }

    let sugestoes: any[] = [];
    try {
      const resp = await chamarFuncao(
        "sugerir-de-para-ia",
        {
          tenant_id: tenantId,
          codigo_cliente: codigoCliente,
          descricao_pedido: item.descricao ?? "",
          ean: item.ean ?? "",
        },
        serviceRole,
      );
      sugestoes = Array.isArray(resp?.sugestoes) ? resp.sugestoes : [];
    } catch (e) {
      console.error("sugerir-de-para-ia falhou para item", item.id, (e as Error).message);
    }

    const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/pedido_itens_pendentes_de_para`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceRole,
        Authorization: `Bearer ${serviceRole}`,
        Prefer: "resolution=ignore-duplicates",
      },
      body: JSON.stringify({
        pedido_id: pedidoId,
        pedido_item_id: item.id,
        tenant_id: tenantId,
        codigo_cliente: codigoCliente,
        descricao_pedido: item.descricao ?? null,
        sugestoes_ia: sugestoes,
      }),
    });
    if (!insertRes.ok && insertRes.status !== 409) {
      console.error("Falha ao gravar pendência DE-PARA:", await insertRes.text());
    }
    pendentes++;
  }
  return pendentes;
}

async function criarNotificacaoTenant(opts: {
  tenantId: string; tipo: string; titulo: string; mensagem: string; link?: string | null;
  serviceRole: string;
}): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/notificacoes_painel`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: opts.serviceRole,
      Authorization: `Bearer ${opts.serviceRole}`,
    },
    body: JSON.stringify({
      tenant_id: opts.tenantId,
      tipo: opts.tipo,
      titulo: opts.titulo,
      mensagem: opts.mensagem,
      link: opts.link ?? null,
    }),
  });
  if (!res.ok) {
    console.error(`Falha ao criar notificação ${opts.tipo}:`, await res.text());
  }
}

async function criarNotificacaoCodigosNovos(
  tenantId: string,
  _pedidoId: string,
  qtd: number,
  serviceRole: string,
): Promise<void> {
  await criarNotificacaoTenant({
    tenantId,
    tipo: "codigos_novos",
    titulo: "Pedido com códigos novos",
    mensagem: `${qtd} item(ns) sem DE-PARA aguardando confirmação. Abra o pedido e clique em "Resolver códigos novos".`,
    link: "/dashboard?statusFiltro=codigos_novos",
    serviceRole,
  });
}

async function criarNotificacaoDuplicado(
  tenantId: string,
  numeroPedido: string,
  serviceRole: string,
): Promise<void> {
  const ref = numeroPedido?.trim() || "(sem número)";
  await criarNotificacaoTenant({
    tenantId,
    tipo: "pedido_duplicado",
    titulo: "Pedido duplicado detectado",
    mensagem: `Pedido ${ref} caiu como duplicado. Abra para Arquivar ou Marcar como pedido novo.`,
    link: "/dashboard?statusFiltro=duplicado",
    serviceRole,
  });
}
