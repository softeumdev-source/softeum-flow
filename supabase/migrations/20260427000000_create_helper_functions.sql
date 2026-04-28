-- Garante que as helper functions de RLS existam antes das migrations
-- novas (20260428... em diante) que dependem delas.
--
-- Contexto: o ambiente do Lovable aplicou parcialmente as migrations
-- iniciais — várias tabelas existem, mas funções como is_tenant_member,
-- is_tenant_admin, is_super_admin e o trigger update_updated_at_column
-- não estão presentes. Como as migrations 20260421164354 e
-- 20260421164423 (que originalmente as criavam) foram marcadas como
-- "applied" via supabase migration repair sem terem sido reexecutadas,
-- precisamos de uma migration nova que cubra esse buraco.
--
-- Tudo aqui é CREATE OR REPLACE / IF NOT EXISTS — totalmente
-- idempotente. Se as funções já existirem, vira no-op semântico.

-- ============================================
-- Tipos
-- ============================================
DO $$ BEGIN
    CREATE TYPE public.app_role AS ENUM ('admin', 'operador');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================
-- Helpers
-- ============================================
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
