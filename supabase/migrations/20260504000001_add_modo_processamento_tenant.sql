-- Adiciona modo de processamento por tenant
-- imediato: processa PDF em tempo real (padrão)
-- batch: processa via Anthropic Batch API (50% mais barato, 5-30 min delay)

ALTER TABLE tenants
ADD COLUMN modo_processamento TEXT NOT NULL DEFAULT 'imediato'
CHECK (modo_processamento IN ('imediato', 'batch'));

COMMENT ON COLUMN tenants.modo_processamento IS
'Modo de processamento de PDFs: imediato (tempo real) ou batch (assíncrono, 50% mais barato)';
