-- Bug histórico: tenant_membros nunca teve UNIQUE em (user_id, tenant_id),
-- apesar do RPC add_tenant_member usar ON CONFLICT (user_id, tenant_id).
-- Esta migration:
--   1. Dedupa por (user_id, tenant_id) mantendo a linha MAIS RECENTE
--      (maior created_at; em empate, maior id::text). Funciona como
--      no-op quando não há duplicatas (cenário confirmado em produção).
--   2. Cria a constraint UNIQUE de forma idempotente.

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY user_id, tenant_id
           ORDER BY created_at DESC NULLS LAST, id::text DESC
         ) AS rn
  FROM public.tenant_membros
)
DELETE FROM public.tenant_membros
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

DO $$ BEGIN
  ALTER TABLE public.tenant_membros
    ADD CONSTRAINT tenant_membros_user_tenant_unique
    UNIQUE (user_id, tenant_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
