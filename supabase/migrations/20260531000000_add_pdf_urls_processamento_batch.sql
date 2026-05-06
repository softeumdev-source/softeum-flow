-- Armazena mapa customId→url dos PDFs enviados no batch,
-- para que coletar-resultados-batch possa persistir pdf_url em cada pedido criado.
ALTER TABLE processamento_batch
  ADD COLUMN IF NOT EXISTS pdf_urls JSONB NOT NULL DEFAULT '{}';
