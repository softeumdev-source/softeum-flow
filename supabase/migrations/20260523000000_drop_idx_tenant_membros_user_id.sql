-- Limpeza técnica: remove índice redundante em tenant_membros.
--
-- Estado atual:
--   - idx_tenant_membros_user_id (migration 20260421164412): btree (user_id)
--   - idx_tenant_membros_tenant_id (migration 20260421164412): btree (tenant_id)
--   - tenant_membros_user_tenant_unique (migration 20260510010000):
--       UNIQUE constraint em (user_id, tenant_id), com btree implícito
--
-- O btree implícito da UNIQUE em (user_id, tenant_id) cobre via prefix-scan
-- toda query que filtra só por user_id. Logo, idx_tenant_membros_user_id é
-- redundante e pode ser removido sem perda de performance em SELECT.
-- Ganho: 1 índice a menos pra atualizar em cada INSERT/UPDATE/DELETE.
--
-- O índice em (tenant_id) NÃO é redundante — é a única coluna não-prefixo
-- e fica.

DROP INDEX IF EXISTS public.idx_tenant_membros_user_id;
