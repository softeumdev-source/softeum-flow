-- Rollback da auto-expansão de schema (Partes C/D não vingaram).
-- A tabela schema_alteracoes_log e a função executar_ddl_expansao_pedido
-- foram criadas hoje (20260526) e nunca passaram em produção real — só
-- 3 registros de teste do William Pães. A função listar_campos_pedidos_
-- disponiveis (20260527) suportava o catálogo dinâmico que também sai.
--
-- DROP em ordem reversa de dependências:
--   1. função DDL (depende da tabela)
--   2. RPC catálogo (independente, vai junto)
--   3. tabela (perde os 3 rows de teste — sem impacto operacional)

DROP FUNCTION IF EXISTS public.executar_ddl_expansao_pedido(uuid);
DROP FUNCTION IF EXISTS public.listar_campos_pedidos_disponiveis();
DROP TABLE IF EXISTS public.schema_alteracoes_log;
