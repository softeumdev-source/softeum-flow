import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { SUPABASE_URL, getServiceRole } from "../_shared/supabase-client.ts";
import { isServiceRoleCaller, requireTenantAccess } from "../_shared/authz.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_CANDIDATOS_IA = 50;

interface ReqBody {
  tenant_id: string;
  codigo_cliente?: string | null;
  descricao_pedido?: string | null;
  ean?: string | null;
}

interface ProdutoCatalogo {
  id: string;
  codigo_erp: string;
  descricao: string;
  ean: string | null;
  categoria: string | null;
}

interface Sugestao {
  codigo_erp: string;
  descricao: string;
  confianca: number;
  motivo: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = (await req.json()) as ReqBody;
    const tenantId = body.tenant_id;
    const codigoCliente = (body.codigo_cliente ?? "").trim();
    const descricao = (body.descricao_pedido ?? "").trim();
    const ean = (body.ean ?? "").trim();

    if (!tenantId) {
      return jsonResp(400, { error: "tenant_id obrigatório" });
    }
    if (!codigoCliente && !descricao && !ean) {
      return jsonResp(400, { error: "informe ao menos codigo_cliente, descricao_pedido ou ean" });
    }

    const serviceRole = getServiceRole();
    const claudeKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!serviceRole) return jsonResp(500, { error: "Service role não configurado" });

    // Authz: caller precisa ser super admin ou membro do tenant solicitado.
    // Caller interno (processar-email-pdf, simular-cenario-demo) é confiável.
    // Sem isso, qualquer user autenticado podia enumerar o catálogo de
    // produtos de outro tenant via descrição/EAN.
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!isServiceRoleCaller(authHeader, serviceRole)) {
      const anon = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY");
      if (!anon) return jsonResp(500, { error: "Anon key não configurada" });
      const userClient = createClient(SUPABASE_URL, anon, { global: { headers: { Authorization: authHeader } } });
      const { data: userRes } = await userClient.auth.getUser();
      if (!userRes?.user) return jsonResp(401, { error: "Sessão inválida" });

      const authz = await requireTenantAccess(userClient, tenantId);
      if (!authz.ok) {
        await registrarErro("authz_denied", "sugerir-de-para-ia",
          `User ${userRes.user.id} tentou sugerir DE-PARA do tenant ${tenantId}`,
          { severidade: "alta", tenant_id: tenantId, detalhes: { user_id: userRes.user.id, codigo_cliente: codigoCliente, ean } });
        return jsonResp(authz.status!, { error: authz.message });
      }
    }

    if (ean) {
      const matchEan = await buscarPorEan(tenantId, ean, serviceRole);
      if (matchEan) {
        return jsonResp(200, {
          sugestoes: [{
            codigo_erp: matchEan.codigo_erp,
            descricao: matchEan.descricao,
            confianca: 100,
            motivo: "EAN bate com o cadastro do catálogo",
          }] satisfies Sugestao[],
          via: "ean",
        });
      }
    }

    const candidatos = await buscarCandidatos(tenantId, descricao, serviceRole);
    if (candidatos.length === 0) {
      return jsonResp(200, { sugestoes: [], via: "vazio" });
    }

    if (!claudeKey) {
      console.warn("ANTHROPIC_API_KEY não configurada — devolvendo lista bruta sem ranking IA");
      return jsonResp(200, {
        sugestoes: candidatos.slice(0, 3).map((c) => ({
          codigo_erp: c.codigo_erp,
          descricao: c.descricao,
          confianca: 50,
          motivo: "Match textual sem IA (ANTHROPIC_API_KEY ausente)",
        })),
        via: "fallback_sem_ia",
      });
    }

    const sugestoes = await classificarComIA(
      { codigoCliente, descricao, ean },
      candidatos,
      claudeKey,
    );
    return jsonResp(200, { sugestoes, via: "ia" });
  } catch (e) {
    console.error("Erro em sugerir-de-para-ia:", (e as Error).message);
    await registrarErro("edge_function_error", "sugerir-de-para-ia", (e as Error).message, {
      severidade: "media",
      detalhes: { stack: (e as Error).stack },
    });
    return jsonResp(500, { error: (e as Error).message });
  }
});

