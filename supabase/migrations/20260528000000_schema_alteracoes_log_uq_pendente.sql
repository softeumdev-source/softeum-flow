-- Parte C3: UNIQUE parcial em schema_alteracoes_log para idempotência
--
-- Garante que cada tenant tenha no máximo UMA proposta pendente
-- (executado_em IS NULL) por combinação (tenant_id_origem, tabela_alvo,
-- nome_coluna_origem — comparado case-insensitive via lower()).
--
-- Cobre apenas tipo_operacao = 'criar_coluna': mapear_existente e ignorar
-- têm executado_em preenchido na inserção, logo ficam fora do predicado.
--
-- Idempotência: propor-expansao-schema detecta violação 23505 e devolve
-- o id da linha existente em vez de criar duplicata.

CREATE UNIQUE INDEX uq_sal_pendente
  ON public.schema_alteracoes_log (
    tenant_id_origem,
    COALESCE(tabela_alvo, 'sem_tabela'),
    lower(nome_coluna_origem)
  )
  WHERE executado_em IS NULL;
