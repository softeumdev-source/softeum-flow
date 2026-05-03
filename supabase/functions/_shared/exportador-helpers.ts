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
 * Monta o objeto de campos disponíveis no nível pedido com cadeia de
 * fallbacks. Inclui fallbacks recíprocos entre comprador↔empresa pra
 * cobrir layouts ERP que usam um termo ou outro.
 */
export function montarCamposPedido(pedido: any, mapeamento: any): Record<string, any> {
  const ia = pedido.json_ia_bruto ?? {};
  const v = (campo: string, fallback: any = "") => pedido[campo] ?? ia[campo] ?? fallback;

  const itensIA = ia.itens ?? [];
  const valorTotalCalculado = itensIA.reduce(
    (acc: number, it: any) => acc + (Number(it.preco_total) || 0),
    0,
  );

  const empresa = v("empresa") || ia.empresa_cliente || "";
  const nomeComprador = v("nome_comprador") || ia.nome_comprador || "";

  return {
    numero_pedido_cliente: v("numero_pedido_cliente") || ia.numero_pedido || pedido.numero || "",
    // Fallback recíproco: comprador vazio cai pra empresa, e vice-versa.
    nome_comprador: nomeComprador || empresa,
    empresa: empresa || nomeComprador,
    data_emissao: formatarData(
      v("data_emissao") || v("data_pedido") || ia.data_pedido || ia.data_emissao || pedido.created_at,
      mapeamento?.colunas ?? [],
    ),
    cnpj: v("cnpj") || ia.cnpj || "",
    endereco_faturamento: v("endereco_faturamento") || "",
    cidade_faturamento: v("cidade_faturamento") || "",
    estado_faturamento: v("estado_faturamento") || "",
    cep_faturamento: v("cep_faturamento") || "",
    telefone_comprador: v("telefone_comprador") || "",
    email_comprador: v("email_comprador") || pedido.remetente_email || "",
    remetente_email: v("remetente_email") || pedido.remetente_email || "",
    observacoes_gerais: v("observacoes_gerais") || ia.observacoes || "",
    condicao_pagamento: v("condicao_pagamento") || ia.condicao_pagamento || "",
    valor_total: v("valor_total") || ia.valor_total || valorTotalCalculado || "",
    valor_frete: v("valor_frete") || ia.valor_frete || "",
    valor_desconto: v("valor_desconto") || ia.valor_desconto || "",
    transportadora: v("transportadora") || "",
    tipo_frete: v("tipo_frete") || "",
    endereco_entrega: v("endereco_entrega") || "",
    cidade_entrega: v("cidade_entrega") || "",
    estado_entrega: v("estado_entrega") || "",
    cep_entrega: v("cep_entrega") || "",
    // Campos expandidos
    nome_fantasia_cliente: v("nome_fantasia_cliente") || ia.nome_fantasia_cliente || "",
    numero_pedido_fornecedor: v("numero_pedido_fornecedor") || "",
    numero_edi: v("numero_edi") || "",
    tipo_pedido: v("tipo_pedido") || "",
    canal_venda: v("canal_venda") || "",
    campanha: v("campanha") || "",
    numero_contrato: v("numero_contrato") || "",
    numero_cotacao: v("numero_cotacao") || "",
    numero_nf_referencia: v("numero_nf_referencia") || "",
    validade_proposta: v("validade_proposta") || "",
    inscricao_estadual_cliente: v("inscricao_estadual_cliente") || "",
    codigo_comprador: v("codigo_comprador") || "",
    departamento_comprador: v("departamento_comprador") || "",
    razao_social_fornecedor: v("razao_social_fornecedor") || "",
    cnpj_fornecedor: v("cnpj_fornecedor") || "",
    codigo_fornecedor: v("codigo_fornecedor") || "",
    data_entrega_solicitada: v("data_entrega_solicitada") || "",
    data_limite_entrega: v("data_limite_entrega") || "",
    prazo_entrega_dias: v("prazo_entrega_dias") || "",
    peso_total_bruto: v("peso_total_bruto") || "",
    peso_total_liquido: v("peso_total_liquido") || "",
    volume_total: v("volume_total") || "",
    quantidade_volumes: v("quantidade_volumes") || "",
    numero_entrega: v("numero_entrega") || "",
    complemento_entrega: v("complemento_entrega") || "",
    bairro_entrega: v("bairro_entrega") || "",
    local_entrega: v("local_entrega") || "",
    instrucoes_entrega: v("instrucoes_entrega") || "",
    prazo_pagamento_dias: v("prazo_pagamento_dias") || "",
    forma_pagamento: v("forma_pagamento") || "",
    desconto_canal: v("desconto_canal") || "",
    desconto_financeiro: v("desconto_financeiro") || "",
    desconto_adicional: v("desconto_adicional") || "",
    numero_acordo: v("numero_acordo") || "",
    vendor: v("vendor") || "",
    rebate: v("rebate") || "",
    valor_entrada: v("valor_entrada") || "",
    instrucoes_faturamento: v("instrucoes_faturamento") || "",
    ipi_percentual: v("ipi_percentual") || "",
    valor_ipi: v("valor_ipi") || "",
    icms_st_percentual: v("icms_st_percentual") || "",
    valor_icms_st: v("valor_icms_st") || "",
    base_calculo_st: v("base_calculo_st") || "",
    mva_percentual: v("mva_percentual") || "",
    cfop: v("cfop") || "",
    natureza_operacao: v("natureza_operacao") || "",
    ncm: v("ncm") || "",
    pis_percentual: v("pis_percentual") || "",
    cofins_percentual: v("cofins_percentual") || "",
    nome_vendedor: v("nome_vendedor") || "",
    codigo_vendedor: v("codigo_vendedor") || "",
    centro_custo: v("centro_custo") || "",
    projeto_obra: v("projeto_obra") || "",
    responsavel_aprovacao: v("responsavel_aprovacao") || "",
  };
}

