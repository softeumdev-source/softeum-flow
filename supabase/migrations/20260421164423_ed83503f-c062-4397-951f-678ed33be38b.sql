-- Corrige security warnings: adiciona search_path nas funções

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.is_tenant_admin(p_tenant_id uuid)
RETURNS BOOLEAN AS $$
DECLARE
    v_papel public.app_role;
BEGIN
    SELECT papel INTO v_papel
    FROM public.tenant_membros
    WHERE user_id = auth.uid() AND tenant_id = p_tenant_id AND ativo = true;
    RETURN v_papel = 'admin';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.is_tenant_member(p_tenant_id uuid)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.tenant_membros
        WHERE user_id = auth.uid() AND tenant_id = p_tenant_id AND ativo = true
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.super_admins
        WHERE user_id = auth.uid()
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.get_user_tenant_id()
RETURNS uuid AS $$
DECLARE
    tenant_uuid uuid;
BEGIN
    SELECT tenant_id INTO tenant_uuid
    FROM public.tenant_membros
    WHERE user_id = auth.uid() AND ativo = true
    LIMIT 1;
    RETURN tenant_uuid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;