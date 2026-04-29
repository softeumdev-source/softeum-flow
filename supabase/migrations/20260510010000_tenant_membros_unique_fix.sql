-- Hotfix da migration anterior (20260510000000_tenant_membros_unique.sql).
--
-- A versão original incluía uma CTE de dedup ordenada por created_at, mas
-- essa coluna não existe em tenant_membros na produção (schema divergiu).
-- Resultado: a migration falhou e a constraint nunca foi criada.
--
-- Cenário em produção: 0 duplicatas confirmadas, então só criar a
-- constraint resolve. O DO ... EXCEPTION mantém idempotência caso já
-- exista (re-run / dev).

DO $$ BEGIN
  ALTER TABLE public.tenant_membros
    ADD CONSTRAINT tenant_membros_user_tenant_unique
    UNIQUE (user_id, tenant_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
