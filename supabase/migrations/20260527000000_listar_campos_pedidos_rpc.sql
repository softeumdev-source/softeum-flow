-- Parte C2: RPC do catálogo dinâmico de campos mapeáveis
--
-- Lê information_schema.columns filtrando blacklist. Fonte da verdade do
-- catálogo dinâmico consumido pela edge function analisar-layout-erp.
--
-- Blacklist (35 colunas em pedidos + 7 em pedido_itens) cobre PKs, FKs,
-- timestamps automáticos, flags de fluxo, integração de email, sistema
-- de IA/exportação e legados duplicados (inscricao_estadual,
-- centro_custo, codigo_projeto, codigo_vendedor, numero, total_previsto
-- em pedidos; data_validade, lote em pedido_itens — todos têm versão
-- canônica em outras colunas: inscricao_estadual_cliente,
-- codigo_projeto_erp, codigo_vendedor_erp, numero_pedido_cliente,
-- data_validade_produto, numero_lote/lote_erp).

CREATE OR REPLACE FUNCTION public.listar_campos_pedidos_disponiveis()
RETURNS TABLE (tabela text, nome text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 'pedidos'::text AS tabela, c.column_name::text AS nome
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name   = 'pedidos'
    AND c.column_name <> ALL (ARRAY[
      'id',
      'tenant_id',
      'created_at',
      'pdf_url',
      'pdf_nome_arquivo',
      'pdf_hash',
      'email_grupo_id',
      'gmail_message_id',
      'email_remetente',
      'remetente_email',
      'email_envelope_from',
      'remetente_origem',
      'email_assunto',
      'assunto_email',
      'xml_original',
      'json_ia_bruto',
      'confianca_ia',
      'status',
      'motivo_reprovacao',
      'aprovado_por',
      'aprovado_em',
      'exportado',
      'exportado_em',
      'exportacao_metodo',
      'exportacao_tentativas',
      'exportacao_erro',
      'erp_destino',
      'erp_id_externo',
      'canal_entrada',
      'inscricao_estadual',
      'centro_custo',
      'codigo_projeto',
      'codigo_vendedor',
      'numero',
      'total_previsto'
    ])
  UNION ALL
  SELECT 'pedido_itens'::text AS tabela, c.column_name::text AS nome
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name   = 'pedido_itens'
    AND c.column_name <> ALL (ARRAY[
      'id',
      'tenant_id',
      'pedido_id',
      'numero_item',
      'confianca',
      'data_validade',
      'lote'
    ])
  ORDER BY 1, 2;
$$;

COMMENT ON FUNCTION public.listar_campos_pedidos_disponiveis() IS
  'Lê information_schema.columns filtrando blacklist. Fonte da verdade do catálogo dinâmico consumido pela edge function analisar-layout-erp.';

REVOKE EXECUTE ON FUNCTION public.listar_campos_pedidos_disponiveis() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.listar_campos_pedidos_disponiveis() TO authenticated, service_role;
