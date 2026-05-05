-- Tabela para rastrear batches enviados para Anthropic
CREATE TABLE processamento_batch (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  batch_id TEXT NOT NULL UNIQUE, -- ID retornado pela Anthropic
  status TEXT NOT NULL DEFAULT 'enviado'
    CHECK (status IN ('enviado', 'processando', 'concluido', 'erro', 'expirado')),
  total_emails INTEGER NOT NULL DEFAULT 0,
  emails_sucesso INTEGER NOT NULL DEFAULT 0,
  emails_erro INTEGER NOT NULL DEFAULT 0,
  gmail_message_ids TEXT[] NOT NULL DEFAULT '{}', -- IDs dos emails incluídos
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  concluido_em TIMESTAMPTZ,
  erro_msg TEXT
);

-- Índices para polling eficiente
CREATE INDEX idx_batch_status ON processamento_batch(status)
  WHERE status IN ('enviado', 'processando');
CREATE INDEX idx_batch_tenant ON processamento_batch(tenant_id);

COMMENT ON TABLE processamento_batch IS
'Rastreia batches enviados para Anthropic Batch API por tenant';
