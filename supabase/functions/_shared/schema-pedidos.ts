// Lista canônica dos campos de `pedidos` e `pedido_itens` que a IA pode
// escolher ao mapear um layout de ERP. Gerado a partir do information_schema
// real do banco (não da imaginação da IA).
//
// REGRA: o `nome` deve ser exatamente igual ao nome da coluna no banco.
// Se o ERP do cliente trouxer um conceito que não existe aqui, a IA deve
// retornar `campo_sistema: null` em vez de inventar.

export interface CampoSistema {
  nome: string;
  descricao: string;
  exemplos: string[];
}

// Campos da tabela `pedidos` disponíveis para mapeamento.
// Metadados de sistema (id, tenant_id, gmail_message_id, status, exportado,
// json_ia_bruto, etc.) ficam de fora — não são preenchidos por layout de ERP.
//
// O schema tem dois conjuntos completos para endereço:
// - `*_faturamento` (cobrança/comprador): endereco, numero, complemento,
//   bairro, cidade, estado, cep
// - `*_entrega` (entrega física da mercadoria): endereco, numero, complemento,
//   bairro, cidade, estado, cep
// Use o conjunto correto conforme a coluna do arquivo do cliente identifica
// o endereço (Comprador/Faturamento vs Entrega).
export const CAMPOS_PEDIDO_DISPONIVEIS: CampoSistema[] = [
  // ===== Identificação do pedido =====
  { nome: "numero_pedido_cliente", descricao: "Número do pedido gerado pelo cliente/comprador (campo principal de identificação)", exemplos: ["12345", "PV-2024-001", "OC-78910"] },
  { nome: "numero_pedido_fornecedor", descricao: "Número do pedido no sistema do fornecedor (se já existir)", exemplos: ["FOR-001", "98765"] },
  { nome: "numero_edi", descricao: "Número/identificador EDI do pedido", exemplos: ["EDI20240001"] },
  { nome: "numero_oc_comprador", descricao: "Número da Ordem de Compra do comprador", exemplos: ["OC-2024-555"] },
  { nome: "numero_cotacao", descricao: "Número da cotação que originou o pedido", exemplos: ["COT-001"] },
  { nome: "numero_contrato", descricao: "Número do contrato vinculado", exemplos: ["CT-2024-12"] },
  { nome: "numero_processo", descricao: "Número de processo administrativo (licitação, compra pública)", exemplos: ["2024.001.123"] },
  { nome: "numero_acordo", descricao: "Número do acordo comercial/canal", exemplos: ["AC-15"] },
  { nome: "numero_nf_referencia", descricao: "Número da NF de referência (devolução, complemento, ajuste)", exemplos: ["NF-12345"] },
  { nome: "numero_empenho", descricao: "Número de empenho (pedidos governamentais)", exemplos: ["2024NE000123"] },
  { nome: "tipo_pedido", descricao: "Tipo/natureza do pedido (venda, bonificação, troca, amostra, etc.)", exemplos: ["venda", "bonificacao", "amostra"] },
  { nome: "tipo_pedido_erp", descricao: "Código/tipo do pedido conforme classificação interna do ERP", exemplos: ["PV", "BON"] },
  { nome: "carteira_pedido", descricao: "Carteira/grupo do pedido no ERP", exemplos: ["A", "PREMIUM"] },
  { nome: "canal_venda", descricao: "Canal de venda (e-commerce, representante, marketplace, balcão)", exemplos: ["ecommerce", "representante", "mercadolivre"] },
  { nome: "campanha", descricao: "Campanha promocional vinculada", exemplos: ["BLACK_FRIDAY", "VERAO_2024"] },

  // ===== Datas =====
  { nome: "data_emissao", descricao: "Data de emissão do pedido pelo cliente", exemplos: ["10/03/2024", "2024-03-10"] },
  { nome: "data_validade", descricao: "Data de validade do pedido/proposta", exemplos: ["31/12/2024"] },
  { nome: "data_entrega_solicitada", descricao: "Data solicitada para entrega/Data prevista de entrega", exemplos: ["15/03/2024"] },
  { nome: "data_limite_entrega", descricao: "Data limite máxima de entrega", exemplos: ["30/03/2024"] },
  { nome: "prazo_entrega_dias", descricao: "Prazo de entrega em dias corridos", exemplos: ["15", "30"] },
  { nome: "validade_proposta", descricao: "Texto livre de validade da proposta", exemplos: ["30 dias", "até 30/06"] },
  { nome: "data_aprovacao_pedido", descricao: "Data em que o pedido foi aprovado pelo cliente", exemplos: ["12/03/2024"] },

  // ===== Identificação do cliente/comprador =====
  { nome: "empresa", descricao: "Razão social ou nome do cliente comprador", exemplos: ["Loja XYZ Ltda", "Supermercado ABC"] },
  { nome: "nome_fantasia_cliente", descricao: "Nome fantasia do cliente comprador", exemplos: ["XYZ Mercados", "ABC Online"] },
  { nome: "cnpj", descricao: "CNPJ ou CPF do cliente comprador", exemplos: ["12.345.678/0001-90", "123.456.789-00"] },
  { nome: "inscricao_estadual_cliente", descricao: "Inscrição estadual do cliente comprador", exemplos: ["123.456.789.001"] },
  { nome: "tipo_empresa", descricao: "Tipo/porte da empresa cliente", exemplos: ["MEI", "ME", "EPP", "LTDA"] },
  { nome: "codigo_comprador", descricao: "Código interno do comprador no ERP do fornecedor", exemplos: ["CLI-0042"] },

  // ===== Pessoa de contato (comprador) =====
  { nome: "nome_comprador", descricao: "Nome da pessoa que efetuou a compra (contato)", exemplos: ["João Silva"] },
  { nome: "telefone_comprador", descricao: "Telefone/celular de contato do comprador", exemplos: ["(11) 98765-4321"] },
  { nome: "email_comprador", descricao: "E-mail de contato do comprador", exemplos: ["compras@cliente.com.br"] },
  { nome: "departamento_comprador", descricao: "Departamento/setor do comprador", exemplos: ["Compras", "Suprimentos"] },

  // ===== Fornecedor (quando o pedido vem do lado do cliente) =====
  { nome: "razao_social_fornecedor", descricao: "Razão social do fornecedor", exemplos: ["Indústria QWE S/A"] },
  { nome: "cnpj_fornecedor", descricao: "CNPJ do fornecedor", exemplos: ["98.765.432/0001-10"] },
  { nome: "codigo_fornecedor", descricao: "Código do fornecedor no ERP do cliente", exemplos: ["FOR-001"] },

  // ===== Endereço de FATURAMENTO / COBRANÇA / COMPRADOR =====
  // Use estes campos quando o arquivo do ERP identifica o endereço como
  // "comprador", "faturamento" ou "cobrança" — ou seja, de quem está pagando.
  { nome: "endereco_faturamento", descricao: "Logradouro (rua, av.) de faturamento/cobrança/comprador", exemplos: ["Rua das Flores"] },
  { nome: "numero_faturamento", descricao: "Número do imóvel de faturamento/cobrança/comprador — use para 'Número Comprador' ou 'Número Faturamento'", exemplos: ["100", "S/N"] },
  { nome: "complemento_faturamento", descricao: "Complemento do endereço de faturamento/cobrança/comprador — use para 'Complemento Comprador' ou 'Complemento Faturamento'", exemplos: ["Sala 5", "Bloco B Apto 12"] },
  { nome: "bairro_faturamento", descricao: "Bairro de faturamento/cobrança/comprador — use para 'Bairro Comprador', 'Bairro Faturamento' ou 'Bairro Cobrança'", exemplos: ["Centro", "Vila Mariana"] },
  { nome: "cidade_faturamento", descricao: "Cidade de faturamento/cobrança/comprador", exemplos: ["São Paulo"] },
  { nome: "estado_faturamento", descricao: "UF de faturamento/cobrança/comprador", exemplos: ["SP"] },
  { nome: "cep_faturamento", descricao: "CEP de faturamento/cobrança/comprador", exemplos: ["01234-567"] },

  // ===== Endereço de ENTREGA =====
  // Use estes campos quando o arquivo do ERP identifica o endereço como
  // "entrega" — ou seja, onde a mercadoria será fisicamente entregue.
  // NÃO use campos _entrega para colunas que o ERP chama de "comprador" ou "faturamento".
  { nome: "endereco_entrega", descricao: "Logradouro (rua, av.) do endereço de entrega da mercadoria", exemplos: ["Av. dos Estados"] },
  { nome: "numero_entrega", descricao: "Número do imóvel do endereço de entrega", exemplos: ["200", "S/N"] },
  { nome: "complemento_entrega", descricao: "Complemento do endereço de entrega", exemplos: ["Galpão 3", "Dock 5"] },
  { nome: "bairro_entrega", descricao: "Bairro do endereço de entrega", exemplos: ["Distrito Industrial"] },
  { nome: "cidade_entrega", descricao: "Cidade do endereço de entrega", exemplos: ["Campinas"] },
  { nome: "estado_entrega", descricao: "UF do endereço de entrega", exemplos: ["SP"] },
  { nome: "cep_entrega", descricao: "CEP do endereço de entrega", exemplos: ["13000-000"] },
  { nome: "local_entrega", descricao: "Nome/identificação do local de entrega (loja, depósito, obra)", exemplos: ["Loja Centro", "Filial Sul", "Nome Entrega"] },
  { nome: "instrucoes_entrega", descricao: "Instruções/observações específicas de entrega", exemplos: ["Entregar em horário comercial"] },
  { nome: "observacoes_entrega", descricao: "Observações gerais de entrega (texto livre)", exemplos: ["Necessário agendamento"] },
  { nome: "modalidade_entrega", descricao: "Modalidade de entrega (retirada, entregar, transportadora)", exemplos: ["entregar", "retirada"] },
  { nome: "prioridade_entrega", descricao: "Prioridade da entrega (alta, média, baixa, urgente)", exemplos: ["alta", "urgente"] },
  { nome: "prazo_entrega_geral", descricao: "Prazo de entrega como texto livre", exemplos: ["15 dias úteis"] },

  // ===== Frete e logística =====
  { nome: "transportadora", descricao: "Nome da transportadora — também usar para 'Serviço/Modalidade Transportadora'", exemplos: ["Correios", "Jamef", "Sedex"] },
  { nome: "codigo_transportadora", descricao: "Código da transportadora no ERP", exemplos: ["TR-01"] },
  { nome: "tipo_frete", descricao: "Tipo de frete (CIF, FOB, terceiros, sem frete)", exemplos: ["CIF", "FOB"] },
  { nome: "valor_frete", descricao: "Valor do frete", exemplos: ["50.00", "120,90"] },
  { nome: "peso_total_bruto", descricao: "Peso bruto total do pedido em kg", exemplos: ["12.500"] },
  { nome: "peso_total_liquido", descricao: "Peso líquido total do pedido em kg", exemplos: ["10.000"] },
  { nome: "volume_total", descricao: "Volume total do pedido em m³", exemplos: ["0.350"] },
  { nome: "quantidade_volumes", descricao: "Quantidade de volumes/caixas", exemplos: ["3"] },
  { nome: "incoterm", descricao: "Incoterm para comércio internacional", exemplos: ["FOB", "CIF", "EXW"] },
  { nome: "porto_embarque", descricao: "Porto de embarque (export/import)", exemplos: ["Santos"] },
  { nome: "porto_destino", descricao: "Porto de destino (export/import)", exemplos: ["Roterdã"] },
  { nome: "pais_destino", descricao: "País de destino (export)", exemplos: ["Holanda"] },

  // ===== Pagamento =====
  { nome: "condicao_pagamento", descricao: "Condição de pagamento por extenso", exemplos: ["30/60/90 dias", "à vista"] },
  { nome: "codigo_condicao_pagamento", descricao: "Código da condição de pagamento no ERP", exemplos: ["003"] },
  { nome: "prazo_pagamento_dias", descricao: "Prazo de pagamento em dias (número). Use também para Quantidade de Parcelas convertido em prazo", exemplos: ["30", "60"] },
  { nome: "forma_pagamento", descricao: "Forma de pagamento (boleto, pix, cartão, transferência)", exemplos: ["boleto", "pix"] },
  { nome: "valor_entrada", descricao: "Valor de entrada/sinal", exemplos: ["500.00"] },
  { nome: "observacoes_pagamento", descricao: "Observações sobre pagamento (texto livre)", exemplos: ["Faturar para CNPJ X"] },
  { nome: "instrucoes_faturamento", descricao: "Instruções específicas para emissão da NF/faturamento", exemplos: ["Faturar em 2 NFs"] },

  // ===== Valores =====
  { nome: "valor_subtotal", descricao: "Subtotal antes de descontos/frete/impostos", exemplos: ["1000.00"] },
  { nome: "valor_desconto", descricao: "Valor total de desconto aplicado no pedido", exemplos: ["50.00"] },
  { nome: "valor_impostos", descricao: "Valor total de impostos no pedido", exemplos: ["180.00"] },
  { nome: "valor_total", descricao: "Valor total do pedido", exemplos: ["1130.00"] },
  { nome: "total_previsto", descricao: "Valor total previsto/estimado (quando diferente do final)", exemplos: ["1100.00"] },
  { nome: "moeda", descricao: "Moeda do pedido (sigla)", exemplos: ["BRL", "USD"] },
  { nome: "moeda_cambio", descricao: "Taxa de câmbio aplicada", exemplos: ["5.20"] },
  { nome: "data_cambio", descricao: "Data da cotação do câmbio", exemplos: ["10/03/2024"] },

  // ===== Descontos comerciais =====
  { nome: "desconto_canal", descricao: "Desconto de canal/comercial (% ou valor)", exemplos: ["5", "50.00"] },
  { nome: "desconto_financeiro", descricao: "Desconto financeiro (% ou valor)", exemplos: ["2"] },
  { nome: "desconto_adicional", descricao: "Outros descontos adicionais", exemplos: ["10.00"] },

  // ===== Acordo/vendor/rebate =====
  { nome: "vendor", descricao: "Vendor/marca dentro do fornecedor (multi-marca)", exemplos: ["MARCA_X"] },
  { nome: "rebate", descricao: "Valor ou % de rebate", exemplos: ["3"] },

  // ===== Impostos no cabeçalho =====
  { nome: "ipi_percentual", descricao: "Alíquota de IPI no cabeçalho (%)", exemplos: ["5"] },
  { nome: "valor_ipi", descricao: "Valor de IPI total", exemplos: ["50.00"] },
  { nome: "icms_st_percentual", descricao: "Alíquota de ICMS ST (%)", exemplos: ["18"] },
  { nome: "valor_icms_st", descricao: "Valor de ICMS ST", exemplos: ["180.00"] },
  { nome: "base_calculo_st", descricao: "Base de cálculo de ICMS ST", exemplos: ["1000.00"] },
  { nome: "mva_percentual", descricao: "Margem de Valor Agregado (%)", exemplos: ["35"] },
  { nome: "pis_percentual", descricao: "Alíquota de PIS (%)", exemplos: ["1.65"] },
  { nome: "cofins_percentual", descricao: "Alíquota de COFINS (%)", exemplos: ["7.6"] },
  { nome: "ncm", descricao: "NCM do pedido (se uniforme)", exemplos: ["12345678"] },
  { nome: "cfop", descricao: "CFOP do pedido", exemplos: ["5102", "6108"] },
  { nome: "natureza_operacao", descricao: "Natureza da operação", exemplos: ["Venda de mercadoria"] },
  { nome: "regime_tributario", descricao: "Regime tributário (Simples, Lucro Presumido, Real)", exemplos: ["simples"] },
  { nome: "finalidade_nfe", descricao: "Finalidade da NF-e (normal, complementar, ajuste, devolução)", exemplos: ["normal"] },
  { nome: "numero_di", descricao: "Número da Declaração de Importação", exemplos: ["24/0123456-7"] },

  // ===== Vendedor / representante / aprovação =====
  { nome: "nome_vendedor", descricao: "Nome do vendedor responsável", exemplos: ["Maria Souza"] },
  { nome: "codigo_vendedor", descricao: "Código do vendedor (texto livre)", exemplos: ["V01"] },
  { nome: "codigo_vendedor_erp", descricao: "Código do vendedor no ERP", exemplos: ["VEND-15"] },
  { nome: "codigo_representante", descricao: "Código do representante comercial", exemplos: ["REP-08"] },
  { nome: "responsavel_aprovacao", descricao: "Responsável pela aprovação do pedido", exemplos: ["Carlos Diretor"] },

  // ===== Centro de custo / projeto / filial / depósito =====
  { nome: "centro_custo", descricao: "Centro de custo (texto)", exemplos: ["CC-100"] },
  { nome: "centro_distribuicao", descricao: "Centro de distribuição", exemplos: ["CD-SP"] },
  { nome: "codigo_filial", descricao: "Código da filial", exemplos: ["01", "MATRIZ"] },
  { nome: "codigo_empresa_erp", descricao: "Código da empresa no ERP multi-empresa", exemplos: ["EMP01"] },
  { nome: "codigo_deposito", descricao: "Código do depósito de origem", exemplos: ["DEP01"] },
  { nome: "codigo_tabela_preco", descricao: "Código da tabela de preço usada", exemplos: ["TAB-VAREJO"] },
  { nome: "codigo_projeto_erp", descricao: "Código de projeto/obra no ERP", exemplos: ["PRJ-005"] },
  { nome: "codigo_contrato_erp", descricao: "Código de contrato no ERP", exemplos: ["CT-2024"] },
  { nome: "codigo_projeto", descricao: "Código de projeto (campo texto livre)", exemplos: ["P-001"] },
  { nome: "projeto_obra", descricao: "Nome do projeto/obra", exemplos: ["Obra Edifício Central"] },

  // ===== Observações / dados extras =====
  { nome: "observacoes_gerais", descricao: "Observações gerais do pedido (texto livre). Use também para 'Outras despesas' descritivas", exemplos: ["Cliente VIP, prioridade alta"] },
  { nome: "informacoes_complementares", descricao: "Informações complementares para a NF-e", exemplos: ["Pedido referente à proposta 123"] },
  { nome: "dados_adicionais_erp", descricao: "Campo livre de dados adicionais para o ERP", exemplos: ["JSON extra"] },
];

