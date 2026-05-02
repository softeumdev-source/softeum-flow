-- Sprint 3: permissões do papel "operador" (rótulo UI: "Membro").
--
-- Contexto: o sistema foi escrito assumindo "só admin escreve". Toda RLS
-- write usa is_tenant_admin. A regra de negócio diz que operador também
-- precisa escrever em pedidos, pedido_itens, pedido_logs, de_para,
-- de_para_importacoes, catalogo_produtos, configuracoes e
-- pedido_itens_pendentes_de_para. Resultado: operador toma 403/RLS denial
-- ao tentar aprovar pedido, resolver código novo, editar catálogo, etc.
--
-- Estratégia: ADICIONAR policies is_tenant_member em paralelo (OR) com as
-- existentes is_tenant_admin. Postgres RLS combina policies por OR — basta
-- uma true pra permitir. As policies "Tenant admins can manage X" ficam
-- intactas (admins continuam passando por elas), e as novas
-- "Tenant members can write X" cobrem o operador.
--
-- Tabelas NÃO tocadas (admin-only, conforme regra):
--   - tenant_erp_config (Layout do ERP — admin only)
--   - tenant_gmail_config (Gmail — admin only)
--   - tenant_membros (gestão de equipe — admin only)
--   - tenant_convites (convites — admin only)
--   - tenants (super admin only)
--
-- Idempotente: DROP POLICY IF EXISTS antes de CREATE.

-- ============================================
-- pedidos: UPDATE (aprovar/reprovar/editar campos)
-- ============================================
DROP POLICY IF EXISTS "Tenant members can update pedidos"
    ON public.pedidos;

CREATE POLICY "Tenant members can update pedidos"
    ON public.pedidos
    FOR UPDATE
    TO authenticated
    USING (public.is_tenant_member(tenant_id))
    WITH CHECK (public.is_tenant_member(tenant_id));

-- ============================================
-- pedido_itens: INSERT, UPDATE, DELETE
-- (operador adiciona item ao pedido, edita, remove)
-- ============================================
DROP POLICY IF EXISTS "Tenant members can insert pedido_itens"
    ON public.pedido_itens;

CREATE POLICY "Tenant members can insert pedido_itens"
    ON public.pedido_itens
    FOR INSERT
    TO authenticated
    WITH CHECK (public.is_tenant_member(tenant_id));

DROP POLICY IF EXISTS "Tenant members can update pedido_itens"
    ON public.pedido_itens;

CREATE POLICY "Tenant members can update pedido_itens"
    ON public.pedido_itens
    FOR UPDATE
    TO authenticated
    USING (public.is_tenant_member(tenant_id))
    WITH CHECK (public.is_tenant_member(tenant_id));

DROP POLICY IF EXISTS "Tenant members can delete pedido_itens"
    ON public.pedido_itens;

CREATE POLICY "Tenant members can delete pedido_itens"
    ON public.pedido_itens
    FOR DELETE
    TO authenticated
    USING (public.is_tenant_member(tenant_id));

-- ============================================
-- pedido_logs: INSERT
-- (PedidoDetalhe insere log a cada update do pedido)
-- ============================================
DROP POLICY IF EXISTS "Tenant members can insert pedido_logs"
    ON public.pedido_logs;

CREATE POLICY "Tenant members can insert pedido_logs"
    ON public.pedido_logs
    FOR INSERT
    TO authenticated
    WITH CHECK (public.is_tenant_member(tenant_id));

-- ============================================
-- pedido_itens_pendentes_de_para: UPDATE
-- (resolver hoje passa por edge com service role, mas defesa em camadas)
-- ============================================
DROP POLICY IF EXISTS "Tenant members can update pendentes_de_para"
    ON public.pedido_itens_pendentes_de_para;

CREATE POLICY "Tenant members can update pendentes_de_para"
    ON public.pedido_itens_pendentes_de_para
    FOR UPDATE
    TO authenticated
    USING (public.is_tenant_member(tenant_id))
    WITH CHECK (public.is_tenant_member(tenant_id));

