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

    // Buscar pedido
    const pedidoRes = await fetch(
      `${SUPABASE_URL}/rest/v1/pedidos?id=eq.${pedido_id}&select=*`,
      { headers: { apikey: serviceRole, Authorization: `Bearer ${serviceRole}` } },
    );
    const pedidos = await pedidoRes.json();
    const pedido = pedidos[0];
    if (!pedido) throw new Error("Pedido não encontrado");

    // Buscar itens do pedido
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

async function mapearItem(item: any, pedido: any, serviceRole: string, claudeKey: string) {
  const codigoCliente = item.codigo_cliente;
  const descricao = item.descricao;

  if (!codigoCliente) {
    console.log("Item sem código cliente, pulando...");
    return { codigo_cliente: null, status: "sem_codigo" };
  }

  // Verificar se já existe DE-PARA para esse código + tenant
  const deParaRes = await fetch(
    `${SUPABASE_URL}/rest/v1/de_para?tenant_id=eq.${pedido.tenant_id}&valor_origem=eq.${encodeURIComponent(codigoCliente)}&ativo=eq.true&select=*`,
    { headers: { apikey: serviceRole, Authorization: `Bearer ${serviceRole}` } },
  );
  const deParaExistente = await deParaRes.json();

  if (deParaExistente.length > 0) {
    const mapeamento = deParaExistente[0];
    console.log("DE-PARA existente:", codigoCliente, "→", mapeamento.valor_destino);

    // Atualizar código ERP no item
    await fetch(`${SUPABASE_URL}/rest/v1/pedido_itens?id=eq.${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", apikey: serviceRole, Authorization: `Bearer ${serviceRole}` },
      body: JSON.stringify({ codigo_produto_erp: mapeamento.valor_destino }),
    });

    return { codigo_cliente: codigoCliente, codigo_erp: mapeamento.valor_destino, status: "mapeado_existente" };
  }

  // Não existe DE-PARA — usar IA para criar
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
      max_tokens: 500,
      messages: [{
        role: "user",
        content: `Você é um sistema de mapeamento de códigos de produtos para ERP industrial.

Produto recebido no pedido:
- Código do cliente: ${codigoCliente}
- Descrição: ${descricao}
- Unidade: ${item.unidade_medida ?? ""}
- Quantidade: ${item.quantidade ?? ""}
- Empresa compradora: ${pedido.empresa ?? ""}

Gere um código interno padronizado para este produto.
Use o formato: CATEGORIA-SEQUENCIAL (ex: FERRA-001, ALIM-001, BEBID-001, LIMP-001, HIGIE-001, VEST-001, ELETRO-001, MOVEIS-001, etc.)

Categorias sugeridas por segmento:
- Ferramentas/Hardware: FERRA
- Alimentos: ALIM
- Bebidas: BEBID
- Limpeza: LIMP
- Higiene: HIGIE
- Vestuário: VEST
- Eletroeletrônicos: ELETRO
- Móveis: MOVEIS
- Farmácia: FARMA
- Outros: OUTRO

Responda APENAS com JSON:
{
  "codigo_erp_sugerido": "string",
  "categoria": "string",
  "segmento": "string",
  "confianca": 0.0 a 1.0,
  "observacao": "string"
}`,
      }],
    }),
  });

  const claudeJson = await claudeRes.json();
  const textoResposta = claudeJson.content?.[0]?.text ?? "{}";

  let sugestao: any = {};
  try {
    sugestao = JSON.parse(textoResposta.replace(/```json|```/g, "").trim());
  } catch (e) {
    console.error("Erro ao parsear resposta da IA:", e);
    sugestao = { codigo_erp_sugerido: `PROD-${codigoCliente}`, confianca: 0, categoria: "OUTRO" };
  }

  console.log("Sugestão da IA:", JSON.stringify(sugestao));

  // Salvar DE-PARA na tabela
  const novoDeParaRes = await fetch(`${SUPABASE_URL}/rest/v1/de_para`, {
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
      valor_destino: sugestao.codigo_erp_sugerido,
      descricao: descricao,
      segmento: sugestao.segmento ?? null,
      ativo: true,
      observacoes: `Gerado automaticamente pela IA. Confiança: ${sugestao.confianca}. ${sugestao.observacao ?? ""}`,
    }),
  });

  const novoDepara = await novoDeParaRes.json();
  console.log("DE-PARA criado:", novoDepara[0]?.id);

  // Atualizar código ERP no item
  await fetch(`${SUPABASE_URL}/rest/v1/pedido_itens?id=eq.${item.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", apikey: serviceRole, Authorization: `Bearer ${serviceRole}` },
    body: JSON.stringify({ codigo_produto_erp: sugestao.codigo_erp_sugerido }),
  });

  return {
    codigo_cliente: codigoCliente,
    codigo_erp: sugestao.codigo_erp_sugerido,
    categoria: sugestao.categoria,
    confianca: sugestao.confianca,
    status: "mapeado_por_ia",
  };
}
