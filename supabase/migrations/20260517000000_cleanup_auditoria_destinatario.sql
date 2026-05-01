-- Cleanup da feature "auditoria de destinatário": removida do runtime
-- no PR refactor/email-remove-suspeita-runtime e da UI no PR
-- refactor/email-cleanup-suspeita-ui. Esta migration apaga o que ficou
-- residual no schema:
--   1. Colunas pedidos.notif_suspeita_destinatario e pedidos.notif_revisada
--   2. Índice idx_pedidos_notif_revisao_pendente
--   3. Configuração global bypass_revisao_destinatario
--
-- NÃO mexe em:
--   - pedidos.email_envelope_from (ainda usado na auditoria visual do
--     PedidoDetalhe).
--   - configuracoes_globais.severidade_minima_email.
--
-- Idempotente.

DROP INDEX IF EXISTS public.idx_pedidos_notif_revisao_pendente;

ALTER TABLE public.pedidos
    DROP COLUMN IF EXISTS notif_suspeita_destinatario,
    DROP COLUMN IF EXISTS notif_revisada;

DELETE FROM public.configuracoes_globais
WHERE chave = 'bypass_revisao_destinatario';
