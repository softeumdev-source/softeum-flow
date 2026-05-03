-- =============================================================================
-- Migration: Schema completo para pedidos e pedido_itens
--
-- Contexto: o código (processar-email-pdf) evoluiu para capturar 70+ campos
-- de pedidos B2B brasileiros (cabeçalho + itens) mas as colunas correspondentes
-- nunca foram adicionadas ao banco. PostgREST ignora silenciosamente campos
-- desconhecidos no INSERT, fazendo com que os dados extraídos pela IA sejam
-- descartados. Esta migration sincroniza o schema com o código.
--
-- Colunas pré-existentes (NÃO tocadas):
--   pedidos:       id, tenant_id, numero, empresa, data_pedido, data_entrega,
--                  status, confianca_ia, total_previsto, observacoes, pdf_url,
--                  email_remetente, data_recebimento_email, criado_por,
--                  atualizado_por, created_at, updated_at, exportado,
--                  exportado_em, exportacao_metodo, exportacao_tentativas,
--                  exportacao_erro, pdf_hash, email_envelope_from,
--                  notif_suspeita_destinatario, notif_revisada, remetente_origem
--   pedido_itens:  id, pedido_id, tenant_id, produto_codigo, produto_descricao,
--                  quantidade, unidade, preco_unitario, total, sugestao_erp,
--                  aceito, created_at
-- =============================================================================

-- =============================================================================
-- 1. PEDIDOS — colunas de identificação e referência
-- =============================================================================

