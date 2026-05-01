-- Consolidação: policies "Super admin full access" que faltavam em
-- migrations versionadas.
--
-- Contexto: a auditoria de RLS encontrou 5 tabelas em que a policy de
-- super admin existe em produção (foi adicionada manualmente via
-- Lovable), mas nunca entrou em migration versionada. Os hotfixes
-- 20260501 (pedido_itens, pedido_logs) e 20260508 (notificacoes_painel)
-- cobriram só parte do gap. Sem este migration, qualquer ambiente novo
-- (staging, tenant novo recriado do zero) sobe sem a policy e o super
-- admin perde acesso a essas tabelas em tenants em que ele não é
-- `tenant_membros` ativo.
--
-- Tabelas cobertas:
--   1. pedidos
--   2. configuracoes
--   3. tenant_erp_config
--   4. tenant_gmail_config
--   5. tenant_uso
--
-- Padrão: idêntico ao "Super admin full access on de_para" e demais
-- hotfixes — FOR ALL, USING/WITH CHECK = is_super_admin(). Idempotente
-- via DROP POLICY IF EXISTS antes do CREATE, então rodar em ambiente
-- que já recebeu o hotfix manual via Lovable é seguro.
--
-- Bônus: system_errors tem coluna tenant_id mas nenhuma policy de
-- escopo de tenant — só super admin enxerga. Adicionado SELECT pra
-- tenant_member(tenant_id) pra que o tenant veja os próprios erros.

-- ============================================
-- pedidos
-- ============================================
DROP POLICY IF EXISTS "Super admin full access on pedidos"
    ON public.pedidos;

CREATE POLICY "Super admin full access on pedidos"
    ON public.pedidos
    FOR ALL
    TO authenticated
    USING (public.is_super_admin())
    WITH CHECK (public.is_super_admin());

-- ============================================
-- configuracoes
-- ============================================
DROP POLICY IF EXISTS "Super admin full access on configuracoes"
    ON public.configuracoes;

CREATE POLICY "Super admin full access on configuracoes"
    ON public.configuracoes
    FOR ALL
    TO authenticated
    USING (public.is_super_admin())
    WITH CHECK (public.is_super_admin());

-- ============================================
-- tenant_erp_config
-- ============================================
DROP POLICY IF EXISTS "Super admin full access on tenant_erp_config"
    ON public.tenant_erp_config;

CREATE POLICY "Super admin full access on tenant_erp_config"
    ON public.tenant_erp_config
    FOR ALL
    TO authenticated
    USING (public.is_super_admin())
    WITH CHECK (public.is_super_admin());

-- ============================================
-- tenant_gmail_config
-- ============================================
DROP POLICY IF EXISTS "Super admin full access on tenant_gmail_config"
    ON public.tenant_gmail_config;

CREATE POLICY "Super admin full access on tenant_gmail_config"
    ON public.tenant_gmail_config
    FOR ALL
    TO authenticated
    USING (public.is_super_admin())
    WITH CHECK (public.is_super_admin());

-- ============================================
-- tenant_uso
-- ============================================
DROP POLICY IF EXISTS "Super admin full access on tenant_uso"
    ON public.tenant_uso;

CREATE POLICY "Super admin full access on tenant_uso"
    ON public.tenant_uso
    FOR ALL
    TO authenticated
    USING (public.is_super_admin())
    WITH CHECK (public.is_super_admin());

-- ============================================
-- system_errors: tenant scope
-- ============================================
-- Mantém "Super admin full access on system_errors" criada em
-- 20260428130000_monitoramento_erros.sql. Adiciona apenas SELECT
-- pra membros do tenant verem os próprios erros.
DROP POLICY IF EXISTS "Tenants veem próprios erros"
    ON public.system_errors;

CREATE POLICY "Tenants veem próprios erros"
    ON public.system_errors
    FOR SELECT
    TO authenticated
    USING (public.is_tenant_member(tenant_id));
