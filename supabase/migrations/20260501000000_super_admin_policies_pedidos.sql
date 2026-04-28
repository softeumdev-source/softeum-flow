-- Hotfix: super admin não conseguia ver pedido_itens / pedido_logs.
--
-- Sintoma: na tela de detalhe do pedido, "Itens do pedido" mostrava
-- "Nenhum item neste pedido" para super admin em qualquer tenant que
-- ele não fosse `tenant_membros` ativo. RLS estava bloqueando porque
-- `pedidos` tinha policy de super admin (gerenciada pelo Lovable),
-- mas `pedido_itens` e `pedido_logs` herdaram só a policy de tenant
-- member do migration `20260421164412`.
--
-- Padrão usado: igual ao "Super admin full access on de_para" — FOR ALL
-- com USING/WITH CHECK = is_super_admin(). Idempotente via DROP POLICY
-- IF EXISTS antes do CREATE.

-- ============================================
-- pedido_itens
-- ============================================
DROP POLICY IF EXISTS "Super admin full access on pedido_itens"
    ON public.pedido_itens;

CREATE POLICY "Super admin full access on pedido_itens"
    ON public.pedido_itens
    FOR ALL
    TO authenticated
    USING (public.is_super_admin())
    WITH CHECK (public.is_super_admin());

-- ============================================
-- pedido_logs
-- ============================================
DROP POLICY IF EXISTS "Super admin full access on pedido_logs"
    ON public.pedido_logs;

CREATE POLICY "Super admin full access on pedido_logs"
    ON public.pedido_logs
    FOR ALL
    TO authenticated
    USING (public.is_super_admin())
    WITH CHECK (public.is_super_admin());
