-- Adiciona campo dados_layout para nova arquitetura "Haiku na entrada"
-- Estrutura: { "linhas": [ { "Nome Coluna": "valor", ... } ] }
-- Chaves correspondem EXATAMENTE aos nomes do layout em tenant_erp_config
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS dados_layout jsonb;

CREATE INDEX IF NOT EXISTS idx_pedidos_dados_layout
  ON pedidos USING gin (dados_layout);

COMMENT ON COLUMN pedidos.dados_layout IS
  'JSON com layout do ERP do cliente preenchido pela Haiku. ' ||
  'Estrutura: { "linhas": [ { "Nome Coluna": "valor", ... } ] }. ' ||
  'Chaves correspondem aos nomes do layout em tenant_erp_config.mapeamento_campos.colunas[].nome_coluna.';
