// Helpers compartilhados pelos exportadores (exportar-pedido,
// exportar-pedidos-lote). Após a Etapa 2, a montagem de cada linha de
// exportação é feita pela Haiku — esses helpers só:
//   - escapam CSV/XML
//   - formatam data (uso pontual em stamps)
//   - chamam Haiku com retry + validação determinística
//
// O SYSTEM message e o protocolo de IO estão documentados em
// /tmp/prompt_draft.md (revisão da Etapa 2).

const SYSTEM_PROMPT = `Você é um conversor estrito de dados de pedidos B2B brasileiros para o
layout de exportação de um cliente específico. Sua única tarefa é mapear
campos do PEDIDO e ITENS fornecidos para os nomes de coluna que o cliente
configurou no layout do ERP dele.

REGRAS ABSOLUTAS — viola = falha:

1. USE APENAS os dados literalmente presentes nos blocos PEDIDO e ITENS
   da mensagem do usuário. NUNCA invente, infira, calcule, complete ou
   estime qualquer valor que não esteja escrito ali. Sem exceções.

2. Se uma coluna do layout não tem correspondência clara nos dados:
   retorne string vazia "" para aquela coluna naquela linha. Nunca null,
   nunca "N/A", nunca "-", nunca placeholder.

3. Datas: emita NO FORMATO ESPECIFICADO pela coluna do layout (DD/MM/YYYY
   ou YYYY-MM-DD). Se não houver formato declarado, use DD/MM/YYYY.
   Datas no input vêm em ISO YYYY-MM-DD; converta apenas o formato,
   nunca o conteúdo.

4. Números: emita como vieram (não force casas decimais, não troque
   ponto por vírgula). Strings de número são strings.

5. Saída: APENAS um objeto JSON válido, sem markdown, sem comentários,
   sem texto antes/depois. Se você não conseguir mapear nada, retorne
   {"linhas": []} — mas isso é falha; sempre tente.

6. O JSON deve ter EXATAMENTE 1 entrada em "linhas" por item de ITENS.
   Pedido com 3 itens → linhas tem 3 elementos. Pedido sem itens → 1
   elemento (cabeçalho replicado, colunas tipo "item" vazias).

7. Em cada linha, as CHAVES devem ser EXATAMENTE os nomes de coluna do
   LAYOUT (sem renomear, sem normalizar, sem traduzir, sem remover
   acentos/maiúsculas). Quantidade de chaves por linha = quantidade de
   colunas no layout.

8. Para colunas marcadas como tipo "pedido": mesmo valor em TODAS as
   linhas (cabeçalho replicado).
   Para colunas marcadas como tipo "item": valor específico do item
   daquela linha (item N corresponde à linha N, em ordem).`;

// Campos de metadata interna que NÃO entram no payload pra Haiku — são
// ruído (ids, timestamps, blob bruto da IA de extração, controle de
// envio de email, status de exportação, etc).
const PEDIDO_FIELDS_OMITIR = new Set([
  "id", "tenant_id", "created_at", "updated_at",
  "json_ia_bruto", "xml_original",
  "gmail_message_id", "email_grupo_id",
  "pdf_url", "pdf_hash", "pdf_nome_arquivo",
  "email_remetente", "email_assunto", "email_envelope_from",
  "assunto_email", "remetente_email", "remetente_origem",
  "exportado", "exportado_em", "exportacao_metodo",
  "exportacao_tentativas", "exportacao_erro",
  "aprovado_por", "aprovado_em", "data_aprovacao_pedido",
  "status", "motivo_reprovacao",
  "confianca_ia", "canal_entrada",
  "erp_destino", "erp_id_externo",
  "total_previsto",
]);

const ITEM_FIELDS_OMITIR = new Set([
  "id", "pedido_id", "tenant_id", "created_at", "updated_at",
]);

// deno-lint-ignore no-explicit-any
type AnyObj = Record<string, any>;
export type Linha = Record<string, string>;

export interface GerarLinhasOpts {
  /** Pedido_id — usado em logs de telemetria. */
  pedido_id?: string;
  /** Tenant_id — usado em logs de telemetria. */
  tenant_id?: string;
  /** max_tokens de saída (default 8000). */
  maxTokens?: number;
}

