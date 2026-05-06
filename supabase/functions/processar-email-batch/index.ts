// processar-email-batch
// Substitui processarTenant para tenants com modo_processamento = "batch".
// Coleta PDFs dos emails não lidos, monta um batch request para a Anthropic
// Batch API e registra em processamento_batch. NÃO marca emails como lidos —
// isso acontece quando o batch terminar (coletar-resultados-batch).

import { SUPABASE_URL, getServiceRole } from "../_shared/supabase-client.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// deno-lint-ignore no-explicit-any
type AnyObj = Record<string, any>;

interface ColunaLayout {
  nome_coluna: string;
  tipo: "pedido" | "item";
  formato_data?: string | null;
  campo_sistema?: string | null;
  obrigatorio?: boolean | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const serviceRole = getServiceRole();
    const claudeKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!serviceRole || !claudeKey) {
      return jsonResp(500, { error: "Secrets não configurados" });
    }

    // Autenticação: apenas chamadas internas com service role.
    const authHeader = req.headers.get("Authorization") ?? "";
    if (authHeader !== `Bearer ${serviceRole}`) {
      return jsonResp(401, { error: "Não autorizado" });
    }

    const body = await req.json() as { tenant_id: string };
    const tenantId = body.tenant_id;
    if (!tenantId) return jsonResp(400, { error: "tenant_id é obrigatório" });

    const result = await processarTenantBatch(tenantId, serviceRole, claudeKey);
    return jsonResp(200, result);
  } catch (e) {
    console.error("Erro em processar-email-batch:", (e as Error).message);
    return jsonResp(500, { error: (e as Error).message });
  }
});

