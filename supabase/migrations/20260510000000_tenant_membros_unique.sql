-- Bug histórico: tenant_membros nunca teve UNIQUE em (user_id, tenant_id),
-- apesar do RPC add_tenant_member usar ON CONFLICT (user_id, tenant_id).
-- A app já contornava com upsert manual em criar-usuario-tenant / Equipe.tsx,
-- mas o root cause continuava no schema.
--
-- Cenário em produção: 0 duplicatas confirmadas, então a migration só
-- cria a constraint. O bloco DO ... EXCEPTION mantém idempotência caso
-- a constraint já exista (re-run / ambiente de dev).

DO $$ BEGIN
  ALTER TABLE public.tenant_membros
    ADD CONSTRAINT tenant_membros_user_tenant_unique
    UNIQUE (user_id, tenant_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
