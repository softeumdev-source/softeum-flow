import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { SUPABASE_URL, getServiceRole } from "../_shared/supabase-client.ts";
import { isServiceRoleCaller, requireTenantAccess } from "../_shared/authz.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_COLUNAS = 30;
const TIPO_DADO_WHITELIST = ["text", "numeric", "integer", "date", "timestamptz", "boolean"] as const;
type TipoDado = (typeof TIPO_DADO_WHITELIST)[number];
type Decisao = "mapear_existente" | "criar_coluna" | "ignorar";
type Executor = "system_auto" | "super_admin" | "tenant_admin";

interface ColunaNaoMapeada {
  nome_coluna_origem: string;
  dados_amostra?: string[];
}

interface CatalogoAtual {
  pedido?: string[];
  item?: string[];
}

interface ReqBody {
  tenant_id: string;
  colunas_nao_mapeadas: ColunaNaoMapeada[];
  catalogo_atual?: CatalogoAtual;
}

interface PropostaIA {
  nome_coluna_origem: string;
  decisao: Decisao;
  campo_sistema_resultado?: string | null;
  tabela_alvo?: "pedidos" | "pedido_itens";
  tipo_dado_proposto?: string | null;
  justificativa_ia?: string;
  confianca_ia?: number;
}

interface PropostaResposta {
  id: string;
  nome_coluna_origem: string;
  decisao: Decisao;
  campo_sistema_resultado: string | null;
  tabela_alvo: "pedidos" | "pedido_itens";
  tipo_dado_proposto: string | null;
  justificativa_ia: string | null;
  confianca_ia: number;
  status: "novo" | "ja_existia";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const serviceRole = getServiceRole();
    if (!serviceRole) return jsonResp(500, { error: "Service role não configurado" });

