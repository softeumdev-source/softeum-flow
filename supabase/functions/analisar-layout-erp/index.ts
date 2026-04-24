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

    // Remove prefixo data:...;base64, se existir
    let base64 = config.layout_arquivo as string;
    if (base64.includes(";base64,")) {
      base64 = base64.split(";base64,")[1];
    }

    let conteudoParaAnalise = "";

    if (mime === "text/csv" || filename.endsWith(".csv")) {
      conteudoParaAnalise = atob(base64);

    } else if (mime === "text/plain" || filename.endsWith(".txt")) {
      conteudoParaAnalise = atob(base64);

    } else if (mime === "application/json" || filename.endsWith(".json")) {
      conteudoParaAnalise = atob(base64);

    } else if (mime === "text/xml" || mime === "application/xml" || filename.endsWith(".xml")) {
      conteudoParaAnalise = atob(base64);

    } else if (filename.endsWith(".edi") || filename.endsWith(".x12")) {
      conteudoParaAnalise = atob(base64);

    } else if (
      filename.endsWith(".xlsx") || filename.endsWith(".xls") ||
      mime.includes("spreadsheet") || mime.includes("excel")
    ) {
      // XLSX é um ZIP — extrai texto das partes XML internas (sharedStrings + sheet)
      try {
        const binary = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const decoder = new TextDecoder("utf-8");
        const rawText = decoder.decode(binary);

        // Extrai conteúdo de sharedStrings.xml (onde ficam os textos das células)
        const sharedMatch = rawText.match(/<sst[^>]*>([\s\S]*?)<\/sst>/);
        let strings: string[] = [];
        if (sharedMatch) {
          const tMatches = sharedMatch[1].matchAll(/<t[^>]*>([^<]+)<\/t>/g);
          for (const m of tMatches) {
            const val = m[1].trim();
            if (val.length > 0) strings.push(val);
          }
        }

        // Extrai valores inline das células do sheet (números e datas)
        const sheetMatch = rawText.match(/<sheetData>([\s\S]*?)<\/sheetData>/);
        let inlineVals: string[] = [];
        if (sheetMatch) {
          const vMatches = sheetMatch[1].matchAll(/<v>([^<]+)<\/v>/g);
          for (const m of vMatches) {
            inlineVals.push(m[1].trim());
          }
        }

        if (strings.length > 0) {
          conteudoParaAnalise = `Arquivo Excel (${filename}).\n\nTextos encontrados nas células:\n${strings.slice(0, 150).join(" | ")}\n\nValores numéricos/datas:\n${inlineVals.slice(0, 50).join(" | ")}`;
        } else {
          // Fallback: extrai strings legíveis do binário
          const legivel = rawText.match(/[\x20-\x7Eà-ÿÀ-Ý]{4,}/g) ?? [];
          const filtrado = legivel
            .filter((s) => s.trim().length > 3 && !s.startsWith("PK") && !s.includes("<?xml"))
            .slice(0, 100);
          conteudoParaAnalise = `Arquivo Excel (${filename}).\nConteúdo extraído:\n${filtrado.join("\n")}`;
        }

        console.log("XLSX extraído. Strings:", strings.length, "Inline:", inlineVals.length);
      } catch (err) {
        console.error("Erro ao extrair XLSX:", err);
        conteudoParaAnalise = `Arquivo Excel: ${filename}. Não foi possível extrair o conteúdo.`;
      }

    } else {
      // Qualquer outro formato - tenta decodificar como texto
      try {
        conteudoParaAnalise = atob(base64);
      } catch {
        conteudoParaAnalise = `Arquivo binário: ${filename}`;
      }
    }

    console.log("Conteúdo para análise (primeiros 300 chars):", conteudoParaAnalise.substring(0, 300));

    const promptAnalise = `Analise este modelo de arquivo de ERP e mapeie cada coluna para os campos do sistema de pedidos.

Conteúdo do arquivo (${filename}):
${conteudoParaAnalise.substring(0, 4000)}

Campos disponíveis no sistema:
PEDIDO: numero_pedido_cliente, empresa, data_emissao, cnpj, endereco_faturamento, cidade_faturamento, estado_faturamento, cep_faturamento, telefone_comprador, email_comprador, remetente_email, observacoes_gerais, condicao_pagamento, valor_total, valor_frete, valor_desconto, transportadora, tipo_frete, endereco_entrega, cidade_entrega, estado_entrega, cep_entrega
ITEM: descricao, codigo_cliente, codigo_produto_erp, unidade_medida, quantidade, preco_unitario, preco_total

Responda APENAS com JSON válido, sem markdown:
{
  "formato": "csv|xlsx|xml|json|txt|edi",
  "separador": ",|;|tab|pipe",
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
        messages: [{ role: "user", content: promptAnalise }],
      }),
    });

    const claudeJson = await claudeRes.json();
    console.log("Claude status:", claudeRes.status);

    if (!claudeRes.ok) {
      console.error("Erro Claude:", JSON.stringify(claudeJson));
      throw new Error(`Claude retornou erro ${claudeRes.status}: ${claudeJson.error?.message ?? "desconhecido"}`);
    }

    const textoResposta = claudeJson.content?.[0]?.text ?? "{}";
    console.log("Resposta Claude:", textoResposta.substring(0, 500));

    let mapeamento: any = {};
    try {
      mapeamento = JSON.parse(textoResposta.replace(/```json|```/g, "").trim());
    } catch (e) {
      console.error("Erro ao parsear mapeamento:", e);
      console.error("Texto recebido:", textoResposta);
      throw new Error("IA não conseguiu analisar o layout");
    }

    console.log("Mapeamento gerado com", mapeamento.colunas?.length, "colunas");

    // Salvar mapeamento no banco
    const patchRes = await fetch(
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

    console.log("Patch status:", patchRes.status);
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
