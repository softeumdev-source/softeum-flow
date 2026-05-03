import { SUPABASE_URL, getServiceRole } from "../_shared/supabase-client.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const serviceRole = getServiceRole();
  if (!serviceRole) {
    return new Response(JSON.stringify({ error: "Service role não configurado" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const h = { apikey: serviceRole, Authorization: `Bearer ${serviceRole}` };

  // Aceita tenant_id via query param ou body
  let tenantId: string | null = null;
  const url = new URL(req.url);
  tenantId = url.searchParams.get("tenant_id");
  if (!tenantId && req.method === "POST") {
    try {
      const body = await req.json();
      tenantId = body.tenant_id ?? null;
    } catch { /* noop */ }
  }

  if (!tenantId) {
    return new Response(JSON.stringify({ error: "tenant_id obrigatório" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 1. Último pedido criado
  const pedidoRes = await fetch(
    `${SUPABASE_URL}/rest/v1/pedidos?tenant_id=eq.${tenantId}&order=created_at.desc&limit=1&select=*`,
    { headers: h },
  );
  const pedidos = await pedidoRes.json();
  if (!Array.isArray(pedidos) || pedidos.length === 0) {
    return new Response(JSON.stringify({ erro: "Nenhum pedido encontrado para este tenant" }), {
      status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const pedido = pedidos[0];
  const pedidoId = pedido.id;

  // 2. Parse do json_ia_bruto
  let jsonIaBruto: any = null;
  const raw = pedido.json_ia_bruto;
  if (raw) {
    if (typeof raw === "string") {
      try { jsonIaBruto = JSON.parse(raw); } catch { jsonIaBruto = { _parse_error: true, raw }; }
    } else {
      jsonIaBruto = raw; // já é objeto (JSONB)
    }
  }

  // 3. Mapeamento de campos do ERP
  const erpRes = await fetch(
    `${SUPABASE_URL}/rest/v1/tenant_erp_config?tenant_id=eq.${tenantId}&select=mapeamento_campos`,
    { headers: h },
  );
  const erpConfigs = await erpRes.json();
  const mapeamentoCampos: any[] = erpConfigs[0]?.mapeamento_campos?.colunas ?? [];

  // 4. Campos nulos no pedido
  const COLUNAS_DIAGNOSTICO = [
    "numero_pedido_cliente", "empresa", "cnpj", "data_emissao",
    "data_entrega_solicitada", "nome_comprador", "email_comprador",
    "condicao_pagamento", "valor_total", "nome_fantasia_cliente",
    "telefone_comprador", "transportadora", "tipo_frete", "valor_frete",
    "endereco_entrega", "cidade_entrega", "estado_entrega", "cep_entrega",
    "confianca_ia", "json_ia_bruto",
  ];

  const camposNulosPedido: string[] = [];
  const camposPreenchidosPedido: Record<string, any> = {};
  for (const col of COLUNAS_DIAGNOSTICO) {
    const val = pedido[col];
    if (val === null || val === undefined || val === "") {
      camposNulosPedido.push(col);
    } else {
      camposPreenchidosPedido[col] = col === "json_ia_bruto" ? "(ver json_ia_bruto abaixo)" : val;
    }
  }

  // 5. Campos do mapeamento: verificar quais estão no json_ia_bruto
  const analise_mapeamento: Array<{
    campo_sistema: string;
    nome_coluna: string;
    tipo: string;
    no_pedido_db: "sim" | "nao" | "nao_verificavel";
    no_json_ia_bruto: "sim" | "nao" | "sem_json_ia_bruto";
    diagnostico: string;
  }> = [];

  for (const col of mapeamentoCampos) {
    const campoSistema: string = col.campo_sistema ?? "";
    const tipo: string = col.tipo ?? "pedido";
    if (tipo === "item") continue; // pula campos de item por ora

    const noDb = pedido[campoSistema] != null ? "sim" : (campoSistema in pedido ? "nao" : "nao_verificavel");
    const noIa = jsonIaBruto === null ? "sem_json_ia_bruto" : (jsonIaBruto[campoSistema] != null ? "sim" : "nao");

    let diagnostico = "";
    if (noDb === "nao" && noIa === "nao") diagnostico = "IA NÃO EXTRAIU";
    else if (noDb === "nao" && noIa === "sim") diagnostico = "IA EXTRAIU MAS NÃO SALVOU NO DB";
    else if (noDb === "sim") diagnostico = "OK";
    else if (noDb === "nao_verificavel" && noIa === "sim") diagnostico = "IA extraiu — coluna pode não existir no DB";
    else if (noDb === "nao_verificavel" && noIa === "nao") diagnostico = "IA NÃO EXTRAIU (coluna pode não existir no DB)";
    else diagnostico = "Verificar manualmente";

    analise_mapeamento.push({
      campo_sistema: campoSistema,
      nome_coluna: col.nome_coluna ?? "",
      tipo,
      no_pedido_db: noDb,
      no_json_ia_bruto: noIa,
      diagnostico,
    });
  }

  // 6. Itens do pedido (para referência)
  const itensRes = await fetch(
    `${SUPABASE_URL}/rest/v1/pedido_itens?pedido_id=eq.${pedidoId}&select=id,codigo_cliente,descricao,quantidade,preco_unitario,preco_total,ean&order=numero_item.asc`,
    { headers: h },
  );
  const itens = itensRes.ok ? await itensRes.json() : [];

  // 7. Logs de telemetria (busca logs do pedido)
  const logsRes = await fetch(
    `${SUPABASE_URL}/rest/v1/pedido_logs?pedido_id=eq.${pedidoId}&select=*&order=created_at.asc`,
    { headers: h },
  );
  const logs = logsRes.ok ? await logsRes.json() : [];

  // 8. Campos do json_ia_bruto — lista de chaves e quantas são nulas
  const iaChavesPreenchidas: string[] = [];
  const iaChavesVazias: string[] = [];
  if (jsonIaBruto && typeof jsonIaBruto === "object") {
    for (const [k, v] of Object.entries(jsonIaBruto)) {
      if (k === "itens") continue;
      if (v != null && v !== "") iaChavesPreenchidas.push(k);
      else iaChavesVazias.push(k);
    }
  }

  // 9. Sumário
  const iaNaoExtraiu = analise_mapeamento.filter(a => a.diagnostico.startsWith("IA NÃO EXTRAIU")).map(a => a.campo_sistema);
  const iaNaoSalvou = analise_mapeamento.filter(a => a.diagnostico.includes("NÃO SALVOU")).map(a => a.campo_sistema);

  const resultado = {
    sumario: {
      pedido_id: pedidoId,
      numero_pedido_cliente: pedido.numero_pedido_cliente ?? pedido.numero,
      created_at: pedido.created_at,
      status: pedido.status,
      confianca_ia: pedido.confianca_ia,
      total_campos_mapeamento: mapeamentoCampos.filter(c => c.tipo !== "item").length,
      campos_nulos_no_pedido_db: camposNulosPedido.length,
      ia_chaves_preenchidas: iaChavesPreenchidas.length,
      ia_chaves_vazias: iaChavesVazias.length,
      diagnostico_mapeamento: {
        ia_nao_extraiu: iaNaoExtraiu,
        ia_extraiu_mas_nao_salvou: iaNaoSalvou,
      },
    },
    pedido_db: {
      campos_preenchidos: camposPreenchidosPedido,
      campos_nulos: camposNulosPedido,
      todos_os_campos: pedido,
    },
    json_ia_bruto: {
      chaves_preenchidas: iaChavesPreenchidas,
      chaves_vazias: iaChavesVazias,
      conteudo_completo: jsonIaBruto,
    },
    mapeamento_erp: {
      total_colunas: mapeamentoCampos.length,
      analise_por_campo: analise_mapeamento,
    },
    itens_pedido: itens,
    logs_pedido: logs,
  };

  return new Response(JSON.stringify(resultado, null, 2), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