ALTER TABLE public.pedidos
    -- Deduplicação via Gmail message ID
    ADD COLUMN IF NOT EXISTS gmail_message_id    text,
    ADD COLUMN IF NOT EXISTS canal_entrada       text,
    ADD COLUMN IF NOT EXISTS assunto_email       text,
    ADD COLUMN IF NOT EXISTS remetente_email     text,

    -- Números de referência do pedido
    ADD COLUMN IF NOT EXISTS numero_pedido_cliente      text,
    ADD COLUMN IF NOT EXISTS numero_pedido_fornecedor   text,
    ADD COLUMN IF NOT EXISTS numero_edi                 text,
    ADD COLUMN IF NOT EXISTS tipo_pedido                text,
    ADD COLUMN IF NOT EXISTS canal_venda                text,
    ADD COLUMN IF NOT EXISTS campanha                   text,
    ADD COLUMN IF NOT EXISTS numero_contrato            text,
    ADD COLUMN IF NOT EXISTS numero_cotacao             text,
    ADD COLUMN IF NOT EXISTS numero_nf_referencia       text,
    ADD COLUMN IF NOT EXISTS validade_proposta          date,

    -- Identificação do comprador
    ADD COLUMN IF NOT EXISTS nome_fantasia_cliente      text,
    ADD COLUMN IF NOT EXISTS cnpj                       text,
    ADD COLUMN IF NOT EXISTS inscricao_estadual_cliente text,
    ADD COLUMN IF NOT EXISTS nome_comprador             text,
    ADD COLUMN IF NOT EXISTS email_comprador            text,
    ADD COLUMN IF NOT EXISTS telefone_comprador         text,
    ADD COLUMN IF NOT EXISTS codigo_comprador           text,
    ADD COLUMN IF NOT EXISTS departamento_comprador     text,

    -- Dados do fornecedor
    ADD COLUMN IF NOT EXISTS razao_social_fornecedor    text,
    ADD COLUMN IF NOT EXISTS cnpj_fornecedor            text,
    ADD COLUMN IF NOT EXISTS codigo_fornecedor          text,

    -- Datas
    ADD COLUMN IF NOT EXISTS data_emissao               date,
    ADD COLUMN IF NOT EXISTS data_entrega_solicitada    date,
    ADD COLUMN IF NOT EXISTS data_limite_entrega        date,
    ADD COLUMN IF NOT EXISTS prazo_entrega_dias         integer,

    -- Logística / frete
    ADD COLUMN IF NOT EXISTS transportadora             text,
    ADD COLUMN IF NOT EXISTS valor_frete                numeric(12,2),
    ADD COLUMN IF NOT EXISTS tipo_frete                 text,
    ADD COLUMN IF NOT EXISTS peso_total_bruto           numeric(12,3),
    ADD COLUMN IF NOT EXISTS peso_total_liquido         numeric(12,3),
    ADD COLUMN IF NOT EXISTS volume_total               numeric(12,4),
    ADD COLUMN IF NOT EXISTS quantidade_volumes         integer,

    -- Endereço de entrega
    ADD COLUMN IF NOT EXISTS endereco_entrega           text,
    ADD COLUMN IF NOT EXISTS numero_entrega             text,
    ADD COLUMN IF NOT EXISTS complemento_entrega        text,
    ADD COLUMN IF NOT EXISTS bairro_entrega             text,
    ADD COLUMN IF NOT EXISTS cidade_entrega             text,
    ADD COLUMN IF NOT EXISTS estado_entrega             char(2),
    ADD COLUMN IF NOT EXISTS cep_entrega                text,
    ADD COLUMN IF NOT EXISTS local_entrega              text,
    ADD COLUMN IF NOT EXISTS instrucoes_entrega         text,

    -- Pagamento
    ADD COLUMN IF NOT EXISTS condicao_pagamento         text,
    ADD COLUMN IF NOT EXISTS prazo_pagamento_dias       integer,
    ADD COLUMN IF NOT EXISTS forma_pagamento            text,
    ADD COLUMN IF NOT EXISTS valor_entrada              numeric(12,2),
    ADD COLUMN IF NOT EXISTS instrucoes_faturamento     text,

    -- Descontos e verbas comerciais
    ADD COLUMN IF NOT EXISTS desconto_canal             numeric(7,4),
    ADD COLUMN IF NOT EXISTS desconto_financeiro        numeric(7,4),
    ADD COLUMN IF NOT EXISTS desconto_adicional         numeric(7,4),
    ADD COLUMN IF NOT EXISTS numero_acordo              text,
    ADD COLUMN IF NOT EXISTS vendor                     text,
    ADD COLUMN IF NOT EXISTS rebate                     numeric(7,4),

    -- Tributos nível pedido
    ADD COLUMN IF NOT EXISTS ipi_percentual             numeric(7,4),
    ADD COLUMN IF NOT EXISTS valor_ipi                  numeric(12,2),
    ADD COLUMN IF NOT EXISTS icms_st_percentual         numeric(7,4),
    ADD COLUMN IF NOT EXISTS valor_icms_st              numeric(12,2),
    ADD COLUMN IF NOT EXISTS base_calculo_st            numeric(12,2),
    ADD COLUMN IF NOT EXISTS mva_percentual             numeric(7,4),
    ADD COLUMN IF NOT EXISTS pis_percentual             numeric(7,4),
    ADD COLUMN IF NOT EXISTS cofins_percentual          numeric(7,4),
    ADD COLUMN IF NOT EXISTS cfop                       text,
    ADD COLUMN IF NOT EXISTS natureza_operacao          text,
    ADD COLUMN IF NOT EXISTS ncm                        text,

    -- Vendedor / projeto
    ADD COLUMN IF NOT EXISTS nome_vendedor              text,
    ADD COLUMN IF NOT EXISTS codigo_vendedor            text,
    ADD COLUMN IF NOT EXISTS centro_custo               text,
    ADD COLUMN IF NOT EXISTS projeto_obra               text,
    ADD COLUMN IF NOT EXISTS responsavel_aprovacao      text,

    -- Totais e observações
    ADD COLUMN IF NOT EXISTS observacoes_gerais         text,
    ADD COLUMN IF NOT EXISTS valor_total                numeric(12,2),

    -- JSON bruto retornado pela IA (diagnóstico + fallback de exportação)
    ADD COLUMN IF NOT EXISTS json_ia_bruto              jsonb;

-- Índice para deduplicação por gmail_message_id (mesmo comportamento do
-- header Prefer: ignore-duplicates no INSERT).
CREATE UNIQUE INDEX IF NOT EXISTS idx_pedidos_gmail_message_id
    ON public.pedidos(gmail_message_id)
    WHERE gmail_message_id IS NOT NULL;

-- Índice para buscas por número do pedido do cliente
CREATE INDEX IF NOT EXISTS idx_pedidos_numero_pedido_cliente
    ON public.pedidos(tenant_id, numero_pedido_cliente)
    WHERE numero_pedido_cliente IS NOT NULL;

-- Índice para buscas por CNPJ (deduplicação número+CNPJ)
CREATE INDEX IF NOT EXISTS idx_pedidos_cnpj
    ON public.pedidos(tenant_id, cnpj)
    WHERE cnpj IS NOT NULL;

-- =============================================================================
-- 2. PEDIDO_ITENS — colunas de produto expandidas
-- =============================================================================

