// Helpers compartilhados pelos exportadores (exportar-pedido,
// exportar-pedidos-lote). Centralizam:
// - Mapa de aliases (campos do layout ERP traduzidos pros canônicos
//   do nosso schema de pedido/item).
// - Fallbacks recíprocos (ex: comprador vazio → cai pra empresa).
// - Helpers de formatação (CSV escape, XML escape, data).

/**
 * Aliases comuns usados por ERPs/indústrias/distribuidores.
 * A IA do analisar-layout-erp tenta usar nomes canônicos, mas costuma
 * variar — esta tabela traduz pra o nome canônico que a função
 * montarCamposPedido / montarCamposItem expõe.
 *
 * Também contém mapeamentos de compatibilidade retroativa para campo_sistema
 * antigos (gerados pelo analisar-layout-erp antes da migration 20260524) que
 * não correspondem às colunas reais do banco de dados.
 */
export const ALIAS_CAMPO: Record<string, string> = {
  // ====== Pedido / cabeçalho ======
  comprador: "nome_comprador",
  responsavel: "nome_comprador",
  responsavel_pedido: "nome_comprador",
  cliente: "nome_comprador",
  razao_social: "nome_comprador",
  razaosocial: "nome_comprador",
  razao: "nome_comprador",

  nome_cliente: "empresa",
  nome_empresa: "empresa",
  fantasia: "empresa",
  nome_fantasia: "empresa",

  cnpj_comprador: "cnpj",
  cnpj_cliente: "cnpj",
  cnpj_empresa: "cnpj",

  data: "data_emissao",
  data_pedido: "data_emissao",
  dt_pedido: "data_emissao",
  data_ped: "data_emissao",
  data_do_pedido: "data_emissao",

  numero_pedido: "numero_pedido_cliente",
  num_pedido: "numero_pedido_cliente",
  numero: "numero_pedido_cliente",
  pedido: "numero_pedido_cliente",
  nro_pedido: "numero_pedido_cliente",
  pedido_numero: "numero_pedido_cliente",
  no_pedido: "numero_pedido_cliente",

  total: "valor_total",
  total_pedido: "valor_total",
  vl_total: "valor_total",
  valor_pedido: "valor_total",

  email: "email_comprador",
  e_mail: "email_comprador",
  email_cliente: "email_comprador",

  telefone: "telefone_comprador",
  fone: "telefone_comprador",
  contato: "telefone_comprador",
  tel: "telefone_comprador",
  celular_comprador: "telefone_comprador",
  celular: "telefone_comprador",

  // Compatibilidade retroativa: analisar-layout-erp antigo usava "faturamento"
  // mas o schema só tem colunas de "entrega".
  endereco_faturamento: "endereco_entrega",
  bairro_faturamento: "bairro_entrega",
  numero_faturamento: "numero_entrega",
  complemento_faturamento: "complemento_entrega",
  cep_faturamento: "cep_entrega",
  cidade_faturamento: "cidade_entrega",
  estado_faturamento: "estado_entrega",

  // Outros aliases retroativos
  nome_entrega: "local_entrega",
  servico_transportadora: "transportadora",
  valor_desconto: "desconto_adicional",
  outras_despesas: "observacoes_gerais",
  numero_parcelas: "prazo_pagamento_dias",
  data_entrega: "data_entrega_solicitada",
  dt_entrega: "data_entrega_solicitada",
  prazo_entrega: "data_entrega_solicitada",

  // ====== Itens ======
  produto: "descricao",
  descricao_produto: "descricao",
  desc: "descricao",
  nome_produto: "descricao",

  codigo: "codigo_produto_erp",
  cod: "codigo_produto_erp",
  cod_produto: "codigo_produto_erp",
  sku: "codigo_produto_erp",
  item: "codigo_produto_erp",
  referencia: "codigo_produto_erp",
  ref: "codigo_produto_erp",

  qtd: "quantidade",
  qtde: "quantidade",
  qntd: "quantidade",
  quant: "quantidade",

  preco: "preco_unitario",
  vl_unit: "preco_unitario",
  valor_unitario: "preco_unitario",
  preco_unit: "preco_unitario",
  vlr_unit: "preco_unitario",

  total_item: "preco_total",
  valor_total_item: "preco_total",
  vl_total_item: "preco_total",
  vlr_total: "preco_total",

  unidade: "unidade_medida",
  un: "unidade_medida",
  unid: "unidade_medida",
  und: "unidade_medida",

  codigo_barras: "ean",
  cod_barras: "ean",
  barcode: "ean",
};

