-- Dedup race-free de notificações de e-mail.
--
-- A constraint legada UNIQUE(pedido_id, status) impede re-transições
-- válidas (aprovou→reprovou→aprovou = 3 e-mails é o comportamento
-- esperado). Trocamos por um índice único bucketizado por minuto:
--   UNIQUE (pedido_id, status, minute_bucket(enviado_em))
--
-- Bucketização: floor(epoch_seconds / 60). PostgreSQL exige que a
-- expressão do índice seja IMMUTABLE — date_trunc com timestamptz é
-- STABLE (depende de timezone), por isso usamos extract(epoch FROM ...)
-- que é IMMUTABLE em timestamptz (timestamp interno em UTC).
--
-- Resultado:
--  - 2 invocações simultâneas no mesmo minuto pra (pedido, status):
--    só 1 vence o INSERT, a outra colide e a edge function pula o
--    envio.
--  - Re-transição em minutos diferentes: bucket diferente, INSERT
--    livre, e-mail novo.
--
-- Idempotente.

-- 1) Drop da UNIQUE legada que bloqueava re-transições.
ALTER TABLE public.notificacoes_enviadas
    DROP CONSTRAINT IF EXISTS notificacoes_enviadas_pedido_id_status_key;

-- 2) UNIQUE bucketizado por minuto.
CREATE UNIQUE INDEX IF NOT EXISTS notif_enviadas_dedup_min_uidx
    ON public.notificacoes_enviadas (
        pedido_id,
        status,
        ((extract(epoch FROM enviado_em)::bigint) / 60)
    );