ALTER TABLE public.pedido_itens
    -- Sequência e identificação
    ADD COLUMN IF NOT EXISTS numero_item                integer,
    ADD COLUMN IF NOT EXISTS codigo_cliente             text,
    ADD COLUMN IF NOT EXISTS ean                        text,
    ADD COLUMN IF NOT EXISTS part_number                text,
    ADD COLUMN IF NOT EXISTS referencia                 text,
    ADD COLUMN IF NOT EXISTS descricao                  text,
    ADD COLUMN IF NOT EXISTS codigo_produto_erp         text,

    -- Produto
    ADD COLUMN IF NOT EXISTS marca                      text,
    ADD COLUMN IF NOT EXISTS modelo                     text,
    ADD COLUMN IF NOT EXISTS cor                        text,
    ADD COLUMN IF NOT EXISTS tamanho                    text,
    ADD COLUMN IF NOT EXISTS grade                      text,
    ADD COLUMN IF NOT EXISTS unidade_medida             text,

    -- Quantidades
    ADD COLUMN IF NOT EXISTS quantidade_minima          numeric(10,3),
    ADD COLUMN IF NOT EXISTS multiplo_venda             numeric(10,3),
    ADD COLUMN IF NOT EXISTS data_entrega_item          date,

    -- Preços
    ADD COLUMN IF NOT EXISTS preco_unitario_com_impostos numeric(12,4),
    ADD COLUMN IF NOT EXISTS preco_total                numeric(12,2),
    ADD COLUMN IF NOT EXISTS preco_total_com_impostos   numeric(12,2),

    -- Tributos nível item
    ADD COLUMN IF NOT EXISTS ipi_item_percentual        numeric(7,4),
    ADD COLUMN IF NOT EXISTS valor_ipi_item             numeric(12,2),
    ADD COLUMN IF NOT EXISTS icms_st_item_percentual    numeric(7,4),
    ADD COLUMN IF NOT EXISTS valor_icms_st_item         numeric(12,2),
    ADD COLUMN IF NOT EXISTS base_calculo_st_item       numeric(12,2),
    ADD COLUMN IF NOT EXISTS ncm_item                   text,
    ADD COLUMN IF NOT EXISTS cfop_item                  text,

    -- Descontos e verbas por item
    ADD COLUMN IF NOT EXISTS desconto_comercial         numeric(7,4),
    ADD COLUMN IF NOT EXISTS desconto_adicional_item    numeric(7,4),
    ADD COLUMN IF NOT EXISTS desconto                   numeric(7,4),
    ADD COLUMN IF NOT EXISTS vendor_item                text,

    -- Logística do item
    ADD COLUMN IF NOT EXISTS peso_bruto_item            numeric(12,3),
    ADD COLUMN IF NOT EXISTS peso_liquido_item          numeric(12,3),
    ADD COLUMN IF NOT EXISTS volume_item                numeric(12,4),

    -- Rastreabilidade
    ADD COLUMN IF NOT EXISTS numero_serie               text,
    ADD COLUMN IF NOT EXISTS lote                       text,
    ADD COLUMN IF NOT EXISTS data_validade              date,
    ADD COLUMN IF NOT EXISTS shelf_life_dias            integer,

    -- Setores especializados
    ADD COLUMN IF NOT EXISTS temperatura_conservacao    text,
    ADD COLUMN IF NOT EXISTS registro_anvisa            text,
    ADD COLUMN IF NOT EXISTS aplicacao                  text,
    ADD COLUMN IF NOT EXISTS cultura_destino            text,
    ADD COLUMN IF NOT EXISTS principio_ativo            text,
    ADD COLUMN IF NOT EXISTS concentracao               text,
    ADD COLUMN IF NOT EXISTS registro_mapa              text,
    ADD COLUMN IF NOT EXISTS composicao                 text,
    ADD COLUMN IF NOT EXISTS codigo_marketplace         text,
    ADD COLUMN IF NOT EXISTS numero_empenho             text,
    ADD COLUMN IF NOT EXISTS codigo_catmat              text,
    ADD COLUMN IF NOT EXISTS observacao_item            text;

-- Índice para exportação ordenada
CREATE INDEX IF NOT EXISTS idx_pedido_itens_numero_item
    ON public.pedido_itens(pedido_id, numero_item);

-- Notifica PostgREST pra recarregar o schema (necessário após ALTER TABLE)
NOTIFY pgrst, 'reload schema';
