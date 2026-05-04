import { SUPABASE_URL, getServiceRole } from "../_shared/supabase-client.ts";

// =============================================================================
// EXTRAÇÃO DE PEDIDOS B2B BRASILEIROS A PARTIR DE PDF (via Claude Haiku 4.5)
//
// Arquitetura "Haiku na entrada" (Fase 2 do refator):
//   1. Cron lista emails Gmail com PDF anexo
//   2. Pra cada PDF: Haiku recebe PDF + layout do ERP do cliente (lista de
//      nomes de colunas) e devolve TRÊS estruturas em UM JSON:
//         a. canonicos       — 25 campos canônicos (cabeçalho do pedido)
//         b. itens_canonicos — array de itens (1 por produto)
//         c. linhas          — 1 entrada por item, chaves === nomes do
//                              layout do cliente (vai pra dados_layout)
//   3. Persiste:
//         - pedidos: spread de canonicos + dados_layout + metadata
//         - pedido_itens: 1 row por itens_canonicos[i]
//   4. Aprovador automático lê das colunas canônicas (intacto)
//   5. DE-PARA roda em pedido_itens.codigo_cliente (intacto)
//
// Confiança: calculada deterministicamente no código (não pela IA) com base
// em quantos dos 5 campos críticos vieram preenchidos.
// =============================================================================

// Whitelist defensiva: chaves esperadas em canonicos. Se Haiku retornar algo
// fora dessa lista, ignoramos (evita escrever colunas inesperadas no INSERT).
const CANONICOS_CHAVES = [
  "numero_pedido_cliente", "cnpj", "empresa",
  "nome_comprador", "email_comprador", "telefone_comprador",
  "data_emissao", "data_entrega_solicitada",
  "endereco_faturamento", "bairro_faturamento", "numero_faturamento",
  "cidade_faturamento", "estado_faturamento", "cep_faturamento",
  "endereco_entrega", "bairro_entrega", "cidade_entrega",
  "estado_entrega", "cep_entrega",
  "valor_total", "valor_frete", "transportadora", "forma_pagamento",
  "prazo_pagamento_dias", "observacoes_gerais",
] as const;

