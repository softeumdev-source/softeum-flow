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
    const { tenant_id } = await req.json();
    if (!tenant_id) {
      return new Response(JSON.stringify({ error: "tenant_id obrigatório" }), {
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

    // Buscar config do ERP
    const configRes = await fetch(
      `${SUPABASE_URL}/rest/v1/tenant_erp_config?tenant_id=eq.${tenant_id}&select=*`,
      { headers: { apikey: serviceRole, Authorization: `Bearer ${serviceRole}` } },
    );
    const configs = await configRes.json();
    const config = configs[0];

    if (!config) {
      return new Response(JSON.stringify({ error: "Configuração de ERP não encontrada" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!config.layout_arquivo) {
      return new Response(JSON.stringify({ error: "Nenhum modelo de arquivo enviado" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("Analisando layout:", config.layout_filename, config.layout_mime);

    // Converter o layout para texto legível
    let conteudoTexto = "";
    
    if (config.layout_mime === "text/csv" || config.layout_filename?.endsWith(".csv")) {
      // CSV - já é texto
      conteudoTexto = Buffer.from(config.layout_arquivo, "base64").toString("utf-8");
    } else {
      // Para XLSX e outros, usamos o base64 direto
      conteudoTexto = `Arquivo: ${config.layout_filename}\nTipo: ${config.layout_mime}\nConteúdo em base64 disponível para análise.`;
    }

    console.log("Conteúdo para análise:", conteudoTexto.substring(0, 500));

    // Chamar Claude para analisar o layout
    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": claudeKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 2000,
        messages: [{
          role: "user",
          content: `Analise este modelo de arquivo de ERP e mapeie cada coluna para os campos do sistema de pedidos.

Conteúdo do modelo:
${conteudoTexto}

Campos disponíveis no sistema de pedidos:
- pedido.numero_pedido_cliente
- pedido.empresa
- pedido.data_emissao
- pedido.cnpj
- pedido.endereco_faturamento
- pedido.cidade_faturamento
- pedido.estado_faturamento
- pedido.cep_faturamento
- pedido.telefone_comprador
- pedido.email_comprador
- pedido.remetente_email
- pedido.observacoes_gerais
- pedido.condicao_pagamento
- pedido.valor_total
- pedido.valor_frete
- pedido.valor_desconto
- pedido.transportadora
- pedido.tipo_frete
- pedido.endereco_entrega
- pedido.cidade_entrega
- pedido.estado_entrega
- pedido.cep_entrega
- item.descricao
- item.codigo_cliente
- item.codigo_produto_erp
- item.unidade_medida
- item.quantidade
- item.preco_unitario
- item.preco_total

Responda APENAS com JSON no formato:
{
  "formato": "csv" ou "xlsx",
  "separador": "," ou ";" ou "\\t",
  "tem_cabecalho": true ou false,
  "colunas": [
    {
      "posicao": 0,
      "nome_coluna": "nome exato da coluna no arquivo",
      "campo_sistema": "campo do sistema que corresponde",
      "tipo": "pedido" ou "item",
      "obrigatorio": true ou false
    }
  ],
  "observacoes": "observações importantes sobre o formato"
}`,
        }],
      }),
    });

    const claudeJson = await claudeRes.json();
    console.log("Claude status:", claudeRes.status);
    const textoResposta = claudeJson.content?.[0]?.text ?? "{}";

    let mapeamento: any = {};
    try {
      mapeamento = JSON.parse(textoResposta.replace(/```json|```/g, "").trim());
    } catch (e) {
      console.error("Erro ao parsear mapeamento:", e);
      throw new Error("IA não conseguiu analisar o layout");
    }

    console.log("Mapeamento gerado:", JSON.stringify(mapeamento).substring(0, 300));

    // Salvar mapeamento no banco
    await fetch(
      `${SUPABASE_URL}/rest/v1/tenant_erp_config?tenant_id=eq.${tenant_id}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          apikey: serviceRole,
          Authorization: `Bearer ${serviceRole}`,
        },
        body: JSON.stringify({ mapeamento_campos: mapeamento }),
      },
    );

    console.log("Mapeamento salvo com sucesso!");

    return new Response(
      JSON.stringify({ success: true, mapeamento }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );

  } catch (e) {
    console.error("Erro:", (e as Error).message);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
