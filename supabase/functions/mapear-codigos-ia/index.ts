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
    const { pedido_id } = await req.json();
    if (!pedido_id) {
      return new Response(JSON.stringify({ error: "pedido_id obrigatório" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const serviceRole = Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY");
    const claudeKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!serviceRole || !claudeKey) {
      return new Response(JSON.stringify({ error: "Secrets não configurados" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const pedidoRes = await fetch(
      `${SUPABASE_URL}/rest/v1/pedidos?id=eq.${pedido_id}&select=*`,
      { headers: { apikey: serviceRole, Authorization: `Bearer ${serviceRole}` } },
    );
    const pedidos = await pedidoRes.json();
    const pedido = pedidos[0];
    if (!pedido) throw new Error("Pedido não encontrado");

    // Verificar se DE-PARA automático está ativado
    const cfgRes = await fetch(
      `${SUPABASE_URL}/rest/v1/configuracoes?tenant_id=eq.${pedido.tenant_id}&chave=eq.depara_automatico_ativo&select=valor`,
      { headers: { apikey: serviceRole, Authorization: `Bearer ${serviceRole}` } },
    );
    const cfgs = await cfgRes.json();
    const deParaAtivo = cfgs[0]?.valor !== "false"; // ativo por padrão

    if (!deParaAtivo) {
      console.log("DE-PARA automático desativado para tenant:", pedido.tenant_id);
      return new Response(JSON.stringify({ message: "DE-PARA automático desativado" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const itensRes = await fetch(
      `${SUPABASE_URL}/rest/v1/pedido_itens?pedido_id=eq.${pedido_id}&select=*`,
      { headers: { apikey: serviceRole, Authorization: `Bearer ${serviceRole}` } },
    );
    const itens = await itensRes.json();
    console.log("Itens para mapear:", itens.length);

    const resultados = [];
    for (const item of itens) {
      try {
        const resultado = await mapearItem(item, pedido, serviceRole, claudeKey);
        resultados.push(resultado);
      } catch (e) {
        console.error("Erro ao mapear item:", item.codigo_cliente, (e as Error).message);
        resultados.push({ codigo_cliente: item.codigo_cliente, erro: (e as Error).message });
      }
    }

    return new Response(JSON.stringify({ mapeamentos: resultados }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error("Erro geral:", (e as Error).message);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function proximoSequencial(tenant_id: string, categoria: string, serviceRole: string): Promise<string> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/de_para?tenant_id=eq.${tenant_id}&valor_destino=like.${categoria}-*&ativo=eq.true&select=valor_destino&order=valor_destino.desc&limit=1`,
    { headers: { apikey: serviceRole, Authorization: `Bearer ${serviceRole}` } },
  );
  const existentes = await res.json();
  if (existentes.length === 0) return `${categoria}-001`;
  const ultimo = existentes[0].valor_destino;
  const partes = ultimo.split("-");
  const numero = parseInt(partes[partes.length - 1]) + 1;
  return `${categoria}-${String(numero).padStart(3, "0")}`;
}

async function mapearItem(item: any, pedido: any, serviceRole: string, claudeKey: string) {
  const codigoCliente = item.codigo_cliente;
  const descricao = item.descricao;

  if (!codigoCliente) return { codigo_cliente: null, status: "sem_codigo" };

  // Verificar se já existe DE-PARA
  const deParaRes = await fetch(
    `${SUPABASE_URL}/rest/v1/de_para?tenant_id=eq.${pedido.tenant_id}&valor_origem=eq.${encodeURIComponent(codigoCliente)}&ativo=eq.true&select=*`,
    { headers: { apikey: serviceRole, Authorization: `Bearer ${serviceRole}` } },
  );
  const deParaExistente = await deParaRes.json();

  if (deParaExistente.length > 0) {
    const mapeamento = deParaExistente[0];
    console.log("DE-PARA existente:", codigoCliente, "→", mapeamento.valor_destino);
    await fetch(`${SUPABASE_URL}/rest/v1/pedido_itens?id=eq.${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", apikey: serviceRole, Authorization: `Bearer ${serviceRole}` },
      body: JSON.stringify({ codigo_produto_erp: mapeamento.valor_destino }),
    });
    return { codigo_cliente: codigoCliente, codigo_erp: mapeamento.valor_destino, status: "mapeado_existente" };
  }

  console.log("Criando DE-PARA com IA para:", codigoCliente, descricao);

  const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": claudeKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      messages: [{
        role: "user",
        content: `Classifique este produto e retorne APENAS JSON:

Produto: ${descricao}
Código: ${codigoCliente}
Unidade: ${item.unidade_medida ?? ""}

Categorias: FERRA, ALIM, BEBID, LIMP, HIGIE, VEST, ELETRO, MOVEIS, FARMA, CONST, AUTO, PET, OUTRO

{"categoria":"SIGLA","segmento":"nome completo","confianca":0.0,"observacao":"justificativa"}`,
      }],
    }),
  });

  const claudeJson = await claudeRes.json();
  const textoResposta = claudeJson.content?.[0]?.text ?? "{}";

  let sugestao: any = {};
  try {
    sugestao = JSON.parse(textoResposta.replace(/```json|```/g, "").trim());
  } catch {
    sugestao = { categoria: "OUTRO", segmento: "Outros", confianca: 0 };
  }

  const codigoErp = await proximoSequencial(pedido.tenant_id, sugestao.categoria, serviceRole);
  console.log("Código ERP gerado:", codigoErp);

  await fetch(`${SUPABASE_URL}/rest/v1/de_para`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: serviceRole,
      Authorization: `Bearer ${serviceRole}`,
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      tenant_id: pedido.tenant_id,
      tipo: "PRODUTO_CODIGO",
      cnpj_comprador: pedido.cnpj ?? null,
      nome_comprador: pedido.empresa ?? null,
      valor_origem: codigoCliente,
      valor_destino: codigoErp,
      descricao,
      segmento: sugestao.segmento ?? null,
      ativo: true,
      observacoes: `IA. Confiança: ${sugestao.confianca}. ${sugestao.observacao ?? ""}`,
    }),
  });

  await fetch(`${SUPABASE_URL}/rest/v1/pedido_itens?id=eq.${item.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", apikey: serviceRole, Authorization: `Bearer ${serviceRole}` },
    body: JSON.stringify({ codigo_produto_erp: codigoErp }),
  });

  return { codigo_cliente: codigoCliente, codigo_erp: codigoErp, categoria: sugestao.categoria, status: "mapeado_por_ia" };
}
