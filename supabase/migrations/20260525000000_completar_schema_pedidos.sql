-- Completa o conjunto de endereço de faturamento para paridade com endereço
-- de entrega. As colunas endereco_faturamento, cidade_faturamento,
-- estado_faturamento e cep_faturamento já existiam desde migrations anteriores,
-- mas bairro, numero e complemento de faturamento nunca foram criados, causando
-- erro PGRST204 quando a IA mapeava "Bairro Comprador" → bairro_faturamento.

ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS bairro_faturamento       text;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS numero_faturamento       text;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS complemento_faturamento  text;
