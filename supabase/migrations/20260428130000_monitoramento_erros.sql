-- Feature: monitoramento de erros do sistema
--
-- 1. Tabela system_errors (com agrupamento por hash)
-- 2. Tabela configuracoes_globais (chave/valor para super admin)
-- 3. notificacoes_painel: tenant_id NULLABLE + policies para super admin
-- 4. Cron job horário para enviar-resumo-erros

-- ============================================
-- 1. system_errors
-- ============================================
CREATE TABLE public.system_errors (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tipo text NOT NULL,
    origem text NOT NULL,
    mensagem text NOT NULL,
    detalhes jsonb,
    tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
    severidade text NOT NULL DEFAULT 'media'
        CHECK (severidade IN ('baixa', 'media', 'alta', 'critica')),
    hash_agrupamento text NOT NULL,
    count integer NOT NULL DEFAULT 1,
    primeiro_em timestamptz NOT NULL DEFAULT now(),
    ultimo_em timestamptz NOT NULL DEFAULT now(),
    alertado_em timestamptz,
    resolvido boolean NOT NULL DEFAULT false,
    resolvido_em timestamptz
);

CREATE INDEX idx_system_errors_hash
    ON public.system_errors(hash_agrupamento);

CREATE INDEX idx_system_errors_resolvido_ultimo
    ON public.system_errors(resolvido, ultimo_em DESC);

CREATE INDEX idx_system_errors_severidade
    ON public.system_errors(severidade);

-- Garante 1 único registro NÃO resolvido por hash:
-- permite que registrar-erro use INSERT ... ON CONFLICT pra incrementar.
CREATE UNIQUE INDEX system_errors_hash_aberto_uidx
    ON public.system_errors(hash_agrupamento)
    WHERE resolvido = false;

ALTER TABLE public.system_errors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super admin full access on system_errors"
    ON public.system_errors
    FOR ALL
    TO authenticated
    USING (public.is_super_admin())
    WITH CHECK (public.is_super_admin());

-- ============================================
-- 2. configuracoes_globais
-- ============================================
CREATE TABLE public.configuracoes_globais (
    chave text PRIMARY KEY,
    valor text,
    descricao text,
    updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.configuracoes_globais ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super admin full access on configuracoes_globais"
    ON public.configuracoes_globais
    FOR ALL
    TO authenticated
    USING (public.is_super_admin())
    WITH CHECK (public.is_super_admin());

CREATE TRIGGER update_configuracoes_globais_updated_at
    BEFORE UPDATE ON public.configuracoes_globais
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================
-- 3. notificacoes_painel: aceitar notificações do sistema (tenant_id NULL)
-- ============================================
ALTER TABLE public.notificacoes_painel
    ALTER COLUMN tenant_id DROP NOT NULL;

CREATE POLICY "Super admin can view system notificacoes"
    ON public.notificacoes_painel
    FOR SELECT
    TO authenticated
    USING (tenant_id IS NULL AND public.is_super_admin());

CREATE POLICY "Super admin can update system notificacoes"
    ON public.notificacoes_painel
    FOR UPDATE
    TO authenticated
    USING (tenant_id IS NULL AND public.is_super_admin())
    WITH CHECK (tenant_id IS NULL AND public.is_super_admin());

-- ============================================
-- 4. Cron job: enviar-resumo-erros a cada hora (minuto 0)
--
-- PRÉ-REQUISITO MANUAL (uma vez, via Supabase SQL Editor):
--   SELECT vault.create_secret('<SERVICE_ROLE_KEY>', 'service_role_key');
--
-- Sem o secret no Vault, o cron job dispara mas a chamada HTTP falha
-- (Authorization sem token). Não quebra nada além do alerta horário.
-- ============================================
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.unschedule('enviar-resumo-erros')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'enviar-resumo-erros');

SELECT cron.schedule(
    'enviar-resumo-erros',
    '0 * * * *',
    $$
    SELECT net.http_post(
        url := 'https://arihejdirnhmcwuhkzde.supabase.co/functions/v1/enviar-resumo-erros',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || COALESCE(
                (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1),
                ''
            )
        ),
        body := '{}'::jsonb
    );
    $$
);
