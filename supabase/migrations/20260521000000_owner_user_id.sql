-- Sprint 3 (parte B): conceito de "dono do tenant" intocável.
--
-- Bug de governança: hoje qualquer admin do tenant pode rebaixar/desativar/
-- remover qualquer outro admin do mesmo tenant. Cenário real: William
-- (admin original, criou o tenant) promove Diego pra admin → Diego rebaixa
-- William → William perde acesso de admin do próprio tenant que criou.
--
-- Solução: marcar o usuário que criou o tenant como "dono" via
-- tenants.owner_user_id, e bloquear via trigger no banco qualquer mudança
-- destrutiva (papel, ativo, delete) na linha de tenant_membros do dono,
-- exceto quando o caller for super admin ou service role (edges internas).
--
-- Decisões alinhadas:
--   - owner_user_id NULLABLE inicialmente (Q1). Tenants sem admin no
--     backfill ficam NULL — super admin resolve manual depois.
--   - ON DELETE SET NULL na FK pro auth.users (Q2). Tenant órfão é caso
--     raro, super admin faz transferência manualmente.
--   - Mensagem do erro: "Não é possível alterar o dono do tenant.
--     Apenas super admin pode." (Q3)
--   - Coluna fica UPDATE-able sem trigger restringindo o próprio
--     owner_user_id (Q6) — futura tela de "transferir propriedade" só
--     precisa fazer UPDATE.

-- ============================================
-- 1. Coluna owner_user_id em tenants
-- ============================================
ALTER TABLE public.tenants
    ADD COLUMN IF NOT EXISTS owner_user_id uuid
    REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tenants_owner_user_id
    ON public.tenants(owner_user_id);

-- ============================================
-- 2. Backfill: admin ativo mais antigo, com fallback pra admin
--    inativo se não houver ativo. Idempotente (só preenche NULLs).
-- ============================================
UPDATE public.tenants t
SET owner_user_id = (
    SELECT user_id FROM public.tenant_membros
    WHERE tenant_id = t.id AND papel = 'admin' AND ativo = true
    ORDER BY created_at ASC
    LIMIT 1
)
WHERE owner_user_id IS NULL;

-- 2ª passada: tenants que ficaram sem ninguém na 1ª (todos admins
-- inativos). Pega admin mais antigo independente de ativo.
UPDATE public.tenants t
SET owner_user_id = (
    SELECT user_id FROM public.tenant_membros
    WHERE tenant_id = t.id AND papel = 'admin'
    ORDER BY created_at ASC
    LIMIT 1
)
WHERE owner_user_id IS NULL;

-- Não aplicar NOT NULL aqui (Q1). Fica como follow-up depois de
-- validar manual que todos os tenants têm owner.

-- ============================================
-- 3. Trigger BEFORE UPDATE/DELETE em tenant_membros
--    bloqueia mudança em papel/ativo/delete da linha do dono
--    quando caller não é super admin nem service role.
-- ============================================
CREATE OR REPLACE FUNCTION public.proteger_dono_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_owner_id uuid;
    v_target_user uuid;
    v_target_tenant uuid;
BEGIN
    -- Service role (edges internas): bypass total.
    IF (SELECT auth.role()) = 'service_role' THEN
        RETURN COALESCE(NEW, OLD);
    END IF;

    -- Super admin: bypass.
    IF public.is_super_admin() THEN
        RETURN COALESCE(NEW, OLD);
    END IF;

    v_target_tenant := COALESCE(NEW.tenant_id, OLD.tenant_id);
    v_target_user := COALESCE(NEW.user_id, OLD.user_id);

    SELECT owner_user_id INTO v_owner_id
    FROM public.tenants
    WHERE id = v_target_tenant;

    -- Sem dono definido (tenant órfão), não há o que proteger.
    IF v_owner_id IS NULL THEN
        RETURN COALESCE(NEW, OLD);
    END IF;

    -- Linha não é do dono → permite.
    IF v_target_user <> v_owner_id THEN
        RETURN COALESCE(NEW, OLD);
    END IF;

    -- Linha é do dono. Bloqueia se for DELETE ou se a UPDATE alterar
    -- papel ou ativo. Outras colunas (ex.: ultimo_acesso, nome) podem
    -- ser modificadas livremente.
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Não é possível alterar o dono do tenant. Apenas super admin pode.';
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF (NEW.papel IS DISTINCT FROM OLD.papel)
           OR (NEW.ativo IS DISTINCT FROM OLD.ativo) THEN
            RAISE EXCEPTION 'Não é possível alterar o dono do tenant. Apenas super admin pode.';
        END IF;
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS tenant_membros_proteger_dono ON public.tenant_membros;

CREATE TRIGGER tenant_membros_proteger_dono
    BEFORE UPDATE OR DELETE ON public.tenant_membros
    FOR EACH ROW
    EXECUTE FUNCTION public.proteger_dono_tenant();
