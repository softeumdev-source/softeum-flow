-- Rate limit pra endpoints públicos de convite (aceitar-convite e
-- validar-convite). Hoje ambas as edges são verify_jwt=false e aceitam
-- token de 64 hex chars no body sem throttle nenhum. Sem isso, atacante
-- pode fazer brute force de tokens — espaço de 256 bits é grande, mas
-- qualquer convite ativo capturado num leak vira porta de entrada
-- indefinida.
--
-- Esta tabela registra cada tentativa por IP. O helper rate-limit conta
-- tentativas dos últimos 15 minutos pra (ip, agora) e bloqueia se >= 10.
-- token_prefix guarda só os primeiros 8 chars do token pra debug —
-- token completo nunca é gravado.
--
-- RLS: ativada sem policies. Apenas service role acessa (todas as edges
-- envolvidas usam createClient com SERVICE_ROLE).

CREATE TABLE IF NOT EXISTS public.convite_tentativas (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ip text NOT NULL,
    token_prefix text NOT NULL,
    tentou_em timestamptz NOT NULL DEFAULT now(),
    sucesso boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_convite_tentativas_ip_tentou_em
    ON public.convite_tentativas(ip, tentou_em DESC);

ALTER TABLE public.convite_tentativas ENABLE ROW LEVEL SECURITY;