/**
 * Filtra campos de metadata e nulos/vazios — mantém só dado de negócio.
 */
function limparPedido(pedido: AnyObj): AnyObj {
  const out: AnyObj = {};
  for (const [k, v] of Object.entries(pedido)) {
    if (PEDIDO_FIELDS_OMITIR.has(k)) continue;
    if (v === null || v === undefined || v === "") continue;
    out[k] = v;
  }
  return out;
}

function limparItem(item: AnyObj): AnyObj {
  const out: AnyObj = {};
  for (const [k, v] of Object.entries(item)) {
    if (ITEM_FIELDS_OMITIR.has(k)) continue;
    if (v === null || v === undefined || v === "") continue;
    out[k] = v;
  }
  return out;
}

function montarUserMessage(pedido: AnyObj, itens: AnyObj[], colunas: AnyObj[]): string {
  const pedidoLimpo = limparPedido(pedido);
  const itensLimpos = (itens ?? []).map(limparItem);
  const N = colunas.length;

  const layoutTxt = colunas
    .map((c, idx) => {
      const tipo = c.tipo === "item" ? "item" : "pedido";
      const fmt = c.formato_data ? `   (formato: ${c.formato_data})` : "";
      return `${idx + 1}. [${tipo}] ${JSON.stringify(c.nome_coluna)}${fmt}`;
    })
    .join("\n");

  return `PEDIDO:
${JSON.stringify(pedidoLimpo, null, 2)}

ITENS:
${JSON.stringify(itensLimpos, null, 2)}

LAYOUT DO ERP DO CLIENTE (na ordem exata, repete por item):
${layoutTxt}

TAREFA:
Devolva JSON com 1 entrada em "linhas" por item, formato:

{
  "linhas": [
    { "Nome Coluna 1": "valor", "Nome Coluna 2": "valor", ... },
    { ... }
  ]
}

Cada linha deve ter EXATAMENTE as ${N} chaves do layout, na ordem listada
acima. Para colunas tipo [pedido]: mesmo valor em todas as linhas. Para
colunas tipo [item]: valor específico do item N. Use "" para coluna sem
dado correspondente. NUNCA invente.`;
}

async function chamarHaiku(
  systemMsg: string,
  userMsg: string,
  claudeKey: string,
  maxTokens: number,
): Promise<string> {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": claudeKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: maxTokens,
      system: systemMsg,
      messages: [{ role: "user", content: userMsg }],
    }),
  });
  const json = await r.json();
  if (!r.ok) {
    throw new Error(`Haiku HTTP ${r.status}: ${json?.error?.message ?? "sem mensagem"}`);
  }
  const texto = json?.content?.[0]?.text;
  if (typeof texto !== "string") {
    throw new Error("Haiku retornou resposta sem content[0].text");
  }
  return texto.replace(/```json|```/g, "").trim();
}

function parseLinhas(raw: string): Linha[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`JSON inválido da Haiku: ${(e as Error).message}`);
  }
  const linhas = (parsed as { linhas?: unknown })?.linhas;
  if (!Array.isArray(linhas)) {
    throw new Error("Resposta da Haiku sem array 'linhas'");
  }
  // Coage tudo a string (Haiku pode retornar number aqui ou ali apesar
  // da regra). null/undefined viram "".
  return linhas.map((l) => {
    const out: Linha = {};
    if (l && typeof l === "object") {
      for (const [k, v] of Object.entries(l as AnyObj)) {
        out[k] = v === null || v === undefined ? "" : String(v);
      }
    }
    return out;
  });
}

/**
 * Validação ESTRUTURAL — falha bloqueia exportação.
 * - Quantidade de linhas: 1 por item, ou 1 se não há itens.
 * - Cada linha: chaves devem === nomes do layout (set equality).
 */
function validarEstrutura(linhas: Linha[], colunas: AnyObj[], qtdItens: number): void {
  const esperado = Math.max(qtdItens, 1);
  if (linhas.length !== esperado) {
    throw new Error(`Haiku retornou ${linhas.length} linhas; esperado ${esperado} (1 por item)`);
  }
  const nomesLayout = new Set(colunas.map((c) => String(c.nome_coluna)));
  for (let i = 0; i < linhas.length; i++) {
    const chavesLinha = new Set(Object.keys(linhas[i]));
    if (chavesLinha.size !== nomesLayout.size) {
      throw new Error(
        `Linha ${i}: ${chavesLinha.size} chaves; esperado ${nomesLayout.size}`,
      );
    }
    for (const nome of nomesLayout) {
      if (!chavesLinha.has(nome)) {
        throw new Error(`Linha ${i}: falta chave "${nome}"`);
      }
    }
  }
}

