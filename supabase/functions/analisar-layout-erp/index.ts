import * as XLSX from "npm:xlsx@0.18.5";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { SUPABASE_URL, getServiceRole } from "../_shared/supabase-client.ts";
import { isServiceRoleCaller, requireTenantAccess } from "../_shared/authz.ts";
import {
  CAMPOS_PEDIDO_DISPONIVEIS,
  CAMPOS_PEDIDO_ITEM_DISPONIVEIS,
  carregarCatalogoCampos,
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

// Schema da coluna mapeada. fonte_mapeamento, status_mapeamento_motivo
// e log_id são adições da Parte C4 (auto-expansão). Antes da C4, todas
// as colunas vinham com fonte_mapeamento=null e os outros dois também.
interface ColunaMapeada {
  posicao: number;
  nome_coluna: string;
  campo_sistema: string | null;
  tipo: "pedido" | "item";
  obrigatorio: boolean;
  formato_data: string | null;
  status_mapeamento: "ok" | "nao_mapeado";
  fonte_mapeamento: "ia_inicial" | "ia_expansao" | "ia_expansao_criou" | null;
  status_mapeamento_motivo: "falha_ddl" | "ia_decidiu_ignorar" | null;
  log_id: string | null;
}

interface PropostaC4 {
  id: string;
  nome_coluna_origem: string;
  decisao: "mapear_existente" | "criar_coluna" | "ignorar";
  campo_sistema_resultado: string | null;
  tabela_alvo: "pedidos" | "pedido_itens";
  tipo_dado_proposto: string | null;
  justificativa_ia: string | null;
  confianca_ia: number;
  status: "novo" | "ja_existia";
}

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

// Parser de uma única linha CSV/CSV-like respeitando aspas. Retorna
// array de células sem aspas externas, sem trim (mantém espaços internos).
function parseLinhaCSV(linha: string, sep: string): string[] {
  const celulas: string[] = [];
  let atual = "";
  let dentroAspas = false;
  for (let i = 0; i < linha.length; i++) {
    const ch = linha[i];
    if (ch === '"') {
      dentroAspas = !dentroAspas;
    } else if (ch === sep && !dentroAspas) {
      celulas.push(atual);
      atual = "";
    } else {
      atual += ch;
    }
  }
  celulas.push(atual);
  return celulas;
}

// Trunca valor de amostra >100 chars com '…' pra evitar bloat no payload
// da IA #2 e em logs.
function truncarAmostra(v: string): string {
  return v.length > 100 ? v.slice(0, 99) + "…" : v;
}

// Extrai até 3 amostras por coluna a partir das próximas linhas após
// o cabeçalho. Células vazias/whitespace-only são filtradas — coluna
// sem dados retorna [].
function extrairAmostrasDeLinhas(linhas: string[], sep: string, totalColunas: number): string[][] {
  const amostras: string[][] = Array.from({ length: totalColunas }, () => []);
  const dataRows = linhas.slice(1, 4); // até 3 linhas pós-cabeçalho
  for (const linha of dataRows) {
    if (!linha.trim()) continue;
    const cels = parseLinhaCSV(linha, sep);
    for (let idx = 0; idx < totalColunas; idx++) {
      const raw = (cels[idx] ?? "").trim().replace(/^"|"$/g, "");
      if (raw.length > 0) amostras[idx].push(truncarAmostra(raw));
    }
  }
  return amostras;
}

function extrairColunasXLSX(rawArquivo: string): { colunas: string[]; preview: string; amostras: string[][] } {
  let b64 = rawArquivo;
  if (b64.includes(";base64,")) b64 = b64.split(";base64,")[1];
  const binaryString = atob(b64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
  const workbook = XLSX.read(bytes, { type: "array" });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const csv = XLSX.utils.sheet_to_csv(sheet);
  const linhas = csv.split(/\r\n|\r|\n/);
  const colunas = parseLinhaCSV(linhas[0] ?? "", ",")
    .map((c) => c.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);
  const amostras = extrairAmostrasDeLinhas(linhas, ",", colunas.length);
  console.log("Colunas XLSX extraídas:", colunas.length);
  return { colunas, preview: csv.substring(0, 3000), amostras };
}

function extrairColunasCsv(conteudo: string): { colunas: string[]; separador: string; preview: string; amostras: string[][] } {
  const linhas = conteudo.split(/\r\n|\r|\n/);
  const primeiraLinha = linhas[0] ?? "";

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

  const colunas = parseLinhaCSV(primeiraLinha, melhorSep)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);

  const amostras = extrairAmostrasDeLinhas(linhas, melhorSep, colunas.length);

  const sepNome = melhorSep === "\t" ? "tab" : melhorSep === "|" ? "pipe" : melhorSep;
  console.log(`Separador: "${sepNome}", colunas: ${colunas.length}`);
  return { colunas, separador: sepNome, preview: conteudo.substring(0, 3000), amostras };
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

    // Catálogo dinâmico de campos mapeáveis (Parte C2). Lê do banco via RPC
    // `listar_campos_pedidos_disponiveis`; se a RPC falhar, cai para a lista
    // hardcoded como rede de segurança. Carregamento por invocação, sem cache.
    const sbServiceRole = createClient(SUPABASE_URL, serviceRole);
    const catalogo = await carregarCatalogoCampos(sbServiceRole);
    if (catalogo.fonte === "fallback_hardcoded") {
      console.warn("[analisar-layout-erp] Catálogo carregado via fallback hardcoded");
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
    // Amostras por coluna (até 3 valores truncados em 100 chars). Usado
    // pela IA #2 (propor-expansao-schema) na Parte C4. JSON/XML ainda não
    // têm coletor de amostras — passa array vazio (IA #2 trata como sinal
    // pra ignorar com confiança baixa).
    let amostrasPorColuna: string[][] = [];

    if (filename.endsWith(".xlsx") || filename.endsWith(".xls") || mime.includes("spreadsheet") || mime.includes("excel")) {
      const resultado = extrairColunasXLSX(rawArquivo);
      colunasOrdenadas = resultado.colunas;
      preview = resultado.preview;
      amostrasPorColuna = resultado.amostras;
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
      amostrasPorColuna = resultado.amostras;
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
    const colunasFinais: ColunaMapeada[] = colunasOrdenadas.map((nome, idx) => {
      const m = mapeamentos[idx] ?? {};
      const tipo: "pedido" | "item" = m.tipo === "item" ? "item" : "pedido";
      const candidato = typeof m.campo_sistema === "string" ? m.campo_sistema.trim() : "";
      const valido = candidato.length > 0 && isCampoValido(candidato, tipo, catalogo);

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
        fonte_mapeamento: valido ? "ia_inicial" : null,
        status_mapeamento_motivo: null,
        log_id: null,
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

    // ─────────────────────────────────────────────────────────────
    // Parte C4: hook IA #2 (propor-expansao-schema) + DDL loop pra
    // colunas não-mapeadas. Roda ANTES do PATCH pra atomicidade —
    // estado intermediário "salvo mas com pendências" nunca é
    // visível no banco.
    // ─────────────────────────────────────────────────────────────
    const ddlResultados = new Map<string, { ok: boolean; erro?: string }>();
    if (naoMapeadasNomes.length === 0) {
      console.log("[c4] nenhum não-mapeado, pulando IA #2", { tenant_id });
    } else {
      console.log("[c4] não-mapeados detectados", {
        tenant_id,
        count: naoMapeadasNomes.length,
        nomes: naoMapeadasNomes,
      });

      const colunasParaIA2 = colunasFinais
        .filter((c) => c.status_mapeamento === "nao_mapeado")
        .map((c) => ({
          nome_coluna_origem: c.nome_coluna,
          dados_amostra: amostrasPorColuna[c.posicao] ?? [],
        }));

      const catalogoAtual = {
        pedido: [...catalogo.pedido],
        item: [...catalogo.item],
      };

      let respostaIA2: { propostas: PropostaC4[]; resumo: Record<string, number> } | null = null;
      try {
        const r = await fetch(`${SUPABASE_URL}/functions/v1/propor-expansao-schema`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: serviceRole,
            Authorization: `Bearer ${serviceRole}`,
          },
          body: JSON.stringify({
            tenant_id,
            colunas_nao_mapeadas: colunasParaIA2,
            catalogo_atual: catalogoAtual,
          }),
        });
        if (!r.ok) {
          throw new Error(`propor-expansao-schema retornou HTTP ${r.status}: ${await r.text()}`);
        }
        respostaIA2 = await r.json();
      } catch (e) {
        console.error("[c4] IA #2 falhou, mantendo mapeamento original:", (e as Error).message);
      }

      if (respostaIA2) {
        const propostas = respostaIA2.propostas ?? [];
        console.log("[c4] propostas IA #2", { tenant_id, resumo: respostaIA2.resumo });

        // DDL loop: criar_coluna inclui status=ja_existia (self-healing).
        // executar_ddl_expansao_pedido valida internamente executado_em IS NULL.
        const paraDDL = propostas.filter((p) => p.decisao === "criar_coluna");
        console.log("[c4] iniciando DDLs", { qtd: paraDDL.length });
        for (const proposta of paraDDL) {
          try {
            const { data, error } = await sbServiceRole.rpc(
              "executar_ddl_expansao_pedido",
              { p_log_id: proposta.id },
            );
            if (error) {
              console.error("[c4] DDL falhou", {
                coluna: proposta.campo_sistema_resultado,
                log_id: proposta.id,
                erro: error.message,
              });
              ddlResultados.set(proposta.id, { ok: false, erro: error.message });
            } else {
              console.log("[c4] DDL ok", {
                coluna: proposta.campo_sistema_resultado,
                tabela: proposta.tabela_alvo,
                log_id: proposta.id,
                resultado: data,
              });
              ddlResultados.set(proposta.id, { ok: true });
            }
          } catch (e) {
            const msg = (e as Error).message;
            console.error("[c4] DDL exception", { log_id: proposta.id, erro: msg });
            ddlResultados.set(proposta.id, { ok: false, erro: msg });
          }
        }
        const sucessos = [...ddlResultados.values()].filter((r) => r.ok).length;
        const falhas = ddlResultados.size - sucessos;
        console.log("[c4] DDLs concluídas", { sucesso: sucessos, falha: falhas });

        // Aplicar decisões da IA #2 nas colunas originalmente não-mapeadas
        const propostasMap = new Map(propostas.map((p) => [p.nome_coluna_origem, p]));
        for (const col of colunasFinais) {
          if (col.status_mapeamento !== "nao_mapeado") continue;
          const prop = propostasMap.get(col.nome_coluna);
          if (!prop) continue;

          const tipoDoAlvo: "pedido" | "item" =
            prop.tabela_alvo === "pedido_itens" ? "item" : "pedido";

          if (prop.decisao === "mapear_existente") {
            col.campo_sistema = prop.campo_sistema_resultado;
            col.tipo = tipoDoAlvo;
            col.status_mapeamento = "ok";
            col.fonte_mapeamento = "ia_expansao";
            col.log_id = prop.id;
          } else if (prop.decisao === "criar_coluna") {
            const ddl = ddlResultados.get(prop.id);
            if (ddl?.ok) {
              col.campo_sistema = prop.campo_sistema_resultado;
              col.tipo = tipoDoAlvo;
              col.status_mapeamento = "ok";
              col.fonte_mapeamento = "ia_expansao_criou";
              col.log_id = prop.id;
            } else {
              col.status_mapeamento_motivo = "falha_ddl";
              col.log_id = prop.id;
            }
          } else {
            // ignorar
            col.status_mapeamento_motivo = "ia_decidiu_ignorar";
            col.log_id = prop.id;
          }
        }

        // Remontar mapeamento.colunas com colunasFinais atualizadas
        mapeamento.colunas = colunasFinais;
        const okFinal = colunasFinais.filter((c) => c.status_mapeamento === "ok").length;
        const naoMapFinal = colunasFinais.filter((c) => c.status_mapeamento === "nao_mapeado").length;
        console.log("[c4] mapeamento_campos atualizado", {
          tenant_id,
          ok: okFinal,
          nao_mapeado: naoMapFinal,
        });
      }
    }

    // PATCH com retry (3 tentativas, backoff linear). Schema pode ter
    // crescido pelas DDLs antes; se o PATCH falhar, log compensatório
    // em system_errors permite reconciliação manual.
    const patchOk = await patchMapeamentoComRetry(
      `${SUPABASE_URL}/rest/v1/tenant_erp_config?tenant_id=eq.${tenant_id}`,
      { mapeamento_campos: mapeamento },
      serviceRole,
    );
    if (!patchOk) {
      const ddlsAplicadas = [...ddlResultados.entries()]
        .filter(([, v]) => v.ok)
        .map(([k]) => k);
      console.error("[c4] PATCH falhou após retries", { tenant_id, ddls_aplicadas: ddlsAplicadas });
      await registrarErro(
        "patch_mapeamento_falhou",
        "analisar-layout-erp/c4",
        "PATCH em tenant_erp_config falhou após 3 tentativas; schema pode ter crescido sem mapeamento atualizado",
        {
          severidade: "alta",
          tenant_id,
          detalhes: {
            ddls_aplicadas: ddlsAplicadas,
            mapeamento_que_seria_salvo: mapeamento,
          },
        },
      );
      return new Response(
        JSON.stringify({
          error:
            "Schema pode ter sido alterado (DDLs aplicadas) mas mapeamento_campos não foi salvo. Operador deve intervir.",
          ddls_aplicadas: ddlsAplicadas,
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

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

async function patchMapeamentoComRetry(
  url: string,
  body: unknown,
  serviceRole: string,
  maxTentativas = 3,
): Promise<boolean> {
  for (let i = 0; i < maxTentativas; i++) {
    try {
      const r = await fetch(url, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          apikey: serviceRole,
          Authorization: `Bearer ${serviceRole}`,
        },
        body: JSON.stringify(body),
      });
      if (r.ok) return true;
      console.warn(`[c4] PATCH tentativa ${i + 1} falhou: HTTP ${r.status}`);
    } catch (e) {
      console.warn(`[c4] PATCH tentativa ${i + 1} exception:`, (e as Error).message);
    }
    if (i < maxTentativas - 1) {
      await new Promise((res) => setTimeout(res, 1000 * (i + 1)));
    }
  }
  return false;
}

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