/** Resolve um campo aplicando alias quando o nome não é canônico. */
export function resolverChave(chave: string): string {
  if (!chave) return chave;
  const lower = chave.trim().toLowerCase();
  return ALIAS_CAMPO[lower] ?? chave;
}

/** Lê um valor da fonte (camposPedido ou camposItem) tolerando aliases. */
export function getCampo(fonte: Record<string, any>, chave: string): any {
  if (chave in fonte) return fonte[chave] ?? "";
  const canonica = resolverChave(chave);
  if (canonica in fonte) return fonte[canonica] ?? "";
  return "";
}

/**
 * Monta o objeto de campos do pedido com casos especiais fixos (crosslinks,
 * formatação de data, valor calculado) + sweep dinâmico de todos os
 * campo_sistema do mapeamento — suporta layouts com qualquer número de colunas.
 *
 * Estratégia de resolução de valor (em ordem de prioridade):
 *   1. Coluna direta no DB (pedido[campo])
 *   2. json_ia_bruto (ia[campo])
 *   3. Alias canônico via ALIAS_CAMPO (ex: "endereco_faturamento" → "endereco_entrega")
 *
 * Ao final, todos os campos não-nulos do pedido são copiados para a base,
 * garantindo que dados presentes no DB sempre apareçam na exportação
 * independente do campo_sistema configurado no mapeamento.
 */
export function montarCamposPedido(pedido: any, mapeamento: any): Record<string, any> {
  // json_ia_bruto pode ser objeto (JSONB) ou string (bug antigo de double-encode)
  const ia = (typeof pedido.json_ia_bruto === "object" && pedido.json_ia_bruto !== null)
    ? pedido.json_ia_bruto
    : {};

  // Resolve valor tentando: DB → json_ia_bruto → alias DB → alias IA
  const v = (campo: string, fallback: any = ""): any => {
    if (pedido[campo] != null && pedido[campo] !== "") return pedido[campo];
    if (ia[campo] != null && ia[campo] !== "") return ia[campo];
    const canonical = resolverChave(campo);
    if (canonical !== campo) {
      if (pedido[canonical] != null && pedido[canonical] !== "") return pedido[canonical];
      if (ia[canonical] != null && ia[canonical] !== "") return ia[canonical];
    }
    return fallback;
  };

  const itensIA = ia.itens ?? [];
  const valorTotalCalculado = itensIA.reduce(
    (acc: number, it: any) => acc + (Number(it.preco_total) || 0),
    0,
  );

  const empresa = v("empresa") || ia.empresa_cliente || "";
  const nomeComprador = v("nome_comprador") || ia.nome_comprador || "";

  // Casos especiais com lógica própria (crosslinks, fallbacks encadeados, formatação).
  const base: Record<string, any> = {
    numero_pedido_cliente: v("numero_pedido_cliente") || ia.numero_pedido || pedido.numero || "",
    nome_comprador: nomeComprador || empresa,
    empresa: empresa || nomeComprador,
    nome_fantasia_cliente: v("nome_fantasia_cliente") || ia.nome_fantasia_cliente || "",
    data_emissao: formatarData(
      v("data_emissao") || v("data_pedido") || ia.data_pedido || ia.data_emissao || pedido.created_at,
      mapeamento?.colunas ?? [],
    ),
    cnpj: v("cnpj") || ia.cnpj || "",
    email_comprador: v("email_comprador") || pedido.remetente_email || "",
    remetente_email: v("remetente_email") || pedido.remetente_email || "",
    observacoes_gerais: v("observacoes_gerais") || ia.observacoes || "",
    condicao_pagamento: v("condicao_pagamento") || ia.condicao_pagamento || "",
    valor_total: v("valor_total") || ia.valor_total || valorTotalCalculado || "",
    valor_frete: v("valor_frete") || ia.valor_frete || "",
  };

  // Sweep 1: campos do mapeamento do cliente ainda não presentes.
  for (const col of (mapeamento?.colunas ?? [])) {
    if (col?.tipo !== "item" && col?.campo_sistema && !(col.campo_sistema in base)) {
      base[col.campo_sistema] = v(col.campo_sistema);
    }
  }

  // Sweep 2: passthrough de TODOS os campos não-nulos do pedido do banco.
  // Garante que qualquer dado salvo no DB apareça disponível para exportação,
  // independente de como está configurado o campo_sistema no mapeamento.
  const IGNORAR = new Set(["json_ia_bruto"]);
  for (const [k, val] of Object.entries(pedido)) {
    if (IGNORAR.has(k)) continue;
    if (!(k in base) && val != null && val !== "") {
      base[k] = val;
    }
  }

  return base;
}