// Heurística de confiança determinística: 5 campos sem os quais o pedido
// é praticamente inútil. Se faltar 1 dos 5, score já cai pra 0.8.
const CRITICOS_CONFIANCA = [
  "numero_pedido_cliente", "cnpj", "valor_total",
  "nome_comprador", "data_emissao",
] as const;

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
   críticos foram preenchidos.`;

// deno-lint-ignore no-explicit-any
type AnyObj = Record<string, any>;

interface ColunaLayout {
  nome_coluna: string;
  tipo: "pedido" | "item";
  formato_data?: string | null;
}

interface RespostaHaiku {
  canonicos: AnyObj;
  itens_canonicos: AnyObj[];
  linhas: Record<string, string>[];
}

// ─────────────────────────────────────────────────────────────────────────
// Heurística de confiança (5 críticos preenchidos / 5)
// ─────────────────────────────────────────────────────────────────────────
function calcularConfianca(canonicos: AnyObj): number {
  const preenchidos = CRITICOS_CONFIANCA.filter((k) => {
    const v = canonicos[k];
    return v !== null && v !== undefined && v !== "";
  }).length;
  return preenchidos / CRITICOS_CONFIANCA.length;
}

// ─────────────────────────────────────────────────────────────────────────
// Anti-hallucination — aceita transformações triviais (data, CNPJ, número)
// ─────────────────────────────────────────────────────────────────────────
function normalizarParaHaystack(s: string): string {
  return s.replace(/[.\-/\s]/g, "");
}

function valorAceitavel(valor: string, haystack: string, haystackNormalizado: string): boolean {
  if (haystack.includes(valor)) return true;

  // Data DD/MM/YYYY ↔ YYYY-MM-DD
  const m1 = valor.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m1 && haystack.includes(`${m1[3]}-${m1[2]}-${m1[1]}`)) return true;
  const m2 = valor.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m2 && haystack.includes(`${m2[3]}/${m2[2]}/${m2[1]}`)) return true;

  // Número BR "1.234,56" ↔ 1234.56 / "12,5" ↔ 12.5
  const numBr = valor.match(/^-?\d{1,3}(\.\d{3})*,\d+$/);
  if (numBr) {
    const canon = valor.replace(/\./g, "").replace(",", ".");
    if (haystack.includes(canon)) return true;
  }
  const numSimples = valor.match(/^-?\d+,\d+$/);
  if (numSimples && haystack.includes(valor.replace(",", "."))) return true;

  // CNPJ/CPF/CEP — comparação sem pontuação. Cobre "12.345.678/0001-90"
  // ↔ "12345678000190" e CEP "95185-000" ↔ "95185000".
  const valorNorm = normalizarParaHaystack(valor);
  if (valorNorm.length >= 8 && /^\d+$/.test(valorNorm) && haystackNormalizado.includes(valorNorm)) {
    return true;
  }

  return false;
}

function validarAntiHallucination(
  resposta: RespostaHaiku,
  contexto: { pedido_id?: string; tenant_id?: string },
): void {
  const haystack = JSON.stringify(resposta.canonicos) + JSON.stringify(resposta.itens_canonicos);
  const haystackNorm = normalizarParaHaystack(haystack);
  const suspeitos: Array<{ linha: number; chave: string; valor: string }> = [];

  for (let i = 0; i < resposta.linhas.length; i++) {
    for (const [chave, valor] of Object.entries(resposta.linhas[i])) {
      if (!valor) continue;
      if (!valorAceitavel(valor, haystack, haystackNorm)) {
        suspeitos.push({ linha: i, chave, valor });
      }
    }
  }

  if (suspeitos.length > 0) {
    console.warn("[processar-email-pdf] valores suspeitos (não-literais) na resposta Haiku", {
      ...contexto,
      qtd: suspeitos.length,
      amostra: suspeitos.slice(0, 5),
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Validador estrutural (throw → bloqueia INSERT)
// ─────────────────────────────────────────────────────────────────────────
function validarEstrutural(parsed: unknown, layout: ColunaLayout[]): RespostaHaiku {
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Resposta da Haiku não é objeto JSON");
  }
  const obj = parsed as AnyObj;

  if (!obj.canonicos || typeof obj.canonicos !== "object" || Array.isArray(obj.canonicos)) {
    throw new Error("canonicos ausente ou não é objeto");
  }
  if (!Array.isArray(obj.itens_canonicos)) {
    throw new Error("itens_canonicos ausente ou não é array");
  }
  if (!Array.isArray(obj.linhas)) {
    throw new Error("linhas ausente ou não é array");
  }

  const esperadoLinhas = Math.max(obj.itens_canonicos.length, 1);
  if (obj.linhas.length !== esperadoLinhas) {
    throw new Error(
      `linhas.length=${obj.linhas.length}, esperado=${esperadoLinhas} (1 por item ou 1 se sem itens)`,
    );
  }

  const nomesLayout = new Set(layout.map((c) => c.nome_coluna));
  for (let i = 0; i < obj.linhas.length; i++) {
    const linha = obj.linhas[i];
    if (!linha || typeof linha !== "object" || Array.isArray(linha)) {
      throw new Error(`linhas[${i}] não é objeto`);
    }
    const chaves = new Set(Object.keys(linha));
    if (chaves.size !== nomesLayout.size) {
      throw new Error(`linhas[${i}]: ${chaves.size} chaves; esperado ${nomesLayout.size}`);
    }
    for (const nome of nomesLayout) {
      if (!chaves.has(nome)) throw new Error(`linhas[${i}]: falta chave "${nome}"`);
    }
  }

  // Coage tudo a string em linhas (Haiku pode emitir number ocasionalmente).
  const linhasNormalizadas: Record<string, string>[] = obj.linhas.map((l: AnyObj) => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(l)) {
      out[k] = v === null || v === undefined ? "" : String(v);
    }
    return out;
  });

  // Ignora canonicos.confianca se Haiku enviar (regra 9 do prompt).
  const canonicosLimpos: AnyObj = {};
  for (const k of CANONICOS_CHAVES) {
    canonicosLimpos[k] = obj.canonicos[k] ?? null;
  }

  return {
    canonicos: canonicosLimpos,
    itens_canonicos: obj.itens_canonicos,
    linhas: linhasNormalizadas,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Chamada Haiku com retry 1× em qualquer falha (HTTP, parse, validador)
// ─────────────────────────────────────────────────────────────────────────
function montarUserMessage(layout: ColunaLayout[]): string {
  const layoutTxt = layout
    .map((c, idx) => {
      const fmt = c.formato_data ? `   (formato: ${c.formato_data})` : "";
      return `${idx + 1}. [${c.tipo}] ${JSON.stringify(c.nome_coluna)}${fmt}`;
    })
    .join("\n");

  return `LAYOUT DO ERP DO CLIENTE (na ordem exata, repete por item):
