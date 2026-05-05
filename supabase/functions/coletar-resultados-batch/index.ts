// coletar-resultados-batch
// Percorre todos os registros em processamento_batch com status "enviado" ou
// "processando", verifica se o batch terminou na Anthropic Batch API, e para
// cada batch concluído processa os resultados: valida estrutura, persiste
// pedidos/itens, aplica DE-PARA, aprovação automática e marca emails como lidos.
// Deve ser chamada pelo cron periodicamente (ex: a cada 5 min).

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
}

interface RespostaHaiku {
  canonicos: AnyObj;
  itens_canonicos: AnyObj[];
  linhas: Record<string, string>[];
}

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

const CRITICOS_CONFIANCA = [
  "numero_pedido_cliente", "cnpj", "valor_total",
  "nome_comprador", "data_emissao",
] as const;

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

    const resultado = await coletarResultados(serviceRole, claudeKey);
    return jsonResp(200, resultado);
  } catch (e) {
    console.error("Erro em coletar-resultados-batch:", (e as Error).message);
    return jsonResp(500, { error: (e as Error).message });
  }
});

async function coletarResultados(serviceRole: string, claudeKey: string): Promise<AnyObj> {
  // 1. Busca batches pendentes (enviado ou processando).
  const batchRes = await fetch(
    `${SUPABASE_URL}/rest/v1/processamento_batch?status=in.(enviado,processando)&select=*&order=created_at.asc&limit=20`,
    { headers: { apikey: serviceRole, Authorization: `Bearer ${serviceRole}` } },
  );
  if (!batchRes.ok) {
    throw new Error(`Falha ao listar batches: ${await batchRes.text()}`);
  }
  const batches: AnyObj[] = await batchRes.json();
  console.log(`[coletar-batch] batches pendentes: ${batches.length}`);

  if (batches.length === 0) return { skipped: true, motivo: "nenhum_batch_pendente" };

  const resumo: AnyObj[] = [];

  for (const batch of batches) {
    try {
      const res = await processarBatch(batch, serviceRole, claudeKey);
      resumo.push({ batch_id: batch.batch_id, ...res });
    } catch (e) {
      console.error(`[coletar-batch] erro no batch ${batch.batch_id}:`, (e as Error).message);
      resumo.push({ batch_id: batch.batch_id, erro: (e as Error).message });
      await atualizarBatch(batch.id, { status: "erro", erro_msg: (e as Error).message }, serviceRole);
    }
  }

  return { processados: resumo };
}

