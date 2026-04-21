-- ============================================
-- RLS POLICIES - SOFTEM SCHEMA
-- ============================================

-- TENANTS
-- Super admins: full access
CREATE POLICY "Super admin full access on tenants"
    ON public.tenants
    FOR ALL
    TO authenticated
    USING (public.is_super_admin())
    WITH CHECK (public.is_super_admin());

-- Tenant members: view their tenant
CREATE POLICY "Tenant members can view their tenant"
    ON public.tenants
    FOR SELECT
    TO authenticated
    USING (public.is_tenant_member(id));

-- TENANT_MEMBROS
-- Super admins: full access
CREATE POLICY "Super admin full access on tenant_membros"
    ON public.tenant_membros
    FOR ALL
    TO authenticated
    USING (public.is_super_admin())
    WITH CHECK (public.is_super_admin());

-- Tenant admins: manage members of their tenant
CREATE POLICY "Tenant admins can manage their members"
    ON public.tenant_membros
    FOR ALL
    TO authenticated
    USING (public.is_tenant_admin(tenant_id))
    WITH CHECK (public.is_tenant_admin(tenant_id));

-- Tenant members: view other members of same tenant
CREATE POLICY "Tenant members can view their tenant members"
    ON public.tenant_membros
    FOR SELECT
    TO authenticated
    USING (public.is_tenant_member(tenant_id));

-- SUPER_ADMINS
CREATE POLICY "Only super admins access super_admins"
    ON public.super_admins
    FOR ALL
    TO authenticated
    USING (public.is_super_admin())
    WITH CHECK (public.is_super_admin());

-- PLANOS (public read)
CREATE POLICY "Public read on planos"
    ON public.planos
    FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Super admin can manage planos"
    ON public.planos
    FOR ALL
    TO authenticated
    USING (public.is_super_admin())
    WITH CHECK (public.is_super_admin());

-- PEDIDOS
-- Tenant members can view their orders
CREATE POLICY "Tenant members can view their pedidos"
    ON public.pedidos
    FOR SELECT
    TO authenticated
    USING (public.is_tenant_member(tenant_id));

-- Tenant admins can insert/update/delete
CREATE POLICY "Tenant admins can manage pedidos"
    ON public.pedidos
    FOR ALL
    TO authenticated
    USING (public.is_tenant_admin(tenant_id))
    WITH CHECK (public.is_tenant_admin(tenant_id));

-- PEDIDO_ITENS (segue mesma lógica de pedidos)
CREATE POLICY "Tenant members can view their pedido_itens"
    ON public.pedido_itens
    FOR SELECT
    TO authenticated
    USING (public.is_tenant_member(tenant_id));

CREATE POLICY "Tenant admins can manage pedido_itens"
    ON public.pedido_itens
    FOR ALL
    TO authenticated
    USING (public.is_tenant_admin(tenant_id))
    WITH CHECK (public.is_tenant_admin(tenant_id));

-- PEDIDO_LOGS (auditoria - apenas leitura para members, insert pelo sistema)
CREATE POLICY "Tenant members can view their pedido_logs"
    ON public.pedido_logs
    FOR SELECT
    TO authenticated
    USING (public.is_tenant_member(tenant_id));

CREATE POLICY "Tenant admins can insert pedido_logs"
    ON public.pedido_logs
    FOR INSERT
    TO authenticated
    WITH CHECK (public.is_tenant_admin(tenant_id));

-- TENANT_GMAIL_CONFIG
-- Only tenant admins
CREATE POLICY "Tenant admins can manage gmail config"
    ON public.tenant_gmail_config
    FOR ALL
    TO authenticated
    USING (public.is_tenant_admin(tenant_id))
    WITH CHECK (public.is_tenant_admin(tenant_id));

-- TENANT_ERP_CONFIG
CREATE POLICY "Tenant admins can manage erp config"
    ON public.tenant_erp_config
    FOR ALL
    TO authenticated
    USING (public.is_tenant_admin(tenant_id))
    WITH CHECK (public.is_tenant_admin(tenant_id));

-- TENANT_USO
-- Tenant members can view usage (para o dashboard)
CREATE POLICY "Tenant members can view their uso"
    ON public.tenant_uso
    FOR SELECT
    TO authenticated
    USING (public.is_tenant_member(tenant_id));

-- System can update (via edge functions ou triggers)
CREATE POLICY "Tenant admins can manage uso"
    ON public.tenant_uso
    FOR ALL
    TO authenticated
    USING (public.is_tenant_admin(tenant_id))
    WITH CHECK (public.is_tenant_admin(tenant_id));

-- CONFIGURACOES
CREATE POLICY "Tenant members can view their configuracoes"
    ON public.configuracoes
    FOR SELECT
    TO authenticated
    USING (public.is_tenant_member(tenant_id));

CREATE POLICY "Tenant admins can manage configuracoes"
    ON public.configuracoes
    FOR ALL
    TO authenticated
    USING (public.is_tenant_admin(tenant_id))
    WITH CHECK (public.is_tenant_admin(tenant_id));

-- ============================================
-- INDEXES FOR PERFORMANCE
-- ============================================
CREATE INDEX idx_tenant_membros_user_id ON public.tenant_membros(user_id);
CREATE INDEX idx_tenant_membros_tenant_id ON public.tenant_membros(tenant_id);
CREATE INDEX idx_pedidos_tenant_id ON public.pedidos(tenant_id);
CREATE INDEX idx_pedidos_status ON public.pedidos(status);
CREATE INDEX idx_pedidos_data_pedido ON public.pedidos(data_pedido);
CREATE INDEX idx_pedido_itens_pedido_id ON public.pedido_itens(pedido_id);
CREATE INDEX idx_pedido_logs_pedido_id ON public.pedido_logs(pedido_id);
CREATE INDEX idx_pedidos_tenant_status ON public.pedidos(tenant_id, status);
CREATE INDEX idx_tenant_uso_tenant_mes ON public.tenant_uso(tenant_id, ano_mes);

-- ============================================
-- INSERT SAMPLE DATA (optional - for testing)
-- ============================================
-- Insert default plano
INSERT INTO public.planos (nome, limite_pedidos_mes, preco_mensal) 
VALUES ('Básico', 100, 49.90), ('Profissional', 500, 149.90), ('Enterprise', 2000, 499.90)
ON CONFLICT DO NOTHING;