${layoutTxt}

TAREFA:
Devolva JSON com 3 estruturas em UM único objeto:

{
  "canonicos": {
    "numero_pedido_cliente": "...",
    "cnpj": "...",
    "empresa": "...",
    "nome_comprador": "...",
    "email_comprador": "...",
    "telefone_comprador": "...",
    "data_emissao": "YYYY-MM-DD",
    "data_entrega_solicitada": "YYYY-MM-DD",
    "endereco_faturamento": "...",
    "bairro_faturamento": "...",
    "numero_faturamento": "...",
    "cidade_faturamento": "...",
    "estado_faturamento": "...",
    "cep_faturamento": "...",
    "endereco_entrega": "...",
    "bairro_entrega": "...",
    "cidade_entrega": "...",
    "estado_entrega": "...",
    "cep_entrega": "...",
    "valor_total": 0,
    "valor_frete": 0,
    "transportadora": "...",
    "forma_pagamento": "...",
    "prazo_pagamento_dias": 0,
    "observacoes_gerais": "..."
  },
  "itens_canonicos": [
    {
      "numero_item": 1,
      "codigo_cliente": "...",
      "descricao": "...",
      "quantidade": 0,
      "preco_unitario": 0,
      "preco_total": 0,
      "ean": "..."
    }
  ],
  "linhas": [
    { "Nome Coluna 1": "valor", "Nome Coluna 2": "valor", ... }
  ]
}

Cada linha deve ter EXATAMENTE as ${layout.length} chaves do layout, na
ordem listada acima. Para colunas tipo [pedido]: mesmo valor em todas as
linhas. Para colunas tipo [item]: valor específico do item N. Use ""
para coluna sem dado correspondente. NUNCA invente.`;
}

async function chamarHaiku(
  pdfBase64: string,
  userMsg: string,
  claudeKey: string,
): Promise<string> {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": claudeKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
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
    }),
  });
  const json = await r.json();
  if (!r.ok) {
    throw new Error(`Haiku HTTP ${r.status}: ${json?.error?.message ?? "sem mensagem"}`);
  }
  const texto = json?.content?.[0]?.text;
  if (typeof texto !== "string") {
    throw new Error("Haiku retornou resposta sem content[0].text");
  }
  return texto.replace(/```json|```/g, "").trim();
}

async function extrairComHaiku(
  pdfBase64: string,
  layout: ColunaLayout[],
  claudeKey: string,
  contexto: { tenant_id: string; gmail_message_id: string },
): Promise<RespostaHaiku> {
  const userMsg = montarUserMessage(layout);
  let ultimoErro: Error | null = null;

  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    try {
      const raw = await chamarHaiku(pdfBase64, userMsg, claudeKey);
      const parsed = JSON.parse(raw);
      const resposta = validarEstrutural(parsed, layout);
      validarAntiHallucination(resposta, contexto);
      if (tentativa > 1) {
        console.log("[processar-email-pdf] sucesso no retry", contexto);
      }
      return resposta;
    } catch (e) {
      ultimoErro = e as Error;
      console.warn(`[processar-email-pdf] tentativa ${tentativa} falhou: ${ultimoErro.message}`, contexto);
    }
  }
  throw new Error(`extracao_haiku_falhou: ${ultimoErro?.message ?? "desconhecido"}`);
}

// ─────────────────────────────────────────────────────────────────────────
// Layout do tenant — colunas declaradas em tenant_erp_config
// ─────────────────────────────────────────────────────────────────────────
async function buscarLayoutDoTenant(
  tenantId: string,
  serviceRole: string,
): Promise<ColunaLayout[] | null> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/tenant_erp_config?tenant_id=eq.${tenantId}&select=mapeamento_campos`,
    { headers: { apikey: serviceRole, Authorization: `Bearer ${serviceRole}` } },
  );
  if (!res.ok) return null;
  const rows = await res.json();
  const colunas: AnyObj[] = rows?.[0]?.mapeamento_campos?.colunas ?? [];
  if (!Array.isArray(colunas) || colunas.length === 0) return null;
  return colunas
    .filter((c) => c?.nome_coluna)
    .map((c) => ({
      nome_coluna: String(c.nome_coluna),
      tipo: c.tipo === "item" ? "item" : "pedido",
      formato_data: c.formato_data ?? null,
    }));
}