async function processarBatch(batch: AnyObj, serviceRole: string, claudeKey: string): Promise<AnyObj> {
  const batchId: string = batch.batch_id;
  const tenantId: string = batch.tenant_id;
  const gmailMessageIds: string[] = batch.gmail_message_ids ?? [];

  // 2. Consulta status do batch na Anthropic.
  const anthropicRes = await fetch(`https://api.anthropic.com/v1/messages/batches/${batchId}`, {
    headers: {
      "x-api-key": claudeKey,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "message-batches-2024-09-24",
    },
  });

  if (!anthropicRes.ok) {
    const err = await anthropicRes.json();
    throw new Error(`Anthropic HTTP ${anthropicRes.status}: ${err?.error?.message ?? "sem mensagem"}`);
  }

  const batchStatus = await anthropicRes.json();
  const processingStatus: string = batchStatus.processing_status;
  console.log(`[coletar-batch] batch_id=${batchId} status=${processingStatus}`);

  // Atualiza status local para refletir o estado atual.
  if (processingStatus === "in_progress") {
    await atualizarBatch(batch.id, { status: "processando" }, serviceRole);
    return { status: "em_andamento" };
  }

  if (processingStatus === "ended") {
    // Batch expirou sem processar (Anthropic expira após 24h).
    if (batchStatus.request_counts?.errored === batchStatus.request_counts?.processing + batchStatus.request_counts?.succeeded + batchStatus.request_counts?.errored) {
      await atualizarBatch(batch.id, { status: "expirado", concluido_em: new Date().toISOString() }, serviceRole);
      return { status: "expirado" };
    }
  }

  if (processingStatus !== "ended") {
    return { status: processingStatus };
  }

  // 3. Batch concluído — baixa resultados.
  const resultsUrl = batchStatus.results_url;
  if (!resultsUrl) {
    throw new Error(`Batch ${batchId} ended mas sem results_url`);
  }

  const resultsRes = await fetch(resultsUrl, {
    headers: {
      "x-api-key": claudeKey,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "message-batches-2024-09-24",
    },
  });
  if (!resultsRes.ok) {
    throw new Error(`Falha ao baixar resultados do batch: HTTP ${resultsRes.status}`);
  }

  // Resultados chegam em formato JSONL (uma linha por resultado).
  const rawText = await resultsRes.text();
  const linhas = rawText.trim().split("\n").filter((l) => l.trim());

  // 4. Busca layout do tenant para validação.
  const layout = await buscarLayoutDoTenant(tenantId, serviceRole);
  if (!layout) {
    await atualizarBatch(batch.id, {
      status: "erro",
      erro_msg: "Layout ERP não encontrado para tenant",
      concluido_em: new Date().toISOString(),
    }, serviceRole);
    return { status: "erro", motivo: "sem_layout" };
  }

  // 5. Busca token de acesso Gmail para marcar emails como lidos.
  const gmailRes = await fetch(
    `${SUPABASE_URL}/rest/v1/tenant_gmail_config?tenant_id=eq.${tenantId}&select=*`,
    { headers: { apikey: serviceRole, Authorization: `Bearer ${serviceRole}` } },
  );
  const gmailRows = await gmailRes.json();
  const gmailConfig = gmailRows?.[0];
  let accessToken: string | null = null;
  if (gmailConfig?.ativo) {
    try {
      accessToken = await getAccessToken(gmailConfig, tenantId, serviceRole);
    } catch (e) {
      console.warn(`[coletar-batch] falha ao renovar token Gmail tenant=${tenantId}:`, (e as Error).message);
    }
  }

  // 6. Processa cada resultado.
  let sucesso = 0;
  let erro = 0;
  const erroMsgs: string[] = [];

  for (const linha of linhas) {
    let resultado: AnyObj;
    try {
      resultado = JSON.parse(linha);
    } catch {
      const jsonErrMsg = `Linha JSONL inválida: ${linha.substring(0, 200)}`;
      console.warn("[coletar-batch]", jsonErrMsg);
      await registrarErro("batch_jsonl_invalido", "coletar-resultados-batch", jsonErrMsg, {
        tenant_id: tenantId,
        severidade: "media",
        detalhes: { batch_id: batchId },
      });
      erroMsgs.push(jsonErrMsg.substring(0, 150));
      erro++;
      continue;
    }

    const customId: string = resultado.custom_id; // = gmail_message_id
    const type: string = resultado.result?.type;

    if (!customId) {
      const semIdMsg = `Resultado sem custom_id: ${JSON.stringify(resultado).substring(0, 100)}`;
      console.warn("[coletar-batch]", semIdMsg);
      await registrarErro("batch_sem_custom_id", "coletar-resultados-batch", semIdMsg, {
        tenant_id: tenantId,
        severidade: "media",
        detalhes: { batch_id: batchId },
      });
      erroMsgs.push(semIdMsg.substring(0, 150));
      erro++;
      continue;
    }

    if (type === "errored") {
      const errMsg = resultado.result?.error?.message ?? "erro desconhecido";
      console.error(`[coletar-batch] erro para msgId=${customId}: ${errMsg}`);
      await registrarErro("batch_item_erro", "coletar-resultados-batch", errMsg, {
        tenant_id: tenantId,
        severidade: "media",
        detalhes: { gmail_message_id: customId, batch_id: batchId },
      });
      if (accessToken) await marcarEmailLido(customId, accessToken);
      erroMsgs.push(`msgId=${customId}: ${errMsg}`.substring(0, 150));
      erro++;
      continue;
    }

    if (type !== "succeeded") {
      const typeMsg = `Tipo inesperado "${type ?? "undefined"}" para msgId=${customId}`;
      console.error("[coletar-batch]", typeMsg);
      await registrarErro("batch_tipo_inesperado", "coletar-resultados-batch", typeMsg, {
        tenant_id: tenantId,
        severidade: "media",
        detalhes: { gmail_message_id: customId, batch_id: batchId, type_recebido: type ?? null },
      });
      if (accessToken) await marcarEmailLido(customId, accessToken);
      erroMsgs.push(typeMsg);
      erro++;
      continue;
    }

    const texto: string = resultado.result?.message?.content?.[0]?.text ?? "";
    const raw = texto.replace(/```json|```/g, "").trim();

    try {
      await processarResultadoBatch({
        gmailMessageId: customId,
        raw,
        layout,
        tenantId,
        serviceRole,
        accessToken,
        batchId,
      });
      sucesso++;
    } catch (e) {
      const persistMsg = `Falha ao persistir msgId=${customId}: ${(e as Error).message}`;
      console.error("[coletar-batch]", persistMsg);
      await registrarErro("batch_persist_erro", "coletar-resultados-batch", (e as Error).message, {
        tenant_id: tenantId,
        severidade: "alta",
        detalhes: { gmail_message_id: customId, batch_id: batchId },
      });
      if (accessToken) await marcarEmailLido(customId, accessToken);
      erroMsgs.push(persistMsg.substring(0, 150));
      erro++;
    }
  }

  // 7. Atualiza registro do batch como concluído.
  await atualizarBatch(batch.id, {
    status: "concluido",
    emails_sucesso: sucesso,
    emails_erro: erro,
    concluido_em: new Date().toISOString(),
    ...(erro > 0 && erroMsgs.length > 0
      ? { erro_msg: erroMsgs.join(" | ").substring(0, 500) }
      : {}),
  }, serviceRole);

  console.log(`[coletar-batch] batch_id=${batchId} concluído: sucesso=${sucesso} erro=${erro}`);
  return { status: "concluido", sucesso, erro };
}