/** Monta o objeto de campos do item, atualizando contador de DE-PARA. */
export function montarCamposItem(
  item: any,
  contador: { comDePara: number; comOriginal: number },
): Record<string, any> {
  const codErp = String(item.codigo_produto_erp ?? "").trim();
  const codCliente = String(item.codigo_cliente ?? "").trim();
  const usouDePara = codErp !== "";
  if (usouDePara) contador.comDePara++;
  else contador.comOriginal++;

  return {
    descricao: item.descricao ?? "",
    codigo_cliente: item.codigo_cliente ?? "",
    codigo_produto_erp: usouDePara ? codErp : codCliente,
    unidade_medida: item.unidade_medida ?? "UN",
    quantidade: item.quantidade ?? "",
    preco_unitario: item.preco_unitario ?? "",
    preco_total: item.preco_total ?? "",
    referencia: item.referencia ?? "",
    marca: item.marca ?? "",
    desconto: item.desconto ?? "",
    observacao_item: item.observacao_item ?? "",
    ean: item.ean ?? "",
    // Campos expandidos
    part_number: item.part_number ?? "",
    modelo: item.modelo ?? "",
    cor: item.cor ?? "",
    tamanho: item.tamanho ?? "",
    grade: item.grade ?? "",
    multiplo_venda: item.multiplo_venda ?? "",
    data_entrega_item: item.data_entrega_item ?? "",
    preco_unitario_com_impostos: item.preco_unitario_com_impostos ?? "",
    ipi_item_percentual: item.ipi_item_percentual ?? "",
    valor_ipi_item: item.valor_ipi_item ?? "",
    icms_st_item_percentual: item.icms_st_item_percentual ?? "",
    valor_icms_st_item: item.valor_icms_st_item ?? "",
    base_calculo_st_item: item.base_calculo_st_item ?? "",
    desconto_comercial: item.desconto_comercial ?? "",
    desconto_adicional_item: item.desconto_adicional_item ?? "",
    vendor_item: item.vendor_item ?? "",
    preco_total_com_impostos: item.preco_total_com_impostos ?? "",
    peso_bruto_item: item.peso_bruto_item ?? "",
    peso_liquido_item: item.peso_liquido_item ?? "",
    volume_item: item.volume_item ?? "",
    ncm_item: item.ncm_item ?? "",
    cfop_item: item.cfop_item ?? "",
    numero_serie: item.numero_serie ?? "",
    lote: item.lote ?? "",
    data_validade: item.data_validade ?? "",
    shelf_life_dias: item.shelf_life_dias ?? "",
    temperatura_conservacao: item.temperatura_conservacao ?? "",
    registro_anvisa: item.registro_anvisa ?? "",
    aplicacao: item.aplicacao ?? "",
    cultura_destino: item.cultura_destino ?? "",
    principio_ativo: item.principio_ativo ?? "",
    concentracao: item.concentracao ?? "",
    registro_mapa: item.registro_mapa ?? "",
    composicao: item.composicao ?? "",
    codigo_marketplace: item.codigo_marketplace ?? "",
    numero_empenho: item.numero_empenho ?? "",
    codigo_catmat: item.codigo_catmat ?? "",
  };
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