// ─────────────────────────────────────────────────────────────────────────
// Persistência: monta INSERT em pedidos a partir de canonicos + linhas
// ─────────────────────────────────────────────────────────────────────────
interface MontarInsertBodyArgs {
  tenantId: string;
  gmailMessageId: string;
  canonicos: AnyObj;
  linhas: Record<string, string>[];
  varejo: { email: string; fonte: string };
  emailRemetente: string | null;
  emailFrom: string | null;
  assunto: string;
  pdfUrl: string | null;
  pdfHash: string | null;
}

function montarInsertBody(args: MontarInsertBodyArgs): AnyObj {
  const { tenantId, gmailMessageId, canonicos, linhas, varejo,
    emailRemetente, emailFrom, assunto, pdfUrl, pdfHash } = args;

  // Whitelist defensiva: só copia chaves de CANONICOS_CHAVES.
  const dadosCanonicos: AnyObj = {};
  for (const k of CANONICOS_CHAVES) {
    const v = canonicos[k];
    if (v !== null && v !== undefined && v !== "") dadosCanonicos[k] = v;
  }

  // Empresa: fallback pro varejo email se IA não extraiu (único contato confiável).
  if (!dadosCanonicos.empresa) dadosCanonicos.empresa = emailRemetente ?? null;

  return {
    tenant_id: tenantId,
    gmail_message_id: gmailMessageId,
    email_remetente: varejo.email,
    remetente_email: varejo.email,
    remetente_origem: varejo.fonte,
    email_envelope_from: emailFrom || null,
    assunto_email: assunto,
    canal_entrada: "email",
    pdf_url: pdfUrl,
    pdf_hash: pdfHash,
    confianca_ia: calcularConfianca(canonicos),
    status: "pendente",
    json_ia_bruto: { canonicos, linhas_count: linhas.length }, // mantido pra auditoria
    dados_layout: { linhas },
    ...dadosCanonicos,
  };
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const serviceRole = getServiceRole();
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
          tenant_id: config.tenant_id, severidade: "alta",
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
  opts: { detalhes?: AnyObj; tenant_id?: string | null; severidade?: "baixa" | "media" | "alta" | "critica" } = {},
): Promise<void> {
  try {
    const sr = getServiceRole();
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

async function processarTenant(config: AnyObj, serviceRole: string, claudeKey: string) {
  // Pré-check: tenant precisa de layout configurado pra extração funcionar.
  // Skip o tenant inteiro se faltar — emails NÃO são marcados como lidos
  // no Gmail, então próxima execução do cron retenta automaticamente após
  // o admin configurar o layout. Evita gastar Gmail-fetch + Haiku-call em
  // 50 emails sabendo que todos falhariam.
  const layout = await buscarLayoutDoTenant(config.tenant_id, serviceRole);
  if (!layout) {
    console.warn(`[skip-tenant] ${config.tenant_id}: sem layout ERP configurado`);
    await registrarErro(
      "tenant_sem_layout", "processar-email-pdf",
      `Tenant ${config.tenant_id} sem layout ERP configurado em tenant_erp_config.mapeamento_campos. Pedidos não serão processados até admin subir layout em /integracoes.`,
      { tenant_id: config.tenant_id, severidade: "alta" },
    );
    return { skipped: true, motivo: "sem_layout" };
  }

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
      await processarEmail(msg.id, accessToken, config, layout, serviceRole, claudeKey);
      processados++;
    } catch (e) {
      const errMsg = (e as Error).message;
      console.error(`Erro no email ${msg.id}:`, errMsg);
      await registrarErro("edge_function_error", "processar-email-pdf",
        `Erro no email ${msg.id}: ${errMsg}`, {
          tenant_id: config.tenant_id, severidade: "media",
          detalhes: { gmail_message_id: msg.id, stack: (e as Error).stack },
        });
      if (!errMsg.includes("usage limits")) {
        await criarNotificacaoErroLeitura(config.tenant_id, msg.id, serviceRole);
      }
    }
  }
  return { emails_processados: processados };
}