async function processarResultadoBatch(args: {
  gmailMessageId: string;
  raw: string;
  layout: ColunaLayout[];
  tenantId: string;
  serviceRole: string;
  accessToken: string | null;
  batchId: string;
}): Promise<void> {
  const { gmailMessageId, raw, layout, tenantId, serviceRole, accessToken } = args;

  // Dedup: já existe pedido para este gmail_message_id?
  const dedupRes = await fetch(
    `${SUPABASE_URL}/rest/v1/pedidos?tenant_id=eq.${tenantId}&gmail_message_id=eq.${gmailMessageId}&select=id&limit=1`,
    { headers: { apikey: serviceRole, Authorization: `Bearer ${serviceRole}` } },
  );
  if (dedupRes.ok) {
    const rows = await dedupRes.json();
    if (Array.isArray(rows) && rows.length > 0) {
      console.log(`[coletar-batch] msgId=${gmailMessageId} já existe — pulando`);
      if (accessToken) await marcarEmailLido(gmailMessageId, accessToken);
      return;
    }
  }

  // Parse e validação estrutural.
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`JSON inválido da Haiku: ${raw.substring(0, 100)}`);
  }

  const parsedObj = parsed as AnyObj;

  // Pedido não-pedido (regra 10 do prompt).
  if (parsedObj.nao_e_pedido === true) {
    console.log(`[coletar-batch] msgId=${gmailMessageId} classificado como não-pedido`);
    if (accessToken) await marcarEmailLido(gmailMessageId, accessToken);
    return;
  }

  const resposta = validarEstrutural(parsed, layout);

  // INSERT pedidos — apenas campos canônicos do batch (sem metadata de email
  // pois não baixamos o email completo neste ponto, apenas processamos o PDF).
  const { canonicos, itens_canonicos: itensCanonicos, linhas } = resposta;
  const confianca = calcularConfianca(canonicos);

  const dadosCanonicos: AnyObj = {};
  for (const k of CANONICOS_CHAVES) {
    const v = canonicos[k];
    if (v !== null && v !== undefined && v !== "") dadosCanonicos[k] = v;
  }

  const pedidoBody: AnyObj = {
    tenant_id: tenantId,
    gmail_message_id: gmailMessageId,
    canal_entrada: "email",
    confianca_ia: confianca,
    status: "pendente",
    json_ia_bruto: { canonicos, linhas_count: linhas.length },
    dados_layout: { linhas },
    ...dadosCanonicos,
  };

  const pedidoRes = await fetch(`${SUPABASE_URL}/rest/v1/pedidos`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: serviceRole,
      Authorization: `Bearer ${serviceRole}`,
      Prefer: "return=representation,resolution=ignore-duplicates",
    },
    body: JSON.stringify(pedidoBody),
  });

  if (!pedidoRes.ok) {
    const errText = await pedidoRes.text();
    throw new Error(`INSERT pedido falhou HTTP ${pedidoRes.status}: ${errText.substring(0, 300)}`);
  }

  const pedidoJson = await pedidoRes.json();
  const pedidoId = pedidoJson[0]?.id;
  if (!pedidoId) {
    // Deduplicado por race condition — ok.
    console.log(`[coletar-batch] msgId=${gmailMessageId} deduplicado no INSERT`);
    if (accessToken) await marcarEmailLido(gmailMessageId, accessToken);
    return;
  }

  // INSERT pedido_itens.
  if (itensCanonicos.length > 0) {
    await fetch(`${SUPABASE_URL}/rest/v1/pedido_itens`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceRole,
        Authorization: `Bearer ${serviceRole}`,
      },
      body: JSON.stringify(itensCanonicos.map((item: AnyObj, idx: number) => ({
        pedido_id: pedidoId,
        tenant_id: tenantId,
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

  // Duplicado por hash + numero+cnpj.
  const isDuplicado = await verificarDuplicado({
    numeroPedido: canonicos.numero_pedido_cliente ?? null,
    cnpj: canonicos.cnpj ?? null,
    pedidoAtualId: pedidoId,
    tenantId,
  }, serviceRole);

  if (isDuplicado) {
    await fetch(`${SUPABASE_URL}/rest/v1/pedidos?id=eq.${pedidoId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", apikey: serviceRole, Authorization: `Bearer ${serviceRole}` },
      body: JSON.stringify({ status: "duplicado" }),
    });
    await chamarFuncao("enviar-notificacao-email", { pedido_id: pedidoId, status: "duplicado" }, serviceRole);
    await criarNotificacaoDuplicado(tenantId, canonicos.numero_pedido_cliente ?? "", serviceRole);
  } else {
    const pendentesCount = await aplicarDeParaELevantarPendencias(pedidoId, tenantId, serviceRole);

    const cfgAutoRes = await fetch(
      `${SUPABASE_URL}/rest/v1/configuracoes?tenant_id=eq.${tenantId}&chave=in.(aprovacao_automatica,confianca_minima_aprovacao,valor_maximo_aprovacao_automatica,quantidade_maxima_item_automatica,comportamento_codigo_novo)&select=chave,valor`,
      { headers: { apikey: serviceRole, Authorization: `Bearer ${serviceRole}` } },
    );
    const cfgsAuto = await cfgAutoRes.json();
    const cfgAutoMap = new Map(cfgsAuto.map((c: AnyObj) => [c.chave, c.valor]));
    const comportamento = (cfgAutoMap.get("comportamento_codigo_novo") ?? "aprovar_parcial") as
      | "bloquear" | "aprovar_original" | "aprovar_parcial";

    let statusFinal: string | null = null;
    if (pendentesCount > 0) {
      if (comportamento === "bloquear") statusFinal = "aguardando_de_para";
      else if (comportamento === "aprovar_parcial") statusFinal = "aprovado_parcial";
      await criarNotificacaoCodigosNovos(tenantId, pedidoId, pendentesCount, serviceRole);
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
      const dadosPedidoLegado = {
        ...canonicos,
        confianca,
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
        await fetch(`${SUPABASE_URL}/rest/v1/pedidos?id=eq.${pedidoId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", apikey: serviceRole, Authorization: `Bearer ${serviceRole}` },
          body: JSON.stringify({ status: "aprovado" }),
        });
        await registrarAprovacaoAutomatica({
          pedidoId, tenantId,
          tipoEvento: "aprovacao_automatica",
          valorAnterior: "pendente", valorNovo: "aprovado",
          metadata: avaliacao.metadata,
        }, serviceRole);
        await chamarFuncao("enviar-notificacao-email", { pedido_id: pedidoId, status: "aprovado" }, serviceRole);
      } else {
        await registrarAprovacaoAutomatica({
          pedidoId, tenantId,
          tipoEvento: "aprovacao_automatica_recusada",
          valorAnterior: null, valorNovo: "pendente",
          metadata: avaliacao.metadata,
        }, serviceRole);
        await chamarFuncao("enviar-notificacao-email", { pedido_id: pedidoId, status: "pendente" }, serviceRole);
      }
    }
  }

  // Marca email como lido somente após persistência completa.
  if (accessToken) await marcarEmailLido(gmailMessageId, accessToken);
  console.log(`[coletar-batch] msgId=${gmailMessageId} persistido com sucesso`);
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

async function marcarEmailLido(messageId: string, accessToken: string): Promise<void> {
  try {
    await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/modify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ removeLabelIds: ["UNREAD"] }),
    });
  } catch (e) {
    console.warn(`[coletar-batch] falha ao marcar email ${messageId} como lido:`, (e as Error).message);
  }
}

