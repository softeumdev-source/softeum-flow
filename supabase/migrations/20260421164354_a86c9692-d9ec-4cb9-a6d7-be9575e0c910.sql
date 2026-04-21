-- Enum para papeis de usuario
CREATE TYPE "public"."app_role" AS ENUM ('admin', 'operador');

-- Tabela: tenants
CREATE TABLE "public"."tenants" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "nome" text NOT NULL,
    "slug" text UNIQUE NOT NULL,
    "ativo" boolean DEFAULT true,
    "limite_pedidos_mes" integer DEFAULT 100,
    "notas" text,
    "created_at" timestamptz DEFAULT now(),
    "updated_at" timestamptz DEFAULT now()
);

-- Tabela: tenant_membros (associa user do auth com tenant)
CREATE TABLE "public"."tenant_membros" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    "tenant_id" uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    "papel" "public"."app_role" NOT NULL DEFAULT 'operador',
    "nome" text,
    "ativo" boolean DEFAULT true,
    "created_at" timestamptz DEFAULT now()
);

-- Tabela: super_admins
CREATE TABLE "public"."super_admins" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    "nome" text,
    "created_at" timestamptz DEFAULT now()
);

-- Tabela: planos
CREATE TABLE "public"."planos" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "nome" text NOT NULL,
    "limite_pedidos_mes" integer NOT NULL,
    "preco_mensal" numeric(10,2),
    "created_at" timestamptz DEFAULT now()
);

-- Tabela: pedidos
CREATE TABLE "public"."pedidos" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "tenant_id" uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    "numero" text NOT NULL,
    "fornecedor" text,
    "data_pedido" date,
    "data_entrega" date,
    "status" text DEFAULT 'pendente' CHECK (status IN ('pendente', 'aprovado', 'parcial', 'rejeitado', 'concluido')),
    "confianca_ia" numeric(3,2) CHECK (confianca_ia >= 0 AND confianca_ia <= 1),
    "total_previsto" numeric(12,2),
    "observacoes" text,
    "pdf_url" text,
    "email_remetente" text,
    "data_recebimento_email" timestamptz,
    "criado_por" uuid REFERENCES auth.users(id),
    "atualizado_por" uuid REFERENCES auth.users(id),
    "created_at" timestamptz DEFAULT now(),
    "updated_at" timestamptz DEFAULT now(),
    UNIQUE("tenant_id", "numero")
);

-- Tabela: pedido_itens
CREATE TABLE "public"."pedido_itens" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "pedido_id" uuid NOT NULL REFERENCES public.pedidos(id) ON DELETE CASCADE,
    "tenant_id" uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    "produto_codigo" text,
    "produto_descricao" text,
    "quantidade" numeric(10,3),
    "unidade" text,
    "preco_unitario" numeric(12,4),
    "total" numeric(12,2),
    "sugestao_erp" text,
    "aceito" boolean,
    "created_at" timestamptz DEFAULT now()
);

-- Tabela: pedido_logs
CREATE TABLE "public"."pedido_logs" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "pedido_id" uuid NOT NULL REFERENCES public.pedidos(id) ON DELETE CASCADE,
    "tenant_id" uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    "campo" text NOT NULL,
    "valor_anterior" text,
    "valor_novo" text,
    "alterado_por" uuid REFERENCES auth.users(id),
    "created_at" timestamptz DEFAULT now()
);

-- Tabela: tenant_gmail_config
CREATE TABLE "public"."tenant_gmail_config" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "tenant_id" uuid NOT NULL UNIQUE REFERENCES public.tenants(id) ON DELETE CASCADE,
    "email" text NOT NULL,
    "access_token" text,
    "refresh_token" text,
    "token_expires_at" timestamptz,
    "assunto_filtro" text DEFAULT '[Pedido]',
    "ativo" boolean DEFAULT true,
    "created_at" timestamptz DEFAULT now(),
    "updated_at" timestamptz DEFAULT now()
);

-- Tabela: tenant_erp_config
CREATE TABLE "public"."tenant_erp_config" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "tenant_id" uuid NOT NULL UNIQUE REFERENCES public.tenants(id) ON DELETE CASCADE,
    "tipo" text DEFAULT 'api_rest' CHECK (tipo IN ('api_rest', 'sap', 'totvs', 'outro')),
    "endpoint" text,
    "api_key" text,
    "mapeamento_campos" jsonb DEFAULT '{}'::jsonb,
    "ativo" boolean DEFAULT true,
    "created_at" timestamptz DEFAULT now(),
    "updated_at" timestamptz DEFAULT now()
);

-- Tabela: tenant_uso
CREATE TABLE "public"."tenant_uso" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "tenant_id" uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    "ano_mes" text NOT NULL, -- formato YYYY-MM
    "pedidos_processados" integer DEFAULT 0,
    "erros_ia" integer DEFAULT 0,
    "total_previsto_processado" numeric(12,2) DEFAULT 0,
    "created_at" timestamptz DEFAULT now(),
    "updated_at" timestamptz DEFAULT now(),
    UNIQUE("tenant_id", "ano_mes")
);

-- Tabela: configuracoes (configuracoes do sistema)
CREATE TABLE "public"."configuracoes" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "tenant_id" uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
    "chave" text NOT NULL,
    "valor" text,
    "descricao" text,
    "created_at" timestamptz DEFAULT now(),
    "updated_at" timestamptz DEFAULT now()
);

-- Function para atualizar updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Triggers para updated_at
CREATE TRIGGER update_tenants_updated_at BEFORE UPDATE ON public.tenants
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_pedidos_updated_at BEFORE UPDATE ON public.pedidos
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_tenant_gmail_config_updated_at BEFORE UPDATE ON public.tenant_gmail_config
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_tenant_erp_config_updated_at BEFORE UPDATE ON public.tenant_erp_config
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_tenant_uso_updated_at BEFORE UPDATE ON public.tenant_uso
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_configuracoes_updated_at BEFORE UPDATE ON public.configuracoes
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Enable RLS em todas as tabelas
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_membros ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.super_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.planos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pedidos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pedido_itens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pedido_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_gmail_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_erp_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_uso ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.configuracoes ENABLE ROW LEVEL SECURITY;

-- Function para verificar se user eh admin do tenant
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function para verificar se user pertence ao tenant
CREATE OR REPLACE FUNCTION public.is_tenant_member(p_tenant_id uuid)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.tenant_membros
        WHERE user_id = auth.uid() AND tenant_id = p_tenant_id AND ativo = true
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function para verificar se eh super admin
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.super_admins
        WHERE user_id = auth.uid()
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function para obter tenant_id do usuario logado
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
$$ LANGUAGE plpgsql SECURITY DEFINER;