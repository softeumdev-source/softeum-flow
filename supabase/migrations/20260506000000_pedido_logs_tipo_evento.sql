-- Aprovação automática com auditoria estruturada.
--
-- Adiciona tipo_evento + metadata em pedido_logs pra registrar quais
-- regras a aprovação automática validou (ou qual reprovou). Mantém o
-- esquema legado intacto (campo/valor_anterior/valor_novo continuam
-- usados pelo PedidoDetalhe pra trilha de edições manuais).
--
-- Idempotente.

ALTER TABLE public.pedido_logs
    ADD COLUMN IF NOT EXISTS tipo_evento text,
    ADD COLUMN IF NOT EXISTS metadata jsonb;

CREATE INDEX IF NOT EXISTS idx_pedido_logs_tipo_evento
    ON public.pedido_logs(pedido_id, tipo_evento)
    WHERE tipo_evento IS NOT NULL;