async function processarTenantBatch(
  tenantId: string,
  serviceRole: string,
  claudeKey: string,
): Promise<AnyObj> {
  // 1. Busca configurações do tenant.
  const [gmailRes, erpRes] = await Promise.all([
    fetch(
      `${SUPABASE_URL}/rest/v1/tenant_gmail_config?tenant_id=eq.${tenantId}&select=*`,
      { headers: { apikey: serviceRole, Authorization: `Bearer ${serviceRole}` } },
    ),
    fetch(
      `${SUPABASE_URL}/rest/v1/tenant_erp_config?tenant_id=eq.${tenantId}&select=mapeamento_campos`,
      { headers: { apikey: serviceRole, Authorization: `Bearer ${serviceRole}` } },
    ),
  ]);

  const [gmailRows, erpRows] = await Promise.all([gmailRes.json(), erpRes.json()]);
  const gmailConfig = gmailRows?.[0];
  if (!gmailConfig?.ativo) return { skipped: true, motivo: "gmail_inativo" };

  const mapeamentoCampos = erpRows?.[0]?.mapeamento_campos;
  const colunas: AnyObj[] = mapeamentoCampos?.colunas ?? [];
  if (!Array.isArray(colunas) || colunas.length === 0) {
    return { skipped: true, motivo: "sem_layout" };
  }
  const layout: ColunaLayout[] = colunas
    .filter((c) => c?.nome_coluna)
    .map((c) => ({
      nome_coluna: String(c.nome_coluna),
      tipo: c.tipo === "item" ? "item" : "pedido",
      formato_data: c.formato_data ?? null,
      campo_sistema: c.campo_sistema ?? null,
      obrigatorio: c.obrigatorio ?? null,
    }));
  const metadados: { separador_decimal?: string } | null = mapeamentoCampos?.metadados ?? null;

  // 2. Renova token Gmail se necessário.
  const accessToken = await getAccessToken(gmailConfig, tenantId, serviceRole);

  // 3. Busca emails não lidos com PDF.
  const query = encodeURIComponent(`is:unread has:attachment filename:pdf`);
  const listRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${query}&maxResults=50`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const listJson = await listRes.json();
  const messages: AnyObj[] = listJson.messages ?? [];
  console.log(`[batch] tenant=${tenantId} emails encontrados: ${messages.length}`);

  if (messages.length === 0) return { skipped: true, motivo: "sem_emails" };

  // 4. Monta requests do batch — 1 request por PDF.
  const userMsg = montarUserMessage(layout, metadados);
  const batchRequests: AnyObj[] = [];
  const gmailMessageIds: string[] = [];
  const pdfUrls: Record<string, string> = {};

  for (const msg of messages) {
    const msgId = msg.id as string;

    // Verifica dedup por gmail_message_id antes de baixar o PDF.
    const dedupRes = await fetch(
      `${SUPABASE_URL}/rest/v1/pedidos?tenant_id=eq.${tenantId}&gmail_message_id=eq.${msgId}&select=id&limit=1`,
      { headers: { apikey: serviceRole, Authorization: `Bearer ${serviceRole}` } },
    );
    if (dedupRes.ok) {
      const rows = await dedupRes.json();
      if (Array.isArray(rows) && rows.length > 0) {
        console.log(`[batch] gmail_message_id ${msgId} já existe — pulando`);
        continue;
      }
    }

    // Evita retry infinito: se o email já falhou em algum batch nas últimas 24h,
    // marca como lido e pula para não gerar novos batches indefinidamente.
    const h24Atras = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const batchErrRes = await fetch(
      `${SUPABASE_URL}/rest/v1/processamento_batch?tenant_id=eq.${tenantId}&gmail_message_ids=cs.${encodeURIComponent(`{${msgId}}`)}&emails_erro=gt.0&created_at=gte.${h24Atras}&select=id&limit=1`,
      { headers: { apikey: serviceRole, Authorization: `Bearer ${serviceRole}` } },
    );
    if (batchErrRes.ok) {
      const batchErrRows = await batchErrRes.json();
      if (Array.isArray(batchErrRows) && batchErrRows.length > 0) {
        console.warn(`[batch] gmail_message_id ${msgId} já falhou em batch recente — marcando como lido e pulando`);
        await marcarEmailLido(msgId, accessToken);
        continue;
      }
    }

    // Baixa metadata do email para encontrar o attachmentId.
    const metaRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgId}?format=full`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!metaRes.ok) {
      console.warn(`[batch] falha ao buscar metadata do email ${msgId}`);
      continue;
    }
    const metaJson = await metaRes.json();
    const pdfs = coletarPdfs(metaJson.payload ?? {});
    if (pdfs.length === 0) continue;

    // Usa apenas o primeiro PDF do email.
    const pdf = pdfs[0];
    const attachmentId = pdf.body?.attachmentId;
    if (!attachmentId) continue;

    const attachRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgId}/attachments/${attachmentId}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!attachRes.ok) {
      console.warn(`[batch] falha ao baixar PDF do email ${msgId}`);
      continue;
    }
    const attachJson = await attachRes.json();
    const pdfBase64 = attachJson.data?.replace(/-/g, "+").replace(/_/g, "/");
    if (!pdfBase64) continue;

    // Salva no Storage (best-effort — batch não depende da URL).
    const pdfUrl = await salvarPdfNoStorage(
      pdfBase64,
      pdf.filename ?? "pedido.pdf",
      tenantId,
      serviceRole,
    );
    if (pdfUrl) pdfUrls[msgId] = pdfUrl;

    // Monta request para Anthropic Batch API.
    batchRequests.push({
      custom_id: msgId,
      params: {
        model: "claude-haiku-4-5-20251001",
        max_tokens: 16000,
        system: SYSTEM_PROMPT,
        messages: [{
          role: "user",
          content: [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfBase64 } },
            { type: "text", text: userMsg },
          ],
        }],
      },
    });
    gmailMessageIds.push(msgId);
  }

  if (batchRequests.length === 0) {
    return { skipped: true, motivo: "todos_dedup_ou_sem_pdf" };
  }

  // 5. Envia batch para Anthropic.
  const batchRes = await fetch("https://api.anthropic.com/v1/messages/batches", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": claudeKey,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "message-batches-2024-09-24",
    },
    body: JSON.stringify({ requests: batchRequests }),
  });

  if (!batchRes.ok) {
    const errJson = await batchRes.json();
    throw new Error(`Anthropic Batch API HTTP ${batchRes.status}: ${errJson?.error?.message ?? "sem mensagem"}`);
  }

  const batchJson = await batchRes.json();
  const batchId: string = batchJson.id;
  console.log(`[batch] tenant=${tenantId} batch_id=${batchId} emails=${batchRequests.length}`);

  // 6. Registra em processamento_batch.
  const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/processamento_batch`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: serviceRole,
      Authorization: `Bearer ${serviceRole}`,
    },
    body: JSON.stringify({
      tenant_id: tenantId,
      batch_id: batchId,
      status: "enviado",
      total_emails: batchRequests.length,
      gmail_message_ids: gmailMessageIds,
    }),
  });
  if (!insertRes.ok) {
    console.error("[batch] falha ao salvar processamento_batch:", await insertRes.text());
  }

  return {
    batch_id: batchId,
    total_emails: batchRequests.length,
    gmail_message_ids: gmailMessageIds,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Você é um especialista em extração de pedidos B2B brasileiros a partir
de PDF. Recebe o PDF do pedido + a lista de colunas que o cliente usa
no ERP dele. Devolve TRÊS estruturas em UM ÚNICO objeto JSON.

REGRAS ABSOLUTAS — viola = falha:

1. USE APENAS dados literalmente presentes no PDF. NUNCA invente,
   infira, calcule, complete ou estime qualquer valor que não esteja
   escrito no documento. Sem exceções.

2. Campo sem dado correspondente no PDF:
   - Em "canonicos" e "itens_canonicos": null
   - Em "linhas": string vazia ""
   Nunca "N/A", "-", placeholder ou texto descritivo de ausência.

3. Datas:
   - Em "canonicos" e "itens_canonicos": ISO YYYY-MM-DD (ex: "2025-04-10")
   - Em "linhas": siga o formato declarado pela coluna do layout
     (DD/MM/YYYY ou YYYY-MM-DD). Se não houver formato declarado,
     use DD/MM/YYYY.

4. Números:
   - Em "canonicos" e "itens_canonicos": JSON number puro
     (123.45, NÃO "123,45" nem "123.45")
   - Em "linhas": string preservando o formato apropriado para o ERP
     do cliente (mantenha a pontuação como o cliente espera).

5. Saída: APENAS um objeto JSON válido, sem markdown, sem comentários,
   sem texto antes ou depois.

6. Quantidade de elementos:
   - linhas.length === itens_canonicos.length, exceto:
   - Pedido sem itens detectados: itens_canonicos = [], linhas tem
     1 entrada (cabeçalho replicado, colunas tipo [item] vazias).

7. Em "linhas", as CHAVES devem ser EXATAMENTE os nomes de coluna do
   LAYOUT (sem renomear, sem normalizar, sem traduzir, sem remover
   acentos/maiúsculas). Quantidade de chaves por linha = quantidade
   de colunas no layout.

8. Para colunas tipo [pedido] em "linhas": mesmo valor em TODAS as
   linhas (cabeçalho replicado).
   Para colunas tipo [item] em "linhas": valor específico do item N
   daquela linha (item N de itens_canonicos ↔ linhas[N], em ordem).

9. NÃO retorne campo "confianca". A confiança é calculada
   deterministicamente pelo sistema com base em quais canônicos
   críticos foram preenchidos.

10. Se o PDF anexado NÃO for um pedido de compra (ex: nota fiscal,
    newsletter, boleto, extrato, contrato, proposta comercial, etc.),
    retorne APENAS: { "nao_e_pedido": true }

11. No campo "empresa" dos canonicos: coloque SEMPRE o nome da
    empresa compradora (razão social ou nome fantasia) conforme
    aparece no PDF. Procure em campos como "COMPRADOR", "CLIENTE",
    "EMPRESA", "RAZÃO SOCIAL", "NOME", cabeçalho do pedido, ou
    qualquer local que identifique quem está comprando.
    Este campo é CRÍTICO — só deixe null se absolutamente nenhum
    nome de empresa aparecer no documento.

12. Para encontrar os dados no PDF, busque em TODAS as partes do
    documento: cabeçalho, rodapé, tabelas, campos laterais,
    observações e qualquer área de texto. Se um dado não estiver
    na posição esperada, continue procurando no restante do documento
    antes de concluir que está ausente.`;

