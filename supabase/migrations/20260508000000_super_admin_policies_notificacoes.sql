-- Hotfix: super admin não conseguia ver notificações de tenants
-- específicos no sino do header (nem marcar como lida).
--
-- Sintoma: super admin entra no tenant demo via fallback do
-- AuthContext (sem ser tenant_membros). Dashboard mostra os cards
-- corretos (porque pedidos tem policy de super admin desde o hotfix
-- de 30/04), mas o sino fica vazio.
--
-- Causa: as policies em notificacoes_painel cobrem só
--   (a) is_tenant_member(tenant_id) — falsa pra super admin sem vínculo
--   (b) tenant_id IS NULL AND is_super_admin() — só pega notif de
--       sistema, não de tenant.
-- Faltava a policy "super admin full access" no padrão das outras
-- tabelas (de_para, catalogo_produtos etc.).
--
-- Idempotente via DROP IF EXISTS antes do CREATE.

DROP POLICY IF EXISTS "Super admin full access on notificacoes_painel"
    ON public.notificacoes_painel;

CREATE POLICY "Super admin full access on notificacoes_painel"
    ON public.notificacoes_painel
    FOR ALL
    TO authenticated
    USING (public.is_super_admin())
    WITH CHECK (public.is_super_admin());
