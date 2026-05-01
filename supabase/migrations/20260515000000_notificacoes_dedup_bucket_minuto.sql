-- ESTA MIGRATION FALHOU EM PRODUÇÃO na sua primeira tentativa.
--
-- A versão original tentava:
--   CREATE UNIQUE INDEX ... (pedido_id, status,
--     ((extract(epoch FROM enviado_em)::bigint) / 60))
-- mas o PostgreSQL recusou:
--   "functions in index expression must be marked IMMUTABLE"
-- (extract(epoch FROM timestamptz) é STABLE, não IMMUTABLE, dependendo
-- da versão do PG).
--
-- O bucket de minuto foi reformulado na migration
-- 20260516000000_notificacoes_dedup_bucket_minuto_v2.sql usando coluna
-- enviado_em_minuto populada por trigger BEFORE INSERT/UPDATE — abordagem
-- robusta, sem depender de IMMUTABLE.
--
-- Esta migration agora cobre só o DROP da UNIQUE legada
-- (pedido_id, status), passo idempotente que continua sendo necessário.
-- A v2 não duplica esse drop.

ALTER TABLE public.notificacoes_enviadas
    DROP CONSTRAINT IF EXISTS notificacoes_enviadas_pedido_id_status_key;
