-- Auditoria de destinatário de e-mail (PR-A)
--
-- 1. email_envelope_from: o "From:" real do header MIME no momento da
--    entrega. Persiste mesmo quando o destinatário escolhido vem do PDF
--    (override pela IA) — assim dá pra auditar quem entregou o e-mail.
-- 2. notif_suspeita_destinatario: bandeira que processar-email-pdf seta
--    quando suspeita que o destinatário escolhido pode estar errado
--    (ex: forward interno do tenant, mismatch envelope vs. resolvido).
-- 3. notif_revisada: super admin marcou como visto. Uma vez true,
--    notificações futuras desse pedido seguem normalmente — não fica
--    perguntando a cada mudança de status.
--
-- Idempotente.

ALTER TABLE public.pedidos
    ADD COLUMN IF NOT EXISTS email_envelope_from text,
    ADD COLUMN IF NOT EXISTS notif_suspeita_destinatario boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS notif_revisada boolean NOT NULL DEFAULT false;

-- Índice pra fila do super admin (pedidos suspeitos ainda não revisados).
CREATE INDEX IF NOT EXISTS idx_pedidos_notif_revisao_pendente
    ON public.pedidos(tenant_id, created_at DESC)
    WHERE notif_suspeita_destinatario = true AND notif_revisada = false;