    const claudeKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!claudeKey) return jsonResp(500, { error: "ANTHROPIC_API_KEY não configurada" });

    let body: ReqBody;
    try {
      body = await req.json();
    } catch {
      return jsonResp(400, { error: "Body JSON inválido" });
    }

    const { tenant_id, colunas_nao_mapeadas, catalogo_atual } = body;

    if (!tenant_id || typeof tenant_id !== "string") {
      return jsonResp(400, { error: "tenant_id obrigatório" });
    }
    if (!Array.isArray(colunas_nao_mapeadas) || colunas_nao_mapeadas.length === 0) {
      return jsonResp(400, { error: "colunas_nao_mapeadas deve ser array não-vazio" });
    }
    if (colunas_nao_mapeadas.length > MAX_COLUNAS) {
      return jsonResp(400, { error: `Máximo ${MAX_COLUNAS} colunas por chamada` });
    }
    for (const col of colunas_nao_mapeadas) {
      if (!col.nome_coluna_origem || typeof col.nome_coluna_origem !== "string") {
        return jsonResp(400, { error: "Cada coluna deve ter nome_coluna_origem (string)" });
      }
    }

    // Auth: service_role bypasses, authenticated users need super_admin or tenant_admin
    const authHeader = req.headers.get("Authorization") ?? "";
    let executorTipo: Executor = "system_auto";
    let executorUserId: string | null = null;

    if (!isServiceRoleCaller(authHeader, serviceRole)) {
      const anon = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY");
      if (!anon) return jsonResp(500, { error: "Anon key não configurada" });
      const userClient = createClient(SUPABASE_URL, anon, { global: { headers: { Authorization: authHeader } } });
      const { data: userRes } = await userClient.auth.getUser();
      if (!userRes?.user) return jsonResp(401, { error: "Sessão inválida" });

      executorUserId = userRes.user.id;

      const authz = await requireTenantAccess(userClient, tenant_id);
      if (!authz.ok) return jsonResp(authz.status!, { error: authz.message });

      const { data: isSuper } = await userClient.rpc("is_super_admin");
      const { data: isAdmin } = await userClient.rpc("is_tenant_admin", { p_tenant_id: tenant_id });
      if (!isSuper && !isAdmin) {
        return jsonResp(403, { error: "Apenas super_admin ou tenant_admin podem propor expansão de schema" });
      }
      executorTipo = isSuper ? "super_admin" : "tenant_admin";
    }

    const catalogo = catalogo_atual ?? {};
    const camposPedido = new Set<string>(catalogo.pedido ?? []);
    const camposItem = new Set<string>(catalogo.item ?? []);

    // Call Claude Haiku to decide: mapear_existente | criar_coluna | ignorar
    const propostasIA = await proporComIA(colunas_nao_mapeadas, camposPedido, camposItem, claudeKey);

    // Post-process: validate each IA proposal, coerce invalid ones to ignorar
    const propostasValidadas = propostasIA.map((p) =>
      validarProposta(p, camposPedido, camposItem, colunas_nao_mapeadas)
    );

    // Persist to schema_alteracoes_log
    const sbServiceRole = createClient(SUPABASE_URL, serviceRole);
    const respostas: PropostaResposta[] = [];

    for (const proposta of propostasValidadas) {
      const tabela = proposta.tabela_alvo ?? "pedidos";
      const colOrigem = colunas_nao_mapeadas.find(
        (c) => c.nome_coluna_origem === proposta.nome_coluna_origem,
      );
      const dadosAmostra = colOrigem?.dados_amostra ?? null;

      // criar_coluna: executado_em=NULL (C4 runs DDL later)
      // mapear_existente / ignorar: mark as done immediately
      const executadoEm = proposta.decisao !== "criar_coluna" ? new Date().toISOString() : null;

      const insertRow = {
        tipo_operacao: proposta.decisao,
        tenant_id_origem: tenant_id,
        tabela_alvo: tabela,
        nome_coluna_origem: proposta.nome_coluna_origem,
        campo_sistema_resultado: proposta.campo_sistema_resultado ?? null,
        tipo_dado_proposto: proposta.tipo_dado_proposto ?? null,
        justificativa_ia: proposta.justificativa_ia ?? null,
        dados_amostra: dadosAmostra ?? null,
        confianca_ia: Math.max(0, Math.min(1, proposta.confianca_ia ?? 0)),
        executado_em: executadoEm,
        executor: executorTipo,
        executor_user_id: executorUserId,
      };

      const { data: inserted, error: insertError } = await sbServiceRole
        .from("schema_alteracoes_log")
        .insert(insertRow)
        .select("id")
        .single();

      let rowId: string;
      let status: "novo" | "ja_existia" = "novo";

      if (insertError) {
        if (insertError.code === "23505") {
          // Unique violation: pending entry already exists for this combination.
          // Retrieve the existing row id so caller can reference it.
          const { data: existing } = await sbServiceRole
            .from("schema_alteracoes_log")
            .select("id")
            .eq("tenant_id_origem", tenant_id)
            .eq("tabela_alvo", tabela)
            .ilike("nome_coluna_origem", proposta.nome_coluna_origem)
            .is("executado_em", null)
            .maybeSingle();
          rowId = existing?.id ?? "desconhecido";
          status = "ja_existia";
        } else {
          console.error(`[propor-expansao-schema] Erro ao inserir ${proposta.nome_coluna_origem}:`, insertError);
          rowId = "erro";
        }
      } else {
        rowId = inserted.id;
      }

      respostas.push({
        id: rowId,
        nome_coluna_origem: proposta.nome_coluna_origem,
        decisao: proposta.decisao,
        campo_sistema_resultado: proposta.campo_sistema_resultado ?? null,
        tabela_alvo: tabela,
        tipo_dado_proposto: proposta.tipo_dado_proposto ?? null,
        justificativa_ia: proposta.justificativa_ia ?? null,
        confianca_ia: Math.max(0, Math.min(1, proposta.confianca_ia ?? 0)),
        status,
      });
    }

    const resumo = {
      total: respostas.length,
      mapear_existente: respostas.filter((r) => r.decisao === "mapear_existente").length,
      criar_coluna: respostas.filter((r) => r.decisao === "criar_coluna").length,
      ignorar: respostas.filter((r) => r.decisao === "ignorar").length,
    };

    console.log(`[propor-expansao-schema] tenant=${tenant_id} colunas=${respostas.length} resumo=${JSON.stringify(resumo)}`);
    return jsonResp(200, { propostas: respostas, resumo });
  } catch (e) {
    console.error("[propor-expansao-schema] Erro:", (e as Error).message);
    return jsonResp(500, { error: (e as Error).message });
  }
});

