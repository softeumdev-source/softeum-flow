-- Bucket de minuto pra dedup de notificações de e-mail (v2).
--
-- Substitui a abordagem da migration 20260515000000 que tentava
-- criar índice direto sobre uma expressão (extract(epoch FROM ...)),
-- recusada pelo PG por não ser IMMUTABLE.
--
-- Solução: coluna física enviado_em_minuto populada por trigger
-- BEFORE INSERT/UPDATE OF enviado_em. Trigger functions podem ser
-- VOLATILE, então não esbarram no requisito de IMMUTABLE. UNIQUE é
-- criado direto na coluna física, sem expression.
--
-- Idempotente.

-- 1) Coluna bucket (timestamptz, segundos zerados)
ALTER TABLE public.notificacoes_enviadas
    ADD COLUMN IF NOT EXISTS enviado_em_minuto timestamptz;

-- 2) Backfill nas rows existentes
UPDATE public.notificacoes_enviadas
SET enviado_em_minuto = date_trunc('minute', enviado_em)
WHERE enviado_em_minuto IS NULL AND enviado_em IS NOT NULL;

-- 3) Trigger que mantém enviado_em_minuto sincronizado com enviado_em
CREATE OR REPLACE FUNCTION public.set_notif_enviadas_minuto()
RETURNS TRIGGER AS $$
BEGIN
    NEW.enviado_em_minuto := date_trunc('minute', NEW.enviado_em);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_notif_enviadas_minuto
    ON public.notificacoes_enviadas;

CREATE TRIGGER trg_set_notif_enviadas_minuto
    BEFORE INSERT OR UPDATE OF enviado_em ON public.notificacoes_enviadas
    FOR EACH ROW
    EXECUTE FUNCTION public.set_notif_enviadas_minuto();

-- 4) UNIQUE bucketizado por minuto, agora em coluna física
CREATE UNIQUE INDEX IF NOT EXISTS notif_enviadas_dedup_min_uidx
    ON public.notificacoes_enviadas (pedido_id, status, enviado_em_minuto);
