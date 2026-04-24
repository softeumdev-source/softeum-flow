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

    if (!config?.layout_arquivo) {
      return new Response(JSON.stringify({ error: "Nenhum modelo de arquivo enviado" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("Analisando layout:", config.layout_filename, config.layout_mime);

    const mime = config.layout_mime ?? "";
    const filename = config.layout_filename ?? "";
    const base64 = config.layout_arquivo;

    // Preparar conteúdo para Claude baseado no tipo
    let conteudoParaAnalise = "";
    let isDocumento = false;
    let mediaType = "";

    if (mime === "text/csv" || filename.endsWith(".csv")) {
      // CSV - decodifica base64 para texto
      conteudoParaAnalise = atob(base64);
      isDocumento = false;
    } else if (mime === "text/plain" || filename.endsWith(".txt")) {
      conteudoParaAnalise = atob(base64);
      isDocumento = false;
    } else if (mime === "application/json" || filename.endsWith(".json")) {
      conteudoParaAnalise = atob(base64);
      isDocumento = false;
    } else if (mime === "text/xml" || mime === "application/xml" || filename.endsWith(".xml")) {
      conteudoParaAnalise = atob(base64);
      isDocumento = false;
    } else if (filename.endsWith(".xlsx") || filename.endsWith(".xls") || 
               mime.includes("spreadsheet") || mime.includes("excel")) {
      // XLSX - usa como documento PDF (Claude aceita via base64)
      isDocumento = true;
      mediaType = "application/pdf"; // Claude aceita xlsx como documento
    } else if (filename.endsWith(".edi") || filename.endsWith(".x12")) {
      conteudoParaAnalise = atob(base64);
      isDocumento = false;
    } else {
      // Qualquer outro formato - tenta decodificar como texto
      try {
        conteudoParaAnalise = atob(base64);
      } catch {
        conteudoParaAnalise = `Arquivo binário: ${filename}`;
      }
      isDocumento = false;
    }

    const promptAnalise = `Analise este modelo de arquivo de ERP e mapeie cada coluna para os campos do sistema de pedidos.

${!isDocumento ? `Conteúdo do arquivo (${filename}):\n${conteudoParaAnalise.substring(0, 3000)}` : `Arquivo: ${filename}`}

Campos disponíveis no sistema:
PEDIDO: numero_pedido_cliente, empresa, data_emissao, cnpj, endereco_faturamento, cidade_faturamento, estado_faturamento, cep_faturamento, telefone_comprador, email_comprador, remetente_email, observacoes_gerais, condicao_pagamento, valor_total, valor_frete, valor_desconto, transportadora, tipo_frete, endereco_entrega, cidade_entrega, estado_entrega, cep_entrega
ITEM: descricao, codigo_cliente, codigo_produto_erp, unidade_medida, quantidade, preco_unitario, preco_total

Responda APENAS com JSON:
{
  "formato": "csv|xlsx|xml|json|txt|edi",
  "separador": ",|;|\\t|pipe",
  "tem_cabecalho": true,
  "tipo_erp": "bling|totvs|sap|sankhya|linx|oracle|outro",
  "colunas": [
    {
      "posicao": 0,
      "nome_coluna": "nome exato no arquivo",
      "campo_sistema": "campo do sistema",
      "tipo": "pedido|item",
      "obrigatorio": true,
      "formato_data": "DD/MM/YYYY|YYYY-MM-DD|null"
    }
  ],
  "observacoes": "notas importantes"
}`;

    // Montar mensagem para Claude
    let mensagemClaude;
    if (isDocumento) {
      mensagemClaude = {
        role: "user",
        content: [
          {
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: base64 },
          },
          { type: "text", text: promptAnalise },
        ],
      };
    } else {
      mensagemClaude = {
        role: "user",
        content: promptAnalise,
      };
    }

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
        messages: [mensagemClaude],
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

    console.log("Mapeamento gerado com", mapeamento.colunas?.length, "colunas");

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