function jsonResp(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function buscarPorEan(tenantId: string, ean: string, serviceRole: string): Promise<ProdutoCatalogo | null> {
  const url = `${SUPABASE_URL}/rest/v1/catalogo_produtos?tenant_id=eq.${tenantId}&ativo=eq.true&ean=eq.${encodeURIComponent(ean)}&select=id,codigo_erp,descricao,ean,categoria&limit=1`;
  const res = await fetch(url, { headers: authHeaders(serviceRole) });
  if (!res.ok) return null;
  const rows = (await res.json()) as ProdutoCatalogo[];
  return rows[0] ?? null;
}

async function buscarCandidatos(tenantId: string, descricao: string, serviceRole: string): Promise<ProdutoCatalogo[]> {
  const baseUrl = `${SUPABASE_URL}/rest/v1/catalogo_produtos?tenant_id=eq.${tenantId}&ativo=eq.true&select=id,codigo_erp,descricao,ean,categoria`;

  const palavrasUteis = (descricao || "")
    .toLowerCase()
    .replace(/[^a-z0-9áéíóúâêîôûãõç ]/gi, " ")
    .split(/\s+/)
    .filter((p) => p.length >= 4)
    .slice(0, 5);

  if (palavrasUteis.length > 0) {
    const orClauses = palavrasUteis
      .map((p) => `descricao.ilike.*${p.replace(/[*,()]/g, "")}*`)
      .join(",");
    const url = `${baseUrl}&or=(${orClauses})&limit=${MAX_CANDIDATOS_IA}`;
    const res = await fetch(url, { headers: authHeaders(serviceRole) });
    if (res.ok) {
      const rows = (await res.json()) as ProdutoCatalogo[];
      if (rows.length > 0) return rows;
    } else {
      console.warn("Pré-filtragem textual falhou:", await res.text());
    }
  }

  const fallbackUrl = `${baseUrl}&order=codigo_erp.asc&limit=${MAX_CANDIDATOS_IA}`;
  const res = await fetch(fallbackUrl, { headers: authHeaders(serviceRole) });
  if (!res.ok) return [];
  return (await res.json()) as ProdutoCatalogo[];
}

async function classificarComIA(
  pedido: { codigoCliente: string; descricao: string; ean: string },
  candidatos: ProdutoCatalogo[],
  claudeKey: string,
): Promise<Sugestao[]> {
  const catalogoTexto = candidatos.map((c) => ({
    codigo_erp: c.codigo_erp,
    descricao: c.descricao,
    ean: c.ean ?? "",
    categoria: c.categoria ?? "",
  }));

  const prompt = `Você está fazendo DE-PARA entre um produto de pedido de cliente e o catálogo de produtos da indústria.

PRODUTO DO PEDIDO:
- Código do cliente: ${pedido.codigoCliente || "(não informado)"}
- Descrição: ${pedido.descricao || "(não informada)"}
- EAN: ${pedido.ean || "(não informado)"}

CATÁLOGO DA INDÚSTRIA (até ${MAX_CANDIDATOS_IA} candidatos pré-filtrados):
${JSON.stringify(catalogoTexto, null, 2)}

REGRAS:
1. Compare cada candidato com o produto do pedido considerando:
   - Variações de escrita: abreviações, ordem de palavras, plural/singular, marcas vs nomes genéricos, acentos.
   - Unidade de medida e embalagem: 200ml = 200 mL = frasco 200; cx 12 = caixa 12 unidades = display 12.
   - Tamanho/grade quando aplicável.
2. EAN é a fonte mais confiável. Se EAN do pedido for igual ao do candidato, confiança ≈ 100. Se for diferente mas presente, é forte sinal de que NÃO é o mesmo produto.
3. NÃO invente correspondências. Se nenhum candidato tem semelhança plausível, devolva sugestoes: [].
4. Devolva no MÁXIMO 3 sugestões, ordenadas pela maior confiança (decrescente).
5. Campo "motivo": justificativa curta (até 120 caracteres) com base nas pistas usadas.

SAÍDA: APENAS JSON válido, sem markdown, no formato exato:
{"sugestoes":[{"codigo_erp":"...","descricao":"...","confianca":0-100,"motivo":"..."}]}

Se nada combinar com confiança razoável (>= 30), devolva {"sugestoes":[]}.`;

  const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": claudeKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 600,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!claudeRes.ok) {
    const errBody = await claudeRes.text();
    console.error("Claude error:", claudeRes.status, errBody);
    throw new Error(`Falha na chamada Claude: ${claudeRes.status}`);
  }

  const json = await claudeRes.json();
  const texto = (json.content?.[0]?.text ?? "{}") as string;
  const limpo = texto.replace(/```json|```/g, "").trim();

  let parsed: { sugestoes?: Sugestao[] } = {};
  try {
    parsed = JSON.parse(limpo);
  } catch (e) {
    console.error("Falha ao parsear resposta da IA:", limpo);
    return [];
  }
  const sugestoes = Array.isArray(parsed.sugestoes) ? parsed.sugestoes : [];

  const codigosValidos = new Set(candidatos.map((c) => c.codigo_erp));
  return sugestoes
    .filter((s) => s && typeof s.codigo_erp === "string" && codigosValidos.has(s.codigo_erp))
    .slice(0, 3)
    .map((s) => ({
      codigo_erp: s.codigo_erp,
      descricao: String(s.descricao ?? candidatos.find((c) => c.codigo_erp === s.codigo_erp)?.descricao ?? ""),
      confianca: Math.max(0, Math.min(100, Math.round(Number(s.confianca ?? 0)))),
      motivo: String(s.motivo ?? "").slice(0, 200),
    }));
}

function authHeaders(serviceRole: string): HeadersInit {
  return {
    apikey: serviceRole,
    Authorization: `Bearer ${serviceRole}`,
  };
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