function jsonResp(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function proporComIA(
  colunas: ColunaNaoMapeada[],
  camposPedido: Set<string>,
  camposItem: Set<string>,
  claudeKey: string,
): Promise<PropostaIA[]> {
  const listaPedido = [...camposPedido].sort().join(", ");
  const listaItem = [...camposItem].sort().join(", ");

  const colunasTexto = colunas
    .map((c) => {
      const amostra = (c.dados_amostra ?? []).slice(0, 5).join(", ");
      return `- "${c.nome_coluna_origem}"${amostra ? ` (exemplos: ${amostra})` : ""}`;
    })
    .join("\n");

  const prompt = `Você é especialista em ERPs brasileiros e deve decidir como tratar colunas não mapeadas de um arquivo de pedido.

COLUNAS NÃO MAPEADAS (${colunas.length}):
${colunasTexto}

CAMPOS EXISTENTES NO SISTEMA:
- Tabela "pedidos": ${listaPedido || "(vazio)"}
- Tabela "pedido_itens": ${listaItem || "(vazio)"}

DECISÕES POSSÍVEIS:
1. "mapear_existente" — A coluna corresponde a um campo já existente no sistema. Use quando há equivalência semântica clara.
2. "criar_coluna" — A coluna representa um dado de negócio relevante que não existe no sistema e vale a pena criar. Use com parcimônia: só para informações que clientes frequentemente precisam e que têm valor operacional real.
3. "ignorar" — A coluna é redundante, calculada, de controle interno do ERP ou sem valor para o sistema. Use para totais derivados (ex: total_bruto quando já há preco_unitario e quantidade), identificadores internos do ERP sem sentido externo, campos de auditoria do sistema de origem, etc.

REGRAS:
1. Para "mapear_existente": campo_sistema_resultado DEVE ser exatamente um dos nomes listados em "CAMPOS EXISTENTES NO SISTEMA". Nunca invente nomes novos.
2. Para "criar_coluna": campo_sistema_resultado deve ser snake_case válido (apenas [a-z0-9_], começa com letra, até 63 chars), e NÃO pode duplicar nome existente. tipo_dado_proposto deve ser um de: text, numeric, integer, date, timestamptz, boolean.
3. Para "ignorar": campo_sistema_resultado pode ser null.
4. confianca_ia: número entre 0.0 e 1.0 representando sua certeza na decisão.

SAÍDA: APENAS JSON válido sem markdown, no formato exato:
{"propostas":[{"nome_coluna_origem":"...","decisao":"mapear_existente|criar_coluna|ignorar","campo_sistema_resultado":"...|null","tabela_alvo":"pedidos|pedido_itens","tipo_dado_proposto":"text|numeric|integer|date|timestamptz|boolean|null","justificativa_ia":"...","confianca_ia":0.0}]}

Retorne EXATAMENTE ${colunas.length} objetos no array, um para cada coluna da lista acima, na mesma ordem.`;

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
      temperature: 0,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!claudeRes.ok) {
    const errBody = await claudeRes.text();
    console.error("[propor-expansao-schema] Claude error:", claudeRes.status, errBody);
    throw new Error(`Falha na chamada Claude: ${claudeRes.status}`);
  }

  const json = await claudeRes.json();
  const texto = (json.content?.[0]?.text ?? "{}") as string;
  const limpo = texto.replace(/```json|```/g, "").trim();

  let parsed: { propostas?: PropostaIA[] } = {};
  try {
    parsed = JSON.parse(limpo);
  } catch (e) {
    console.error("[propor-expansao-schema] Falha ao parsear resposta IA:", limpo.substring(0, 500));
    // Return ignorar for all columns as safe fallback
    return colunas.map((c) => ({
      nome_coluna_origem: c.nome_coluna_origem,
      decisao: "ignorar" as Decisao,
      campo_sistema_resultado: null,
      tabela_alvo: "pedidos" as const,
      tipo_dado_proposto: null,
      justificativa_ia: "Falha ao parsear resposta da IA",
      confianca_ia: 0,
    }));
  }

  const propostas = Array.isArray(parsed.propostas) ? parsed.propostas : [];

  // Ensure every input column has a proposal (fill missing with ignorar)
  return colunas.map((col) => {
    const encontrada = propostas.find(
      (p) => p?.nome_coluna_origem?.toLowerCase() === col.nome_coluna_origem.toLowerCase(),
    );
    if (!encontrada) {
      console.warn(`[propor-expansao-schema] IA não retornou proposta para "${col.nome_coluna_origem}", assumindo ignorar`);
      return {
        nome_coluna_origem: col.nome_coluna_origem,
        decisao: "ignorar" as Decisao,
        campo_sistema_resultado: null,
        tabela_alvo: "pedidos" as const,
        tipo_dado_proposto: null,
        justificativa_ia: "IA não retornou proposta para esta coluna",
        confianca_ia: 0,
      };
    }
    return encontrada;
  });
}