// Campos da tabela `pedido_itens` disponíveis para mapeamento.
// Metadados (id, tenant_id, pedido_id, numero_item, confianca) ficam de fora.
export const CAMPOS_PEDIDO_ITEM_DISPONIVEIS: CampoSistema[] = [
  // ===== Identificação do produto =====
  { nome: "descricao", descricao: "Descrição/nome do produto (campo principal). Use também para 'Produto'", exemplos: ["Parafuso 5mm", "Notebook XYZ"] },
  { nome: "descricao_complementar", descricao: "Descrição complementar/secundária do produto", exemplos: ["Cor preto, modelo 2024"] },
  { nome: "codigo_cliente", descricao: "Código do produto no ERP do CLIENTE comprador (SKU). Use para 'SKU' quando o ERP é do lado comprador", exemplos: ["CLI-001", "SKU-ABC"] },
  { nome: "codigo_produto_erp", descricao: "Código do produto no ERP do FORNECEDOR. Use para 'SKU' quando o ERP é do lado fornecedor, ou para 'Código do Fornecedor'", exemplos: ["P-12345"] },
  { nome: "codigo_fornecedor", descricao: "Código do produto no fornecedor (sinônimo de codigo_produto_erp em alguns layouts)", exemplos: ["FOR-001"] },
  { nome: "referencia", descricao: "Referência do produto (campo texto livre)", exemplos: ["REF-001"] },
  { nome: "referencia_cliente", descricao: "Referência do produto conforme nomenclatura do cliente", exemplos: ["CLI-REF-99"] },
  { nome: "ean", descricao: "Código EAN/GTIN-13 do produto", exemplos: ["7891234567890"] },
  { nome: "codigo_barras", descricao: "Código de barras (genérico, pode ser EAN, DUN, etc.)", exemplos: ["7891234567890"] },
  { nome: "part_number", descricao: "Part Number / Código do fabricante", exemplos: ["PN-XYZ-001"] },
  { nome: "codigo_marketplace", descricao: "Código do produto no marketplace", exemplos: ["MLB123456"] },
  { nome: "codigo_catmat", descricao: "Código CATMAT (compras governamentais)", exemplos: ["BR0001234"] },

  // ===== Atributos do produto =====
  { nome: "marca", descricao: "Marca do produto", exemplos: ["Marca X"] },
  { nome: "modelo", descricao: "Modelo do produto", exemplos: ["Modelo 2024"] },
  { nome: "cor", descricao: "Cor do produto", exemplos: ["preto", "azul"] },
  { nome: "tamanho", descricao: "Tamanho do produto", exemplos: ["G", "42", "10cm"] },
  { nome: "grade", descricao: "Grade (combinação cor+tamanho ou variação)", exemplos: ["P-AZUL", "M-PRETO"] },
  { nome: "composicao", descricao: "Composição/material do produto", exemplos: ["100% algodão"] },
  { nome: "ncm", descricao: "NCM do item (genérico)", exemplos: ["12345678"] },
  { nome: "ncm_item", descricao: "NCM específico do item (quando há campo dedicado)", exemplos: ["12345678"] },
  { nome: "cest", descricao: "CEST do item", exemplos: ["28.038.00"] },
  { nome: "pais_origem", descricao: "País de origem do produto", exemplos: ["Brasil", "China"] },
  { nome: "aplicacao", descricao: "Aplicação/uso do produto", exemplos: ["industrial"] },
  { nome: "norma_tecnica", descricao: "Norma técnica aplicável", exemplos: ["ABNT NBR 5410"] },
  { nome: "especificacao", descricao: "Especificação técnica detalhada", exemplos: ["220V, 60Hz"] },

  // ===== Quantidades / unidades =====
  { nome: "quantidade", descricao: "Quantidade pedida", exemplos: ["10", "100"] },
  { nome: "unidade_medida", descricao: "Unidade de medida (UN, KG, CX, PC, M, L, etc.). Use também para 'Un'", exemplos: ["UN", "CX", "KG"] },
  { nome: "quantidade_minima", descricao: "Quantidade mínima de venda/lote", exemplos: ["1"] },
  { nome: "quantidade_multiplo", descricao: "Múltiplo de venda (caixa fechada, etc.)", exemplos: ["12"] },
  { nome: "multiplo_venda", descricao: "Múltiplo de venda (sinônimo de quantidade_multiplo em alguns ERPs)", exemplos: ["6"] },
  { nome: "unidade_tributavel", descricao: "Unidade tributável (NF-e)", exemplos: ["UN"] },
  { nome: "quantidade_tributavel", descricao: "Quantidade tributável (NF-e)", exemplos: ["10"] },
  { nome: "fator_conversao", descricao: "Fator de conversão entre unidades", exemplos: ["12"] },

  // ===== Preços / valores =====
  { nome: "preco_unitario", descricao: "Preço unitário do produto. Use também para 'Valor Unitário'", exemplos: ["10.00", "1500.00"] },
  { nome: "preco_total", descricao: "Preço total do item (qtd × unitário). Use também para 'Valor Total' do item", exemplos: ["100.00"] },
  { nome: "preco_unitario_com_impostos", descricao: "Preço unitário já com impostos embutidos", exemplos: ["12.50"] },
  { nome: "preco_total_com_impostos", descricao: "Preço total já com impostos embutidos", exemplos: ["125.00"] },
  { nome: "preco_unitario_tributavel", descricao: "Preço unitário tributável (NF-e)", exemplos: ["10.00"] },
  { nome: "percentual_desconto", descricao: "Percentual de desconto do item", exemplos: ["5", "10"] },
  { nome: "valor_desconto_item", descricao: "Valor de desconto do item", exemplos: ["5.00"] },
  { nome: "desconto", descricao: "Desconto do item (campo genérico)", exemplos: ["10.00"] },
  { nome: "desconto_comercial", descricao: "Desconto comercial específico", exemplos: ["5"] },
  { nome: "desconto_adicional_item", descricao: "Desconto adicional do item", exemplos: ["2"] },

  // ===== Pesos / volumes do item =====
  { nome: "peso_unitario", descricao: "Peso unitário do item (kg)", exemplos: ["0.250"] },
  { nome: "peso_total", descricao: "Peso total do item (qtd × peso unitário)", exemplos: ["2.500"] },
  { nome: "peso_bruto_item", descricao: "Peso bruto do item", exemplos: ["2.500"] },
  { nome: "peso_liquido_item", descricao: "Peso líquido do item", exemplos: ["2.300"] },
  { nome: "volume_unitario", descricao: "Volume unitário do item (m³)", exemplos: ["0.005"] },
  { nome: "volume_item", descricao: "Volume total do item", exemplos: ["0.050"] },

  // ===== Impostos do item =====
  { nome: "percentual_ipi", descricao: "Percentual de IPI do item", exemplos: ["5"] },
  { nome: "valor_ipi", descricao: "Valor de IPI do item", exemplos: ["5.00"] },
  { nome: "ipi_item_percentual", descricao: "Percentual de IPI do item (variante de nome)", exemplos: ["5"] },
  { nome: "valor_ipi_item", descricao: "Valor de IPI do item (variante de nome)", exemplos: ["5.00"] },
  { nome: "percentual_icms", descricao: "Percentual de ICMS do item", exemplos: ["18"] },
  { nome: "valor_icms", descricao: "Valor de ICMS do item", exemplos: ["18.00"] },
  { nome: "percentual_icms_st", descricao: "Percentual de ICMS ST do item", exemplos: ["18"] },
  { nome: "valor_icms_st", descricao: "Valor de ICMS ST do item", exemplos: ["18.00"] },
  { nome: "icms_st_item_percentual", descricao: "Percentual ICMS ST do item (variante)", exemplos: ["18"] },
  { nome: "valor_icms_st_item", descricao: "Valor ICMS ST do item (variante)", exemplos: ["18.00"] },
  { nome: "base_calculo_icms", descricao: "Base de cálculo do ICMS do item", exemplos: ["100.00"] },
  { nome: "base_calculo_st", descricao: "Base de cálculo do ICMS ST do item", exemplos: ["100.00"] },
  { nome: "base_calculo_st_item", descricao: "Base de cálculo ST do item (variante)", exemplos: ["100.00"] },
  { nome: "base_calculo_ipi", descricao: "Base de cálculo do IPI", exemplos: ["100.00"] },
  { nome: "percentual_pis", descricao: "Percentual de PIS do item", exemplos: ["1.65"] },
  { nome: "percentual_cofins", descricao: "Percentual de COFINS do item", exemplos: ["7.6"] },
  { nome: "percentual_fcp", descricao: "Percentual de FCP", exemplos: ["2"] },
  { nome: "valor_fcp", descricao: "Valor de FCP", exemplos: ["2.00"] },
  { nome: "percentual_mva", descricao: "Percentual de MVA do item", exemplos: ["35"] },
  { nome: "valor_ii", descricao: "Valor de Imposto de Importação", exemplos: ["10.00"] },
  { nome: "percentual_ii", descricao: "Percentual de Imposto de Importação", exemplos: ["12"] },
  { nome: "valor_iof", descricao: "Valor de IOF", exemplos: ["1.50"] },
  { nome: "percentual_iof", descricao: "Percentual de IOF", exemplos: ["1.5"] },
  { nome: "cst_icms", descricao: "CST/CSOSN de ICMS", exemplos: ["00", "102"] },
  { nome: "cst_pis", descricao: "CST de PIS", exemplos: ["01"] },
  { nome: "cst_cofins", descricao: "CST de COFINS", exemplos: ["01"] },
  { nome: "cst_ipi", descricao: "CST de IPI", exemplos: ["50"] },
  { nome: "cfop_item", descricao: "CFOP específico do item", exemplos: ["5102"] },
  { nome: "natureza_operacao_item", descricao: "Natureza de operação do item", exemplos: ["Venda"] },

  // ===== Frete / outras despesas do item =====
  { nome: "valor_frete_item", descricao: "Valor de frete rateado para o item", exemplos: ["5.00"] },
  { nome: "valor_seguro_item", descricao: "Valor de seguro do item", exemplos: ["1.00"] },
  { nome: "valor_outras_despesas", descricao: "Outras despesas no item", exemplos: ["2.00"] },
  { nome: "indicador_composicao_custo", descricao: "Indica se o item compõe o custo (S/N)", exemplos: ["S"] },

  // ===== Lote / validade / rastreabilidade =====
  { nome: "lote", descricao: "Lote do produto", exemplos: ["L20240315"] },
  { nome: "numero_lote", descricao: "Número do lote (sinônimo de lote em alguns ERPs)", exemplos: ["L001"] },
  { nome: "lote_erp", descricao: "Código de lote no ERP", exemplos: ["LT-1234"] },
  { nome: "numero_serie", descricao: "Número de série", exemplos: ["SN-0001"] },
  { nome: "numero_serie_erp", descricao: "Número de série no ERP", exemplos: ["NS-99"] },
  { nome: "data_validade", descricao: "Data de validade (texto, alguns ERPs usam livre)", exemplos: ["31/12/2025"] },
  { nome: "data_validade_produto", descricao: "Data de validade do produto (data formatada)", exemplos: ["2025-12-31"] },
  { nome: "data_fabricacao", descricao: "Data de fabricação", exemplos: ["10/03/2024"] },
  { nome: "shelf_life_dias", descricao: "Shelf life em dias", exemplos: ["180"] },
  { nome: "rastreabilidade", descricao: "Informação de rastreabilidade", exemplos: ["RAST-001"] },
  { nome: "registro_anvisa", descricao: "Número de registro na ANVISA", exemplos: ["1.2345.6789.001-0"] },
  { nome: "registro_mapa", descricao: "Número de registro no MAPA", exemplos: ["MAPA-12345"] },
  { nome: "principio_ativo", descricao: "Princípio ativo (defensivos/farma)", exemplos: ["Glifosato"] },
  { nome: "concentracao", descricao: "Concentração do princípio ativo", exemplos: ["480 g/L"] },
  { nome: "cultura_destino", descricao: "Cultura de destino (defensivo agrícola)", exemplos: ["soja"] },
  { nome: "garantia", descricao: "Garantia do produto (texto livre)", exemplos: ["12 meses"] },
  { nome: "temperatura_conservacao", descricao: "Temperatura de conservação", exemplos: ["2-8°C"] },

  // ===== Entrega do item =====
  { nome: "data_entrega_item", descricao: "Data de entrega específica do item", exemplos: ["2024-03-20"] },
  { nome: "prazo_entrega_item", descricao: "Prazo de entrega do item (texto livre)", exemplos: ["10 dias"] },
  { nome: "local_entrega_item", descricao: "Local de entrega específico do item", exemplos: ["Loja A"] },

  // ===== Localização no estoque do ERP =====
  { nome: "codigo_deposito_item", descricao: "Código do depósito do item", exemplos: ["DEP01"] },
  { nome: "codigo_almoxarifado", descricao: "Código do almoxarifado", exemplos: ["ALM-A"] },
  { nome: "codigo_localizacao", descricao: "Código de localização física (rua/prateleira)", exemplos: ["A-12-03"] },
  { nome: "codigo_tabela_preco_item", descricao: "Tabela de preço do item (quando difere do cabeçalho)", exemplos: ["TAB-2"] },
  { nome: "codigo_centro_custo_item", descricao: "Centro de custo do item (quando difere do cabeçalho)", exemplos: ["CC-50"] },
  { nome: "codigo_projeto_item", descricao: "Projeto do item (quando difere do cabeçalho)", exemplos: ["PRJ-X"] },
  { nome: "vendor_item", descricao: "Vendor/marca do item (multi-vendor)", exemplos: ["MARCA_X"] },

  // ===== Observações / dados extras do item =====
  { nome: "observacoes_item", descricao: "Observações gerais do item", exemplos: ["Embalar separado"] },
  { nome: "observacao_item", descricao: "Observação do item (variante de nome)", exemplos: ["Frágil"] },
  { nome: "dados_adicionais_item", descricao: "Dados adicionais livres do item", exemplos: ["JSON extra"] },
];

const NOMES_PEDIDO = new Set(CAMPOS_PEDIDO_DISPONIVEIS.map((c) => c.nome));
const NOMES_ITEM = new Set(CAMPOS_PEDIDO_ITEM_DISPONIVEIS.map((c) => c.nome));

/**
 * Verifica se um nome candidato a campo_sistema existe no catálogo do tipo
 * indicado. Falsy (null/undefined/"") sempre retorna false. Lookup O(1).
 *
 * Usado em analisar-layout-erp pra recusar nomes inventados pela IA — sem
 * isso, o fallback antigo `m.campo_sistema || nomeSnake` aceitava qualquer
 * string e gerava colunas tipo `id_forma_pagamento`, `nome_entrega` etc.
 * que não existem no banco e quebravam INSERT/exportação.
 */
export function isCampoValido(nome: unknown, tipo: "pedido" | "item"): boolean {
  if (typeof nome !== "string" || nome.length === 0) return false;
  return tipo === "item" ? NOMES_ITEM.has(nome) : NOMES_PEDIDO.has(nome);
}
