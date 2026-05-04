// Helpers compartilhados pelos exportadores (exportar-pedido,
// exportar-pedidos-lote). Após a Fase 3, os exportadores leem direto de
// pedidos.dados_layout (preenchido por processar-email-pdf via Haiku na
// entrada). Não há mais chamada de IA na exportação — só leitura do
// JSON + escape.

// deno-lint-ignore no-explicit-any
type AnyObj = Record<string, any>;

/** 1 linha do dados_layout: chaves === nomes do layout do cliente. */
export type Linha = Record<string, string>;

/**
 * Lê o array de linhas pré-extraído pela Haiku no momento da entrada
 * do pedido (processar-email-pdf). Retorna [] se o pedido não tem
 * dados_layout (pedido legado ou erro na entrada) — caller decide se
 * trata como erro 400 ou pula.
 */
export function lerLinhasDoPedido(pedido: AnyObj): Linha[] {
  const linhas = pedido?.dados_layout?.linhas;
  if (!Array.isArray(linhas)) return [];
  // Defensivo: coage a string. dados_layout deveria já estar normalizado
  // (validador estrutural em processar-email-pdf garante isso), mas em
  // pedidos antigos ou import manual o JSON pode vir bagunçado.
  return linhas.map((l: AnyObj) => {
    const out: Linha = {};
    if (l && typeof l === "object") {
      for (const [k, v] of Object.entries(l)) {
        out[k] = v === null || v === undefined ? "" : String(v);
      }
    }
    return out;
  });
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
