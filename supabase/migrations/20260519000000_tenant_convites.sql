-- Sprint 2: convite de membro por link (PR feat/sprint-2-convite-por-link).
--
-- Substitui o fluxo antigo de "criar usuário com senha provisória mostrada
-- ao admin" por um link de aceite enviado por email. A tabela registra os
-- convites, e o aceite é processado pela edge function aceitar-convite (que
-- cria o usuário no Auth, vincula em tenant_membros e marca o convite como
-- aceito).
--
-- Desenho:
--   - status: 'pendente' | 'aceito' | 'cancelado'. Reenvio invalida o
--     pendente anterior (cancela) e cria novo registro — mantém histórico.
--   - Sem expiração: spec do produto pediu literal. Token só fica inválido
--     via cancel ou aceite.
--   - Constraint funcional: 1 único convite pendente por (tenant, email)
--     pra evitar duplicidade silenciosa.
--   - papel ∈ {'admin','operador'} pra bater com o enum de fato em
--     tenant_membros (o rótulo "Membro" é só na UI).
--   - Token: gerado pela edge (crypto.randomUUID + sufixo, ~72 chars).
--     Coluna é apenas armazenamento.
--
-- RLS:
--   - Admin do tenant (is_tenant_admin) pode tudo nos convites do próprio
--     tenant.
--   - Super admin tem full access (consistente com as outras tabelas após
--     o PR fix/seguranca-pr4-rls-super-admin-policies).
--   - NENHUMA policy SELECT pública por token: a validação na tela de
--     aceite passa pela edge validar-convite (service role). Isso evita
--     que uma URL com token vire endpoint de leitura PostgREST.

CREATE TABLE public.tenant_convites (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    email text NOT NULL,
    papel text NOT NULL CHECK (papel IN ('admin', 'operador')),
    token text NOT NULL UNIQUE,
    status text NOT NULL DEFAULT 'pendente'
        CHECK (status IN ('pendente', 'aceito', 'cancelado')),
    convidado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    accepted_at timestamptz
);

CREATE INDEX idx_tenant_convites_tenant_status
    ON public.tenant_convites(tenant_id, status);

CREATE INDEX idx_tenant_convites_token
    ON public.tenant_convites(token);

CREATE INDEX idx_tenant_convites_email_status
    ON public.tenant_convites(lower(email), status);

-- 1 único pendente por (tenant, email). Reenvio: cancela o anterior antes
-- de criar o novo.
CREATE UNIQUE INDEX uniq_convite_pendente
    ON public.tenant_convites(tenant_id, lower(email))
    WHERE status = 'pendente';

-- Trigger pra manter updated_at em sync.
CREATE OR REPLACE FUNCTION public.tenant_convites_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER tenant_convites_updated_at
    BEFORE UPDATE ON public.tenant_convites
    FOR EACH ROW
    EXECUTE FUNCTION public.tenant_convites_set_updated_at();

ALTER TABLE public.tenant_convites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin do tenant gerencia convites"
    ON public.tenant_convites
    FOR ALL
    TO authenticated
    USING (public.is_tenant_admin(tenant_id))
    WITH CHECK (public.is_tenant_admin(tenant_id));

CREATE POLICY "Super admin full access on tenant_convites"
    ON public.tenant_convites
    FOR ALL
    TO authenticated
    USING (public.is_super_admin())
    WITH CHECK (public.is_super_admin());
