import * as XLSX from "npm:xlsx@0.18.5";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { SUPABASE_URL, getServiceRole } from "../_shared/supabase-client.ts";
import { isServiceRoleCaller, requireTenantAccess } from "../_shared/authz.ts";
import {
  CAMPOS_PEDIDO_DISPONIVEIS,
  CAMPOS_PEDIDO_ITEM_DISPONIVEIS,
  isCampoValido,
  type CampoSistema,
} from "../_shared/schema-pedidos.ts";

function formatarCatalogoCampos(campos: CampoSistema[]): string {
  return campos
    .map((c) => {
      const ex = c.exemplos.length > 0 ? ` (ex: ${c.exemplos.slice(0, 2).join(", ")})` : "";
      return `- ${c.nome}: ${c.descricao}${ex}`;
    })
    .join("\n");
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function decodificarTexto(raw: string): string {
  if (raw.includes(";base64,")) {
    const b64 = raw.split(";base64,")[1];
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return new TextDecoder("utf-8").decode(bytes);
  }
  try {
    const bytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
    return new TextDecoder("utf-8").decode(bytes);
  } catch {
    // não é base64
  }
  return raw;
}

function extrairColunasXLSX(rawArquivo: string): { colunas: string[]; preview: string } {
  let b64 = rawArquivo;
  if (b64.includes(";base64,")) b64 = b64.split(";base64,")[1];
  const binaryString = atob(b64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
  const workbook = XLSX.read(bytes, { type: "array" });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const csv = XLSX.utils.sheet_to_csv(sheet);
  const primeiraLinha = csv.split(/\r\n|\r|\n/)[0];
  const colunas = primeiraLinha.split(",").map((c) => c.trim().replace(/^"|"$/g, "")).filter(Boolean);
  console.log("Colunas XLSX extraídas:", colunas.length);
  return { colunas, preview: csv.substring(0, 3000) };
}

function extrairColunasCsv(conteudo: string): { colunas: string[]; separador: string; preview: string } {
  const primeiraLinha = conteudo.split(/\r\n|\r|\n/)[0];

  const separadores = [";", ",", "\t", "|"];
  let melhorSep = ",";
  let maiorCount = 0;

  for (const sep of separadores) {
    let count = 0;
    let dentroAspas = false;
    for (const char of primeiraLinha) {
      if (char === '"') dentroAspas = !dentroAspas;
      if (!dentroAspas && char === sep) count++;
    }
    if (count > maiorCount) {
      maiorCount = count;
      melhorSep = sep;
    }
  }

  const colunas: string[] = [];
  let atual = "";
  let dentroAspas = false;
  for (let i = 0; i < primeiraLinha.length; i++) {
    const char = primeiraLinha[i];
    if (char === '"') {
      dentroAspas = !dentroAspas;
    } else if (char === melhorSep && !dentroAspas) {
      colunas.push(atual.trim());
      atual = "";
    } else {
      atual += char;
    }
  }
  if (atual.trim()) colunas.push(atual.trim());

  const sepNome = melhorSep === "\t" ? "tab" : melhorSep === "|" ? "pipe" : melhorSep;
  console.log(`Separador: "${sepNome}", colunas: ${colunas.length}`);
  return { colunas, separador: sepNome, preview: conteudo.substring(0, 3000) };
}

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

    const serviceRole = getServiceRole();
    const claudeKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!serviceRole || !claudeKey) {
      return new Response(JSON.stringify({ error: "Secrets não configurados" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Authz: caller precisa ser super admin ou membro do tenant solicitado.
    // Sem isso, qualquer user autenticado podia passar tenant_id alheio e
    // sobrescrever o mapeamento de outro tenant (write cross-tenant).
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!isServiceRoleCaller(authHeader, serviceRole)) {
      const anon = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY");
      if (!anon) {
        return new Response(JSON.stringify({ error: "Anon key não configurada" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const userClient = createClient(SUPABASE_URL, anon, { global: { headers: { Authorization: authHeader } } });
      const { data: userRes } = await userClient.auth.getUser();
      if (!userRes?.user) {
        return new Response(JSON.stringify({ error: "Sessão inválida" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const authz = await requireTenantAccess(userClient, tenant_id);
      if (!authz.ok) {
        await registrarErro("authz_denied", "analisar-layout-erp",
          `User ${userRes.user.id} tentou analisar layout do tenant ${tenant_id}`,
          { severidade: "alta", tenant_id, detalhes: { user_id: userRes.user.id } });
        return new Response(JSON.stringify({ error: authz.message }), {
          status: authz.status!, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // Layout do ERP é admin-only por regra de negócio. RLS de
      // tenant_erp_config já bloqueia escrita pra operador, mas reforço
      // explícito aqui pra falhar rápido com mensagem clara antes de
      // gastar a chamada do Claude.
      const { data: isSuper } = await userClient.rpc("is_super_admin");
      const { data: isAdmin } = await userClient.rpc("is_tenant_admin", { p_tenant_id: tenant_id });
      if (!isSuper && !isAdmin) {
        return new Response(JSON.stringify({ error: "Apenas administradores podem analisar layout do ERP" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

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

    const mime = config.layout_mime ?? "";
    const filename = config.layout_filename ?? "";
    const rawArquivo = config.layout_arquivo as string;

    console.log("Analisando layout:", filename, mime);

    let colunasOrdenadas: string[] = [];
    let separador = ";";
    let preview = "";
    let formato = "csv";

    if (filename.endsWith(".xlsx") || filename.endsWith(".xls") || mime.includes("spreadsheet") || mime.includes("excel")) {
      const resultado = extrairColunasXLSX(rawArquivo);
      colunasOrdenadas = resultado.colunas;
      preview = resultado.preview;
      formato = "xlsx";
    } else if (mime === "application/json" || filename.endsWith(".json")) {
      preview = decodificarTexto(rawArquivo).substring(0, 3000);
      formato = "json";
    } else if (mime === "text/xml" || mime === "application/xml" || filename.endsWith(".xml")) {
      preview = decodificarTexto(rawArquivo).substring(0, 3000);
      formato = "xml";
    } else {
      const conteudo = decodificarTexto(rawArquivo);
      const resultado = extrairColunasCsv(conteudo);
      colunasOrdenadas = resultado.colunas;
      separador = resultado.separador;
      preview = resultado.preview;
      formato = filename.endsWith(".txt") ? "txt" : "csv";
    }

    console.log(`Total de colunas extraídas: ${colunasOrdenadas.length}`);

    const listaColunas = colunasOrdenadas.map((nome, idx) => `${idx}: "${nome}"`).join("\n");

    const catalogoPedido = formatarCatalogoCampos(CAMPOS_PEDIDO_DISPONIVEIS);
    const catalogoItem = formatarCatalogoCampos(CAMPOS_PEDIDO_ITEM_DISPONIVEIS);

    const promptMapeamento = `Você é especialista em ERPs brasileiros. Mapeie cada coluna abaixo para o campo correspondente no sistema de pedidos.

Colunas do arquivo (NA ORDEM QUE ESTÃO — não altere a ordem):
${listaColunas}

Preview dos dados:
${preview.substring(0, 1000)}

═══════════════════════════════════════════════════════════════
CATÁLOGO DE CAMPOS DO SISTEMA (única fonte permitida)
═══════════════════════════════════════════════════════════════

Cada item abaixo é uma COLUNA REAL no banco de dados. Os nomes são
EXATAMENTE como existem na tabela. Use a descrição para casar com a
intenção da coluna do arquivo do cliente.

▶ CAMPOS DE PEDIDO (tipo: "pedido"):
${catalogoPedido}

▶ CAMPOS DE ITEM (tipo: "item"):
${catalogoItem}

═══════════════════════════════════════════════════════════════
REGRAS OBRIGATÓRIAS
═══════════════════════════════════════════════════════════════

1. Você DEVE escolher \`campo_sistema\` EXCLUSIVAMENTE da lista acima.
   Se nenhum campo da lista for adequado para uma coluna do arquivo,
   retorne \`campo_sistema: null\` para aquela posição.
   NUNCA invente nomes que não estão na lista (nem em snake_case, nem
   "parecido", nem variações). Sem exceções.

2. Retorne os mapeamentos NA MESMA ORDEM da lista de colunas (índice 0, 1, 2...).
   Nunca omita nenhuma coluna — retorne um item para cada índice.

3. \`tipo\` deve ser "pedido" ou "item" — escolha conforme o catálogo
   em que o nome aparece. Se \`campo_sistema\` for null, ainda assim
   informe o tipo provável.

4. Endereço: o schema tem DOIS conjuntos completos — use o correto:
   - Endereço de FATURAMENTO/COBRANÇA/COMPRADOR → campos \`*_faturamento\`
     (endereco, numero, complemento, bairro, cidade, estado, cep)
   - Endereço de ENTREGA (onde a mercadoria chega) → campos \`*_entrega\`
   Exemplos: "Bairro Comprador" → \`bairro_faturamento\`; "Bairro Entrega" → \`bairro_entrega\`

5. Atenção a outros sinônimos comuns (use o catálogo, não invente):
   - "Nome Entrega" → \`local_entrega\`
   - "Serviço Transportadora" → \`transportadora\`
   - "Valor Desconto Pedido" → \`valor_desconto\`
   - "Outras despesas" → \`observacoes_gerais\` (não há coluna específica)
   - "Qtd Parcela" → \`prazo_pagamento_dias\` (não há coluna de parcelas)
   - "ID Forma Pagamento" → \`forma_pagamento\` (não há coluna de código separado)
   - "SKU" pelo lado comprador → \`codigo_cliente\`; pelo lado fornecedor → \`codigo_produto_erp\`

6. \`formato_data\` só faz sentido para campos de data. Use "DD/MM/YYYY",
   "YYYY-MM-DD" ou null. Para campos não-data, sempre null.

═══════════════════════════════════════════════════════════════
FORMATO DA RESPOSTA
═══════════════════════════════════════════════════════════════

Responda APENAS com JSON válido sem markdown:
{
  "mapeamentos": [
    {"indice": 0, "campo_sistema": "nome_do_catalogo_ou_null", "tipo": "pedido|item", "formato_data": "DD/MM/YYYY|YYYY-MM-DD|null"}
  ]
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
        max_tokens: 4000,
        messages: [{ role: "user", content: promptMapeamento }],
      }),
    });

    const claudeJson = await claudeRes.json();
    if (!claudeRes.ok) throw new Error(`Claude erro: ${claudeJson.error?.message}`);

    const textoResposta = claudeJson.content?.[0]?.text ?? "{}";
    console.log("Resposta Claude:", textoResposta.substring(0, 500));

    let respostaIA: any = {};
    try {
      respostaIA = JSON.parse(textoResposta.replace(/```json|```/g, "").trim());
    } catch (e) {
      throw new Error("IA não conseguiu analisar o layout");
    }

    const mapeamentos: Record<number, any> = {};
    for (const m of (respostaIA.mapeamentos ?? [])) {
      mapeamentos[m.indice] = m;
    }

    // Valida\u00e7\u00e3o sem\u00e2ntica: campo_sistema s\u00f3 \u00e9 aceito se existir em
    // CAMPOS_PEDIDO_DISPONIVEIS / CAMPOS_PEDIDO_ITEM_DISPONIVEIS. Sem
    // isso, a IA tinha liberdade pra inventar nomes (id_forma_pagamento,
    // nome_entrega, celular_comprador) que quebravam INSERT/export.
    // Inv\u00e1lido => campo_sistema=null + status_mapeamento="nao_mapeado",
    // que os leitores tratam como "ignorar".
    const colunasFinais = colunasOrdenadas.map((nome, idx) => {
      const m = mapeamentos[idx] ?? {};
      const tipo: "pedido" | "item" = m.tipo === "item" ? "item" : "pedido";
      const candidato = typeof m.campo_sistema === "string" ? m.campo_sistema.trim() : "";
      const valido = candidato.length > 0 && isCampoValido(candidato, tipo);

      if (candidato.length > 0 && !valido) {
        console.warn("campo_sistema recusado (n\u00e3o existe no cat\u00e1logo)", {
          tenant_id,
          posicao: idx,
          nome_coluna: nome,
          valor_recusado: candidato,
          tipo,
          motivo: "fora do cat\u00e1logo CAMPOS_PEDIDO_DISPONIVEIS / CAMPOS_PEDIDO_ITEM_DISPONIVEIS",
        });
      }

      return {
        posicao: idx,
        nome_coluna: nome,
        campo_sistema: valido ? candidato : null,
        tipo,
        obrigatorio: false,
        formato_data: m.formato_data || null,
        status_mapeamento: valido ? "ok" : "nao_mapeado",
      };
    });

    const mapeamento = {
      formato,
      separador,
      tem_cabecalho: true,
      tipo_erp: "bling",
      colunas: colunasFinais,
      observacoes: `${colunasFinais.length} colunas mapeadas na ordem exata do arquivo`,
    };

    const okCount = colunasFinais.filter((c) => c.status_mapeamento === "ok").length;
    const naoMapeadasNomes = colunasFinais
      .filter((c) => c.status_mapeamento === "nao_mapeado")
      .map((c) => c.nome_coluna);
    console.log("Resumo do mapeamento", {
      tenant_id,
      total: colunasFinais.length,
      ok: okCount,
      nao_mapeado: naoMapeadasNomes.length,
      nomes_nao_mapeados: naoMapeadasNomes,
    });

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

    return new Response(
      JSON.stringify({ success: true, mapeamento }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );

  } catch (e) {
    console.error("Erro:", (e as Error).message);
    await registrarErro("ia_error", "analisar-layout-erp", (e as Error).message, {
      severidade: "media",
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
