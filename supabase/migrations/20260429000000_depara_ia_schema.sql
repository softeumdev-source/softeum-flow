-- Feature: DE-PARA inteligente com sugestão da IA (PR 1 — schema)
--
-- 1. catalogo_produtos: catálogo do tenant com codigo_erp, descrição, EAN etc.
-- 2. pedido_itens_pendentes_de_para: itens de pedido sem DE-PARA aguardando
--    confirmação humana, junto com sugestões geradas pela IA.
-- 3. Documentação do novo `configuracoes.comportamento_codigo_novo` (chave/valor,
--    sem DDL). Default no app: 'aprovar_parcial'.
-- 4. Libera novos valores de status em pedidos: 'aguardando_de_para',
--    'aprovado_parcial'. A constraint CHECK original já está dessincronizada
--    do código (existem inserts com 'duplicado', 'reprovado' etc.); este
--    PR apenas remove qualquer CHECK residual sobre `pedidos.status` para
--    cobrir bancos onde ela ainda exista, sem reintroduzir uma nova.

-- ============================================
-- 1. catalogo_produtos
-- ============================================
CREATE TABLE public.catalogo_produtos (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    codigo_erp text NOT NULL,
    descricao text NOT NULL,
    ean text,
    categoria text,
    fator_conversao numeric NOT NULL DEFAULT 1,
    ativo boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, codigo_erp)
);

CREATE INDEX idx_catalogo_produtos_tenant
    ON public.catalogo_produtos(tenant_id);

CREATE INDEX idx_catalogo_produtos_ean
    ON public.catalogo_produtos(tenant_id, ean)
    WHERE ean IS NOT NULL;

CREATE INDEX idx_catalogo_produtos_descricao_lower
    ON public.catalogo_produtos(tenant_id, lower(descricao));

CREATE INDEX idx_catalogo_produtos_categoria
    ON public.catalogo_produtos(tenant_id, categoria)
    WHERE categoria IS NOT NULL;

ALTER TABLE public.catalogo_produtos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can view catalogo_produtos"
    ON public.catalogo_produtos
    FOR SELECT TO authenticated
    USING (public.is_tenant_member(tenant_id));

CREATE POLICY "Tenant admins can manage catalogo_produtos"
    ON public.catalogo_produtos
    FOR ALL TO authenticated
    USING (public.is_tenant_admin(tenant_id))
    WITH CHECK (public.is_tenant_admin(tenant_id));

CREATE POLICY "Super admin full access on catalogo_produtos"
    ON public.catalogo_produtos
    FOR ALL TO authenticated
    USING (public.is_super_admin())
    WITH CHECK (public.is_super_admin());

CREATE TRIGGER trg_catalogo_produtos_updated_at
    BEFORE UPDATE ON public.catalogo_produtos
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================
-- 2. pedido_itens_pendentes_de_para
-- ============================================
CREATE TABLE public.pedido_itens_pendentes_de_para (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pedido_id uuid NOT NULL REFERENCES public.pedidos(id) ON DELETE CASCADE,
    pedido_item_id uuid NOT NULL REFERENCES public.pedido_itens(id) ON DELETE CASCADE,
    tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    codigo_cliente text,
    descricao_pedido text,
    sugestoes_ia jsonb NOT NULL DEFAULT '[]'::jsonb,
    resolvido boolean NOT NULL DEFAULT false,
    codigo_escolhido text,
    resolvido_em timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_pendentes_de_para_tenant_resolvido
    ON public.pedido_itens_pendentes_de_para(tenant_id, resolvido, created_at DESC);

CREATE INDEX idx_pendentes_de_para_pedido
    ON public.pedido_itens_pendentes_de_para(pedido_id);

-- 1 pendência por item de pedido (caso o processamento rode duas vezes,
-- não duplica a entrada)
CREATE UNIQUE INDEX pendentes_de_para_item_uidx
    ON public.pedido_itens_pendentes_de_para(pedido_item_id);

ALTER TABLE public.pedido_itens_pendentes_de_para ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can view pendentes_de_para"
    ON public.pedido_itens_pendentes_de_para
    FOR SELECT TO authenticated
    USING (public.is_tenant_member(tenant_id));

CREATE POLICY "Tenant admins can manage pendentes_de_para"
    ON public.pedido_itens_pendentes_de_para
    FOR ALL TO authenticated
    USING (public.is_tenant_admin(tenant_id))
    WITH CHECK (public.is_tenant_admin(tenant_id));

CREATE POLICY "Super admin full access on pendentes_de_para"
    ON public.pedido_itens_pendentes_de_para
    FOR ALL TO authenticated
    USING (public.is_super_admin())
    WITH CHECK (public.is_super_admin());

-- ============================================
-- 3. pedidos.status: garante que aceita os novos valores
-- ============================================
ALTER TABLE public.pedidos
    DROP CONSTRAINT IF EXISTS pedidos_status_check;