function validarProposta(
  p: PropostaIA,
  camposPedido: Set<string>,
  camposItem: Set<string>,
  colunas: ColunaNaoMapeada[],
): PropostaIA {
  const DECISOES_VALIDAS: Decisao[] = ["mapear_existente", "criar_coluna", "ignorar"];
  const REGEX_SNAKE_CASE = /^[a-z][a-z0-9_]{0,62}$/;

  const ignorar = (motivo: string): PropostaIA => ({
    nome_coluna_origem: p.nome_coluna_origem,
    decisao: "ignorar",
    campo_sistema_resultado: null,
    tabela_alvo: p.tabela_alvo ?? "pedidos",
    tipo_dado_proposto: null,
    justificativa_ia: `[Validação: ${motivo}] ${p.justificativa_ia ?? ""}`.trim(),
    confianca_ia: 0,
  });

  // decisao deve ser válida
  if (!DECISOES_VALIDAS.includes(p.decisao)) {
    return ignorar(`decisao inválida: ${p.decisao}`);
  }

  // tabela_alvo
  const tabela = p.tabela_alvo;
  if (tabela !== "pedidos" && tabela !== "pedido_itens") {
    return ignorar(`tabela_alvo inválida: ${tabela}`);
  }

  const camposTabela = tabela === "pedidos" ? camposPedido : camposItem;

  if (p.decisao === "mapear_existente") {
    const campo = p.campo_sistema_resultado;
    if (!campo || !camposTabela.has(campo)) {
      return ignorar(`mapear_existente: campo "${campo}" não existe em ${tabela}`);
    }
    return { ...p, confianca_ia: Math.max(0, Math.min(1, p.confianca_ia ?? 0)) };
  }

  if (p.decisao === "criar_coluna") {
    const campo = p.campo_sistema_resultado;
    if (!campo || !REGEX_SNAKE_CASE.test(campo)) {
      return ignorar(`criar_coluna: campo_sistema_resultado inválido: "${campo}"`);
    }
    if (camposPedido.has(campo) || camposItem.has(campo)) {
      return ignorar(`criar_coluna: campo "${campo}" já existe no catálogo`);
    }
    const tipo = p.tipo_dado_proposto as TipoDado | null | undefined;
    if (!tipo || !(TIPO_DADO_WHITELIST as readonly string[]).includes(tipo)) {
      return ignorar(`criar_coluna: tipo_dado_proposto inválido: "${tipo}"`);
    }
    return { ...p, confianca_ia: Math.max(0, Math.min(1, p.confianca_ia ?? 0)) };
  }

  // ignorar: always valid
  return { ...p, confianca_ia: Math.max(0, Math.min(1, p.confianca_ia ?? 0)) };
}
