-- pedidos.remetente_origem: rastreia qual fonte foi usada pra resolver
-- o varejo original (header_x_original, header_resent, header_from,
-- header_reply_to, corpo_regex, ia_pdf_email_comprador,
-- ia_pdf_email_remetente, nenhum). Auditoria do caminho que
-- processar-email-pdf escolheu — facilita diagnóstico de pedidos onde
-- a notificação caiu em endereço inesperado.
--
-- Idempotente.

ALTER TABLE public.pedidos
    ADD COLUMN IF NOT EXISTS remetente_origem text;