/**
 * Monta o objeto de campos do item com casos especiais fixos (DE-PARA,
 * unidade padrão) + sweep dinâmico dos campo_sistema do mapeamento.
 * O parâmetro mapeamento é opcional para compatibilidade retroativa.
 */
export function montarCamposItem(
  item: any,
  contador: { comDePara: number; comOriginal: number },
  mapeamento?: any,
): Record<string, any> {
  const codErp = String(item.codigo_produto_erp ?? "").trim();
  const codCliente = String(item.codigo_cliente ?? "").trim();
  const usouDePara = codErp !== "";
  if (usouDePara) contador.comDePara++;
  else contador.comOriginal++;

  // Casos especiais com lógica própria (DE-PARA, unidade default).
  const base: Record<string, any> = {
    descricao: item.descricao ?? "",
    codigo_cliente: item.codigo_cliente ?? "",
    codigo_produto_erp: usouDePara ? codErp : codCliente,
    unidade_medida: item.unidade_medida ?? "UN",
    quantidade: item.quantidade ?? "",
    preco_unitario: item.preco_unitario ?? "",
    preco_total: item.preco_total ?? "",
    ean: item.ean ?? "",
  };

  // Sweep dinâmico: adiciona qualquer campo de item do layout ainda não presente.
  for (const col of (mapeamento?.colunas ?? [])) {
    if (col?.tipo === "item" && col?.campo_sistema && !(col.campo_sistema in base)) {
      base[col.campo_sistema] = item[col.campo_sistema] ?? "";
    }
  }

  return base;
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

export function formatarData(dataISO: string | null | undefined, colunas: any[]): string {
  if (!dataISO) return "";
  const col = (colunas ?? []).find((c: any) => c.campo_sistema === "data_emissao");
  const fmt = col?.formato_data ?? "DD/MM/YYYY";
  const d = new Date(dataISO);
  if (isNaN(d.getTime())) return String(dataISO);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = String(d.getFullYear());
  if (fmt === "YYYY-MM-DD") return `${yyyy}-${mm}-${dd}`;
  return `${dd}/${mm}/${yyyy}`;
}

/**
 * Filtra o array de colunas mantendo a ordem do arquivo original
 * (preservada na propriedade `posicao` desde o analisar-layout-erp,
 * mas a ordem do array já reflete isso). Remove apenas colunas
 * marcadas como "não mapeado".
 */
export function colunasOrdenadas(colunas: any[]): any[] {
  return (colunas ?? []).filter((c: any) => c?.campo_sistema !== "não mapeado");
}

/** Resolve o valor de uma coluna na linha sendo gerada. */
export function valorDaColuna(
  col: any,
  camposPedido: Record<string, any>,
  camposItem: Record<string, any>,
): any {
  const fonte = col?.tipo === "item" ? camposItem : camposPedido;
  return getCampo(fonte, String(col?.campo_sistema ?? ""));
}