function montarUserMessage(layout: ColunaLayout[], metadados?: { separador_decimal?: string } | null): string {
  const layoutTxt = layout
    .map((c, idx) => {
      const fmt = c.formato_data ? `   (formato: ${c.formato_data})` : "";
      const mapeamento = c.campo_sistema ? ` → ${c.campo_sistema}` : "";
      const obrig = c.obrigatorio ? " ★OBRIGATÓRIO" : "";
      return `${idx + 1}. [${c.tipo}] ${JSON.stringify(c.nome_coluna)}${mapeamento}${fmt}${obrig}`;
    })
    .join("\n");

  const sepDecimal = metadados?.separador_decimal;
  const sepLinha = sepDecimal
    ? `Separador decimal esperado pelo ERP: ${sepDecimal === "virgula" ? "vírgula (ex: 1.234,56)" : sepDecimal === "ponto" ? "ponto (ex: 1234.56)" : "vírgula ou ponto (ambos aceitos)"}\n\n`
    : "";

  const temObrigatorio = layout.some((c) => c.obrigatorio);
  const instrObrig = temObrigatorio
    ? `\nColunas marcadas com ★OBRIGATÓRIO são críticas — nunca deixe null ou "" se o dado estiver em qualquer parte do documento.\n`
    : "";

  return `${sepLinha}LAYOUT DO ERP DO CLIENTE (na ordem exata, repete por item):
${layoutTxt}
${instrObrig}
TAREFA:
Devolva JSON com 3 estruturas em UM único objeto conforme as regras do sistema.
Cada linha deve ter EXATAMENTE as ${layout.length} chaves do layout, na
ordem listada acima. Para colunas tipo [pedido]: mesmo valor em todas as
linhas. Para colunas tipo [item]: valor específico do item N. Use ""
para coluna sem dado correspondente. NUNCA invente.`;
}