-- ============================================
-- de_para: INSERT, UPDATE, DELETE
-- (criar/editar/excluir mapeamento, importação em massa)
-- ============================================
DROP POLICY IF EXISTS "Tenant members can insert de_para"
    ON public.de_para;

CREATE POLICY "Tenant members can insert de_para"
    ON public.de_para
    FOR INSERT
    TO authenticated
    WITH CHECK (public.is_tenant_member(tenant_id));

DROP POLICY IF EXISTS "Tenant members can update de_para"
    ON public.de_para;

CREATE POLICY "Tenant members can update de_para"
    ON public.de_para
    FOR UPDATE
    TO authenticated
    USING (public.is_tenant_member(tenant_id))
    WITH CHECK (public.is_tenant_member(tenant_id));

DROP POLICY IF EXISTS "Tenant members can delete de_para"
    ON public.de_para;

CREATE POLICY "Tenant members can delete de_para"
    ON public.de_para
    FOR DELETE
    TO authenticated
    USING (public.is_tenant_member(tenant_id));

-- ============================================
-- de_para_importacoes: INSERT
-- (registro de quem importou)
-- ============================================
DROP POLICY IF EXISTS "Tenant members can insert de_para_importacoes"
    ON public.de_para_importacoes;

CREATE POLICY "Tenant members can insert de_para_importacoes"
    ON public.de_para_importacoes
    FOR INSERT
    TO authenticated
    WITH CHECK (public.is_tenant_member(tenant_id));

-- ============================================
-- catalogo_produtos: INSERT, UPDATE, DELETE
-- (criar/editar/excluir/importar produto)
-- ============================================
DROP POLICY IF EXISTS "Tenant members can insert catalogo_produtos"
    ON public.catalogo_produtos;

CREATE POLICY "Tenant members can insert catalogo_produtos"
    ON public.catalogo_produtos
    FOR INSERT
    TO authenticated
    WITH CHECK (public.is_tenant_member(tenant_id));

DROP POLICY IF EXISTS "Tenant members can update catalogo_produtos"
    ON public.catalogo_produtos;

CREATE POLICY "Tenant members can update catalogo_produtos"
    ON public.catalogo_produtos
    FOR UPDATE
    TO authenticated
    USING (public.is_tenant_member(tenant_id))
    WITH CHECK (public.is_tenant_member(tenant_id));

DROP POLICY IF EXISTS "Tenant members can delete catalogo_produtos"
    ON public.catalogo_produtos;

CREATE POLICY "Tenant members can delete catalogo_produtos"
    ON public.catalogo_produtos
    FOR DELETE
    TO authenticated
    USING (public.is_tenant_member(tenant_id));

-- ============================================
-- configuracoes: INSERT, UPDATE, DELETE
-- (toggles de notificação, aprovação automática, dedup, comportamento
--  DE-PARA. Gmail config segue admin-only em tenant_gmail_config.)
-- ============================================
DROP POLICY IF EXISTS "Tenant members can insert configuracoes"
    ON public.configuracoes;

CREATE POLICY "Tenant members can insert configuracoes"
    ON public.configuracoes
    FOR INSERT
    TO authenticated
    WITH CHECK (public.is_tenant_member(tenant_id));

DROP POLICY IF EXISTS "Tenant members can update configuracoes"
    ON public.configuracoes;

CREATE POLICY "Tenant members can update configuracoes"
    ON public.configuracoes
    FOR UPDATE
    TO authenticated
    USING (public.is_tenant_member(tenant_id))
    WITH CHECK (public.is_tenant_member(tenant_id));

DROP POLICY IF EXISTS "Tenant members can delete configuracoes"
    ON public.configuracoes;

CREATE POLICY "Tenant members can delete configuracoes"
    ON public.configuracoes
    FOR DELETE
    TO authenticated
    USING (public.is_tenant_member(tenant_id));
