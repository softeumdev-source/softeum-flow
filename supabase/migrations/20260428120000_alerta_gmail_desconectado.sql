-- Feature: alerta de Gmail desconectado
--
-- 1. Coluna anti-spam em tenant_gmail_config
-- 2. Tabela notificacoes_painel + RLS

-- ============================================
-- 1. Coluna anti-spam
-- ============================================
ALTER TABLE public.tenant_gmail_config
    ADD COLUMN IF NOT EXISTS alerta_desconexao_enviado boolean NOT NULL DEFAULT false;

-- ============================================
-- 2. Tabela de notificações do painel
-- ============================================
CREATE TABLE public.notificacoes_painel (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    tipo text NOT NULL,
    titulo text NOT NULL,
    mensagem text NOT NULL,
    lida boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    lida_em timestamptz
);

CREATE INDEX idx_notificacoes_painel_tenant_lida
    ON public.notificacoes_painel(tenant_id, lida, created_at DESC);

-- ============================================
-- RLS: membros do tenant leem; podem marcar como lida.
-- INSERT só via service role (Edge Functions).
-- ============================================
ALTER TABLE public.notificacoes_painel ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can view their notificacoes"
    ON public.notificacoes_painel
    FOR SELECT
    TO authenticated
    USING (public.is_tenant_member(tenant_id));

CREATE POLICY "Tenant members can update their notificacoes"
    ON public.notificacoes_painel
    FOR UPDATE
    TO authenticated
    USING (public.is_tenant_member(tenant_id))
    WITH CHECK (public.is_tenant_member(tenant_id));