async function getAccessToken(config: AnyObj, serviceRole: string): Promise<string> {
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

async function marcarGmailDesconectado(config: AnyObj, serviceRole: string) {
  const jaAlertado = !!config.alerta_desconexao_enviado;
  const patchBody: AnyObj = { ativo: false };
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

async function chamarFuncao(nome: string, body: AnyObj, serviceRole: string) {
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

async function salvarPdfNoStorage(
  pdfBase64: string, filename: string, tenantId: string, serviceRole: string,
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
 * passou no caminho. Cadeia de prioridade detalhada na docstring
 * histórica do projeto.
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
    if (match && match.index !== undefined) {
      corpoOriginal = corpo.slice(match.index + match[0].length);
      break;
    }
  }
  const padroes = [
    /^\s*De:\s*[^<\n]*<([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})>/im,
    /^\s*From:\s*[^<\n]*<([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})>/im,
    /^\s*De:\s*([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/im,
    /^\s*From:\s*([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/im,
  ];
  for (const padrao of padroes) {
    const match = corpoOriginal.match(padrao);
    if (match) return match[1].trim().toLowerCase();
  }
  const todosEmails: string[] = [];
  const regexGlobal = /(?:De|From):\s*[^<\n]*<([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})>/gim;
  let m;
  while ((m = regexGlobal.exec(corpo)) !== null) todosEmails.push(m[1].trim().toLowerCase());
  if (todosEmails.length > 0) return todosEmails[todosEmails.length - 1];
  return null;
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

function decodificarBase64Gmail(data: string): string {
  const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
  try { return atob(base64); } catch { return ""; }
}

function extrairCorpoEmail(payload: AnyObj): string {
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

// ─────────────────────────────────────────────────────────────────────────
// Loop principal por email — extração + persistência + DE-PARA + aprovador
// ─────────────────────────────────────────────────────────────────────────
async function processarEmail(
  messageId: string,
  accessToken: string,
  config: AnyObj,
  layout: ColunaLayout[],
  serviceRole: string,
  claudeKey: string,
) {
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
    (headers.find((h: AnyObj) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "") as string;

  const assunto = headerVal("Subject");
  const de = headerVal("From");
  const replyTo = headerVal("Reply-To");
  const xOriginalFrom =
    headerVal("X-Original-From") || headerVal("X-Forwarded-From") || headerVal("X-Original-Sender");
  const senderHeader = headerVal("Sender");
  const deliveredTo = headerVal("Delivered-To");
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

  const senderDifere = !!senderHeader && extrairEmail(senderHeader) !== emailFrom;
  const deliveredDifere = !!emailDelivered && !!emailTo && emailDelivered !== emailTo;
  const encaminhado =
    isEncaminhado(assunto) ||
    !!xOriginalFrom ||
    !!resentFrom || !!resentSender ||
    /auto-?forwarded/i.test(autoSubmitted) ||
    deliveredDifere ||
    senderDifere;

  console.log("Email encaminhado:", encaminhado, "Assunto:", assunto);

  let emailOriginalDoCorpo: string | null = null;
  const corpo = extrairCorpoEmail(email.payload);
  if (encaminhado && corpo) {
    emailOriginalDoCorpo = extrairEmailDoCorpo(corpo);
  }

  const emailRemetente = emailXOriginal ?? emailResent ?? emailOriginalDoCorpo ?? emailReplyTo ?? emailFrom;

  const pdfs = coletarPdfs(email.payload);
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

    const pdfUrl = await salvarPdfNoStorage(pdfBase64, pdf.filename ?? "pedido.pdf", config.tenant_id, serviceRole);
    console.log("PDF salvo no storage:", pdfUrl);

    const pdfHash = await calcularPdfHash(pdfBase64);

    console.log("Chamando Haiku...");
    const resposta = await extrairComHaiku(pdfBase64, layout, claudeKey, {
      tenant_id: config.tenant_id,
      gmail_message_id: messageId,
    });

    const { canonicos, itens_canonicos: itensCanonicos, linhas } = resposta;
    console.log(
      `[EXTRAÇÃO] confianca=${calcularConfianca(canonicos).toFixed(2)} | itens=${itensCanonicos.length} | linhas=${linhas.length}`,
    );

    // Resolve o varejo original (cadeia de fallback). Email da IA vem dos
    // canônicos.
    const varejo = identificarVarejoOriginal({
      xOriginal: emailXOriginal,
      resent: emailResent,
      from: emailFrom || null,
      replyTo: emailReplyTo,
      body: emailOriginalDoCorpo,
      iaCompradorEmail: canonicos.email_comprador ?? null,
      iaRemetenteEmail: null,
    });
    console.log(`Varejo original: ${varejo.email} (fonte=${varejo.fonte})`);

    // INSERT pedidos.
    const pedidoRes = await fetch(`${SUPABASE_URL}/rest/v1/pedidos`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceRole,
        Authorization: `Bearer ${serviceRole}`,
        // ignore-duplicates: race com outra invocação concorrente do mesmo
        // gmail_message_id (UNIQUE parcial). INSERT volta vazio em vez de
        // 409 → tratamos como "alguém já cuidou disso".
        Prefer: "return=representation,resolution=ignore-duplicates",
      },
      body: JSON.stringify(montarInsertBody({
        tenantId: config.tenant_id,
        gmailMessageId: messageId,
        canonicos, linhas, varejo,
        emailRemetente, emailFrom, assunto, pdfUrl, pdfHash,
      })),
    });

    const pedidoStatus = pedidoRes.status;
    const pedidoJson = await pedidoRes.json();
    if (!pedidoRes.ok) {
      console.error("[INSERT ERRO]", pedidoStatus, JSON.stringify(pedidoJson).substring(0, 500));
      await registrarErro("insert_pedido_falhou", "processar-email-pdf",
        `INSERT retornou ${pedidoStatus}: ${JSON.stringify(pedidoJson).substring(0, 300)}`,
        { tenant_id: config.tenant_id, severidade: "alta",
          detalhes: { gmail_message_id: messageId, canonicos } });
      continue;
    }
    const pedidoId = pedidoJson[0]?.id;
    if (!pedidoId) {
      console.log("[INSERT] Pedido já existe para este gmail_message_id — deduplicado.");
      continue;
    }
    console.log("[INSERT] Pedido salvo:", pedidoId);

    // INSERT pedido_itens — 7 campos canônicos por item.
    if (itensCanonicos.length > 0) {
      await fetch(`${SUPABASE_URL}/rest/v1/pedido_itens`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: serviceRole,
          Authorization: `Bearer ${serviceRole}`,
        },
        body: JSON.stringify(itensCanonicos.map((item, idx) => ({
          pedido_id: pedidoId,
          tenant_id: config.tenant_id,
          numero_item: item.numero_item ?? idx + 1,
          codigo_cliente: item.codigo_cliente ?? null,
          descricao: item.descricao ?? null,
          quantidade: item.quantidade ?? 0,
          preco_unitario: item.preco_unitario ?? null,
          preco_total: item.preco_total ?? null,
          ean: item.ean ?? null,
        }))),
      });
    }

    // Detecção de duplicado (hash + numero+cnpj).
    const validacaoDuplicidade = await lerConfigBoolean(
      config.tenant_id, "validacao_duplicidade_ativa", true, serviceRole,
    );
    const isDuplicado = validacaoDuplicidade
      ? await verificarDuplicado(
          {
            numeroPedido: canonicos.numero_pedido_cliente ?? null,
            cnpj: canonicos.cnpj ?? null,
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
      await criarNotificacaoDuplicado(config.tenant_id, canonicos.numero_pedido_cliente ?? "", serviceRole);
    } else {
      const cfgAutoRes = await fetch(
        `${SUPABASE_URL}/rest/v1/configuracoes?tenant_id=eq.${config.tenant_id}&chave=in.(aprovacao_automatica,confianca_minima_aprovacao,valor_maximo_aprovacao_automatica,quantidade_maxima_item_automatica,comportamento_codigo_novo)&select=chave,valor`,
        { headers: { apikey: serviceRole, Authorization: `Bearer ${serviceRole}` } },
      );
      const cfgsAuto = await cfgAutoRes.json();
      const cfgAutoMap = new Map(cfgsAuto.map((c: AnyObj) => [c.chave, c.valor]));
      const comportamento = (cfgAutoMap.get("comportamento_codigo_novo") ?? "aprovar_parcial") as
        | "bloquear" | "aprovar_original" | "aprovar_parcial";

      const pendentesCount = await aplicarDeParaELevantarPendencias(
        pedidoId, config.tenant_id, serviceRole,
      );

      let statusFinal: string | null = null;
      if (pendentesCount > 0) {
        if (comportamento === "bloquear") statusFinal = "aguardando_de_para";
        else if (comportamento === "aprovar_parcial") statusFinal = "aprovado_parcial";
        await criarNotificacaoCodigosNovos(config.tenant_id, pedidoId, pendentesCount, serviceRole);
      }

      if (statusFinal) {
        await fetch(`${SUPABASE_URL}/rest/v1/pedidos?id=eq.${pedidoId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", apikey: serviceRole, Authorization: `Bearer ${serviceRole}` },
          body: JSON.stringify({ status: statusFinal }),
        });
        await chamarFuncao("enviar-notificacao-email", { pedido_id: pedidoId, status: statusFinal }, serviceRole);
      } else {
        const itensSalvos = await buscarItensPedido(pedidoId, serviceRole);

        // Aprovador automático lê de "dadosPedido" no formato legado
        // (numero_pedido, data_pedido, confianca). Adapter mantém aprovador
        // intacto sem mexer na lógica de negócio.
        const dadosPedidoLegado = {
          ...canonicos,
          confianca: calcularConfianca(canonicos),
          numero_pedido: canonicos.numero_pedido_cliente,
          data_pedido: canonicos.data_emissao,
        };

        const avaliacao = avaliarAprovacaoAutomatica({
          dadosPedido: dadosPedidoLegado,
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
          await chamarFuncao("enviar-notificacao-email", { pedido_id: pedidoId, status: "pendente" }, serviceRole);
        }
      }
    }

    // Marca email como lido apenas após persistência completa do pedido.
    await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/modify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ removeLabelIds: ["UNREAD"] }),
    });

    console.log("Email processado com sucesso!");
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Aprovador automático — INTACTO desde a versão anterior. Continua lendo
// do "dadosPedido" no formato legado (adapter constrói no call site).
// ─────────────────────────────────────────────────────────────────────────
interface AvaliacaoAprovacaoAutomatica {
  aprovado: boolean;
  regraReprovada?: string;
  motivo?: string;
  metadata: AnyObj;
}

function avaliarAprovacaoAutomatica(opts: {
  dadosPedido: AnyObj;
  itens: Array<{ quantidade?: number | null; preco_total?: number | null; codigo_produto_erp?: string | null }>;
  pendentesCount: number;
  cfg: Map<string, string>;
}): AvaliacaoAprovacaoAutomatica {
  const { dadosPedido, itens, pendentesCount, cfg } = opts;

  const aprovacaoAutomatica = cfg.get("aprovacao_automatica") === "true";
  const confiancaMinPct = parseNumOrNull(cfg.get("confianca_minima_aprovacao"));
  const valorMaximo = parseNumOrNull(cfg.get("valor_maximo_aprovacao_automatica"));
  const qtdMaxima = parseNumOrNull(cfg.get("quantidade_maxima_item_automatica"));

  const confiancaPedido = Number(dadosPedido.confianca ?? 0);
  const numeroPedido = String(dadosPedido.numero_pedido ?? "").trim();
  const cnpj = String(dadosPedido.cnpj ?? "").trim();
  const dataPedido = dadosPedido.data_pedido ?? dadosPedido.data_emissao ?? null;
  const valorTotal = Number(dadosPedido.valor_total ?? 0);
  const somaItens = itens.reduce((acc, it) => acc + Number(it.preco_total ?? 0), 0);
  const tolerancia = Math.max(0.01, valorTotal * 0.005);

  const regrasOk: string[] = [];
  const metadata: AnyObj = {
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

  if (!aprovacaoAutomatica) return reprovar("toggle_ativo", "aprovacao_automatica desligada");
  regrasOk.push("toggle_ativo");

  if (confiancaMinPct === null) return reprovar("confianca_suficiente", "confianca_minima_aprovacao não configurada");
  if (confiancaPedido * 100 < confiancaMinPct) {
    return reprovar("confianca_suficiente", `confiança ${(confiancaPedido * 100).toFixed(1)}% < mínimo ${confiancaMinPct}%`);
  }
  regrasOk.push("confianca_suficiente");

  if (pendentesCount > 0) return reprovar("todos_itens_com_de_para", `${pendentesCount} item(ns) sem DE-PARA`);
  regrasOk.push("todos_itens_com_de_para");

  if (!numeroPedido) return reprovar("numero_pedido_legivel", "numero_pedido_cliente vazio");
  regrasOk.push("numero_pedido_legivel");

  if (valorMaximo === null) return reprovar("valor_dentro_do_limite", "valor_maximo_aprovacao_automatica não configurado");
  if (valorTotal > valorMaximo) return reprovar("valor_dentro_do_limite", `valor ${valorTotal} > limite ${valorMaximo}`);
  regrasOk.push("valor_dentro_do_limite");

  if (qtdMaxima === null) return reprovar("quantidade_itens_dentro_do_limite", "quantidade_maxima_item_automatica não configurada");
  const itemAcimaLimite = itens.find((it) => Number(it.quantidade ?? 0) > qtdMaxima);
  if (itemAcimaLimite) {
    return reprovar("quantidade_itens_dentro_do_limite", `item com quantidade ${itemAcimaLimite.quantidade} > limite ${qtdMaxima}`);
  }
  regrasOk.push("quantidade_itens_dentro_do_limite");

  const camposFalhando: string[] = [];
  if (!cnpj) camposFalhando.push("cnpj");
  if (!dataPedido) camposFalhando.push("data_pedido");
  if (itens.length === 0) camposFalhando.push("itens");
  if (!(valorTotal > 0)) camposFalhando.push("valor_total>0");
  if (valorTotal > 0 && Math.abs(valorTotal - somaItens) > tolerancia) {
    camposFalhando.push(`valor_total~soma (diff ${(valorTotal - somaItens).toFixed(2)})`);
  }
  if (camposFalhando.length > 0) return reprovar("campos_obrigatorios_completos", `faltando: ${camposFalhando.join(", ")}`);
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
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/pedido_itens?pedido_id=eq.${pedidoId}&select=quantidade,preco_total,codigo_produto_erp`,
      { headers: { apikey: serviceRole, Authorization: `Bearer ${serviceRole}` }, signal: ctrl.signal },
    );
    if (!res.ok) {
      console.error("Falha ao buscar itens p/ aprovação automática:", await res.text());
      return [];
    }
    return await res.json();
  } catch (e) {
    console.error(`buscarItensPedido falhou:`, (e as Error).message);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

async function registrarAprovacaoAutomatica(
  opts: {
    pedidoId: string; tenantId: string;
    tipoEvento: "aprovacao_automatica" | "aprovacao_automatica_recusada";
    valorAnterior: string | null; valorNovo: string;
    metadata: AnyObj;
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
  if (!res.ok) console.error("Falha ao gravar pedido_logs:", await res.text());
}

async function aplicarDeParaELevantarPendencias(
  pedidoId: string,
  tenantId: string,
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

    let sugestoes: AnyObj[] = [];
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
  if (!res.ok) console.error(`Falha ao criar notificação ${opts.tipo}:`, await res.text());
}

async function criarNotificacaoCodigosNovos(
  tenantId: string, _pedidoId: string, qtd: number, serviceRole: string,
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
  tenantId: string, numeroPedido: string, serviceRole: string,
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

async function criarNotificacaoErroLeitura(
  tenantId: string, gmailMessageId: string, serviceRole: string,
): Promise<void> {
  // Guard: não criar duplicata se já existe notificação erro_leitura não lida para o tenant.
  const checkRes = await fetch(
    `${SUPABASE_URL}/rest/v1/notificacoes_painel?tenant_id=eq.${tenantId}&tipo=eq.erro_leitura&lida=eq.false&select=id&limit=1`,
    { headers: { apikey: serviceRole, Authorization: `Bearer ${serviceRole}` } },
  );
  if (checkRes.ok) {
    const existing = await checkRes.json();
    if (Array.isArray(existing) && existing.length > 0) return;
  }
  await criarNotificacaoTenant({
    tenantId,
    tipo: "erro_leitura",
    titulo: "Erro ao ler pedido",
    mensagem: "Um email com PDF não pôde ser processado automaticamente.",
    link: "/admin/erros",
    serviceRole,
  });
}