async function getAccessToken(
  config: AnyObj,
  tenantId: string,
  serviceRole: string,
): Promise<string> {
  const expiresAt = new Date(config.token_expires_at).getTime();
  if (expiresAt - Date.now() > 5 * 60 * 1000) return config.access_token;

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
    await fetch(
      `${SUPABASE_URL}/rest/v1/tenant_gmail_config?tenant_id=eq.${tenantId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", apikey: serviceRole, Authorization: `Bearer ${serviceRole}` },
        body: JSON.stringify({ ativo: false }),
      },
    );
    throw new Error(`Falha ao renovar token Gmail: ${refreshJson.error}`);
  }

  const novoToken = refreshJson.access_token;
  const novaExpiracao = new Date(Date.now() + (refreshJson.expires_in ?? 3600) * 1000).toISOString();
  await fetch(
    `${SUPABASE_URL}/rest/v1/tenant_gmail_config?tenant_id=eq.${tenantId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json", apikey: serviceRole, Authorization: `Bearer ${serviceRole}` },
      body: JSON.stringify({ access_token: novoToken, token_expires_at: novaExpiracao }),
    },
  );
  return novoToken;
}

function coletarPdfs(payload: AnyObj): AnyObj[] {
  const encontrados: AnyObj[] = [];
  const vistos = new Set<string>();
  const visitar = (parte: AnyObj) => {
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

async function salvarPdfNoStorage(
  pdfBase64: string,
  filename: string,
  tenantId: string,
  serviceRole: string,
): Promise<string | null> {
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
    if (!uploadRes.ok) {
      console.error("Erro ao salvar PDF:", await uploadRes.text());
      return null;
    }
    return `${SUPABASE_URL}/storage/v1/object/public/pedidos-pdf/${path}`;
  } catch (e) {
    console.error("Erro ao salvar PDF:", (e as Error).message);
    return null;
  }
}

async function marcarEmailLido(messageId: string, accessToken: string): Promise<void> {
  try {
    await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/modify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ removeLabelIds: ["UNREAD"] }),
    });
  } catch (e) {
    console.warn(`[batch] falha ao marcar email ${messageId} como lido:`, (e as Error).message);
  }
}

function jsonResp(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