/**
 * Validação ANTI-HALLUCINATION — permissiva: warn + telemetria, não bloqueia.
 * Para cada valor não-vazio que não seja transformação trivial de data,
 * checa se aparece literalmente em pedido/itens. Se não aparece, registra.
 */
function validarAntiHallucination(
  linhas: Linha[],
  pedido: AnyObj,
  itens: AnyObj[],
  opts: GerarLinhasOpts,
): void {
  const haystack = JSON.stringify(limparPedido(pedido)) +
    JSON.stringify((itens ?? []).map(limparItem));
  const suspeitos: Array<{ linha: number; chave: string; valor: string }> = [];

  for (let i = 0; i < linhas.length; i++) {
    for (const [chave, valor] of Object.entries(linhas[i])) {
      if (!valor) continue;
      if (haystack.includes(valor)) continue;
      // Aceita transformação trivial de data DD/MM/YYYY ↔ YYYY-MM-DD
      const m = valor.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (m && haystack.includes(`${m[3]}-${m[2]}-${m[1]}`)) continue;
      const m2 = valor.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (m2 && haystack.includes(`${m2[3]}/${m2[2]}/${m2[1]}`)) continue;
      suspeitos.push({ linha: i, chave, valor });
    }
  }

  if (suspeitos.length > 0) {
    console.warn("[exportador] valores suspeitos (não-literais) na resposta da Haiku", {
      pedido_id: opts.pedido_id,
      tenant_id: opts.tenant_id,
      qtd: suspeitos.length,
      amostra: suspeitos.slice(0, 5),
    });
  }
}

/**
 * Pipeline completo: Haiku call → parse → validação estrutural (throw) →
 * validação anti-hallucination (warn) → retorna linhas prontas pra serem
 * consumidas pelos writers (CSV/XLSX/XML/JSON).
 *
 * Retry: 1 tentativa adicional se a primeira falhar (HTTP, parse ou
 * estrutura). Anti-hallucination não conta como falha — só warn.
 */
export async function gerarLinhasViaHaiku(
  pedido: AnyObj,
  itens: AnyObj[],
  mapeamento: AnyObj,
  claudeKey: string,
  opts: GerarLinhasOpts = {},
): Promise<Linha[]> {
  const colunas = (mapeamento?.colunas ?? []).filter(
    (c: AnyObj) => c?.nome_coluna,
  );
  if (colunas.length === 0) {
    throw new Error("Layout sem colunas");
  }

  const userMsg = montarUserMessage(pedido, itens ?? [], colunas);
  const maxTokens = opts.maxTokens ?? 8000;

  let ultimoErro: Error | null = null;
  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    try {
      const raw = await chamarHaiku(SYSTEM_PROMPT, userMsg, claudeKey, maxTokens);
      const linhas = parseLinhas(raw);
      validarEstrutura(linhas, colunas, (itens ?? []).length);
      validarAntiHallucination(linhas, pedido, itens ?? [], opts);
      if (tentativa > 1) {
        console.log("[exportador] sucesso no retry", { pedido_id: opts.pedido_id });
      }
      return linhas;
    } catch (e) {
      ultimoErro = e as Error;
      console.warn(`[exportador] tentativa ${tentativa} falhou: ${ultimoErro.message}`, {
        pedido_id: opts.pedido_id,
      });
    }
  }
  throw new Error(`ia_validation_failed: ${ultimoErro?.message ?? "desconhecido"}`);
}

export function escaparCSV(valor: string, sep: string): string {
  const s = String(valor);
  if (s.includes(sep) || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function escaparXML(valor: string): string {
  return valor
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function formatarData(dataISO: string | null | undefined): string {
  if (!dataISO) return "";
  const d = new Date(dataISO);
  if (isNaN(d.getTime())) return String(dataISO);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = String(d.getFullYear());
  return `${dd}/${mm}/${yyyy}`;
}
