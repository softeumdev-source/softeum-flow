-- Reset pré-produção: limpa pedidos teste para começar com nova arquitetura.
-- 4 tabelas afetadas (todas em CASCADE no schema):
--   pedidos                          (44 rows)  — pedidos teste
--   pedido_itens                     (77 rows)  — itens dos pedidos
--   pedido_itens_pendentes_de_para   (20 rows)  — fila de DE-PARA pendente
--   pedido_logs                      (32 rows)  — histórico de eventos
-- Total: 173 rows. 1 tenant teste (William Pães), zero clientes reais.
TRUNCATE TABLE
  pedidos,
  pedido_itens,
  pedido_itens_pendentes_de_para,
  pedido_logs
RESTART IDENTITY CASCADE;
