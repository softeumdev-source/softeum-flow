-- Adiciona coluna `origem` em de_para para distinguir registros criados
-- manualmente vs. confirmados via sugestão da IA vs. carregados por
-- importação de planilha.
--
-- Linhas existentes ficam com o default 'manual' — coerente: antes da
-- feature da IA, todos os DE-PARAs eram fruto de cadastro manual ou
-- importação. Tratar tudo como manual no histórico não atrapalha
-- nada (filtros e badges continuam corretos pra registros novos).

ALTER TABLE public.de_para
    ADD COLUMN IF NOT EXISTS origem text NOT NULL DEFAULT 'manual';

DO $$ BEGIN
    ALTER TABLE public.de_para
        ADD CONSTRAINT de_para_origem_check
        CHECK (origem IN ('manual', 'ia', 'importacao'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_de_para_origem
    ON public.de_para(tenant_id, origem);
