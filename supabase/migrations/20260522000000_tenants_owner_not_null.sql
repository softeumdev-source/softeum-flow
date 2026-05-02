-- Sprint 3 follow-up: aplica NOT NULL em tenants.owner_user_id.
--
-- Sprint 3 Pt 2 (20260521000000_owner_user_id.sql) deixou a coluna
-- nullable conforme decisão Q1 da época, com plano de aplicar NOT NULL
-- numa migration follow-up depois de validar manualmente que todos os
-- tenants tinham owner.
--
-- Esta migration verifica a invariante e aplica NOT NULL. Se houver
-- algum tenant com owner_user_id NULL, a migration ABORTA com mensagem
-- clara — sem deixar o banco em estado inconsistente.
--
-- Como resolver caso a migration falhe:
--   1. Listar os órfãos:
--      SELECT id, nome, slug FROM public.tenants WHERE owner_user_id IS NULL;
--   2. Pra cada órfão, decidir um owner e aplicar:
--      UPDATE public.tenants SET owner_user_id = '<uuid-do-user>'
--      WHERE id = '<uuid-do-tenant>';
--   3. Reaplicar esta migration.

DO $$
DECLARE
    n int;
BEGIN
    SELECT COUNT(*) INTO n FROM public.tenants WHERE owner_user_id IS NULL;
    IF n > 0 THEN
        RAISE EXCEPTION 'Existem % tenant(s) com owner_user_id NULL. Defina manualmente antes de aplicar esta migration.', n;
    END IF;
END $$;

ALTER TABLE public.tenants
    ALTER COLUMN owner_user_id SET NOT NULL;
