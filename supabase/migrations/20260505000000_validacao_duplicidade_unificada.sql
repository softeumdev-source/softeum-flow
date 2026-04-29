-- Validação de duplicidade unificada
--
-- 1. Coluna pdf_hash em pedidos pra suportar checagem por impressão
--    digital do PDF. Pedidos antigos ficam com NULL — checagem nova
--    (hash) só vale pra pedidos criados a partir desta migration.
-- 2. Index parcial pra lookup rápido.
-- 3. Apaga as 3 chaves antigas (`duplicados_ativo`,
--    `bloquear_pdf_duplicado`, `bloquear_numero_cnpj`) — nunca foram
--    lidas pelo backend e foram substituídas por uma única chave
--    `validacao_duplicidade_ativa` (gravada pelo front sob demanda).

ALTER TABLE public.pedidos
    ADD COLUMN IF NOT EXISTS pdf_hash text;

CREATE INDEX IF NOT EXISTS idx_pedidos_pdf_hash
    ON public.pedidos(tenant_id, pdf_hash)
    WHERE pdf_hash IS NOT NULL;

DELETE FROM public.configuracoes
WHERE chave IN ('duplicados_ativo', 'bloquear_pdf_duplicado', 'bloquear_numero_cnpj');