async function atualizarBatch(
  id: string,
  patch: AnyObj,
  serviceRole: string,
): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/processamento_batch?id=eq.${id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      apikey: serviceRole,
      Authorization: `Bearer ${serviceRole}`,
      Prefer: "return=minimal",
    },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    console.error("[coletar-batch] falha ao atualizar processamento_batch:", await res.text());
  }
}

function validarEstrutural(parsed: unknown, layout: ColunaLayout[]): RespostaHaiku {
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Resposta da Haiku não é objeto JSON");
  }
  const obj = parsed as AnyObj;

  if (obj.nao_e_pedido === true) throw new Error("NAO_E_PEDIDO");

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
      `linhas.length=${obj.linhas.length}, esperado=${esperadoLinhas}`,
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

  const linhasNormalizadas: Record<string, string>[] = obj.linhas.map((l: AnyObj) => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(l)) {
      out[k] = v === null || v === undefined ? "" : String(v);
    }
    return out;
  });

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

function calcularConfianca(canonicos: AnyObj): number {
  const preenchidos = CRITICOS_CONFIANCA.filter((k) => {
    const v = canonicos[k];
    return v !== null && v !== undefined && v !== "";
  }).length;
  return preenchidos / CRITICOS_CONFIANCA.length;
}

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

async function verificarDuplicado(
  opts: {
    numeroPedido?: string | null;
    cnpj?: string | null;
    pedidoAtualId: string;
    tenantId: string;
  },
  serviceRole: string,
): Promise<boolean> {
  const { numeroPedido, cnpj, pedidoAtualId, tenantId } = opts;
  const headers = { apikey: serviceRole, Authorization: `Bearer ${serviceRole}` };

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

async function buscarItensPedido(
  pedidoId: string,
  serviceRole: string,
): Promise<Array<{ quantidade?: number | null; preco_total?: number | null; codigo_produto_erp?: string | null }>> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/pedido_itens?pedido_id=eq.${pedidoId}&select=quantidade,preco_total,codigo_produto_erp`,
    { headers: { apikey: serviceRole, Authorization: `Bearer ${serviceRole}` } },
  );
  if (!res.ok) return [];
  return await res.json();
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
  if (!itensRes.ok) return 0;
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
        { tenant_id: tenantId, codigo_cliente: codigoCliente, descricao_pedido: item.descricao ?? "", ean: item.ean ?? "" },
        serviceRole,
      );
      sugestoes = Array.isArray(resp?.sugestoes) ? resp.sugestoes : [];
    } catch (e) {
      console.error("sugerir-de-para-ia falhou:", (e as Error).message);
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
    valor_total: valorTotal,
    soma_itens: Math.round(somaItens * 100) / 100,
    pendentes_de_para: pendentesCount,
    qtd_itens: itens.length,
    origem: "batch",
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

async function registrarAprovacaoAutomatica(
  opts: {
    pedidoId: string; tenantId: string;
    tipoEvento: "aprovacao_automatica" | "aprovacao_automatica_recusada";
    valorAnterior: string | null; valorNovo: string;
    metadata: AnyObj;
  },
  serviceRole: string,
): Promise<void> {
  await fetch(`${SUPABASE_URL}/rest/v1/pedido_logs`, {
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
}

async function chamarFuncao(nome: string, body: AnyObj, serviceRole: string): Promise<AnyObj | null> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/${nome}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceRole}` },
      body: JSON.stringify(body),
    });
    return await res.json();
  } catch (e) {
    console.error(`Erro ao chamar ${nome}:`, (e as Error).message);
    return null;
  }
}

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

async function criarNotificacaoTenant(opts: {
  tenantId: string; tipo: string; titulo: string; mensagem: string; link?: string | null;
  serviceRole: string;
}): Promise<void> {
  await fetch(`${SUPABASE_URL}/rest/v1/notificacoes_painel`, {
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

function jsonResp(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
