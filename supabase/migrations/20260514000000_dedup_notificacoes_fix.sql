-- Fix da migration anterior (20260513000000_dedup_notificacoes.sql, agora
-- removida): ela tentava criar índice em notificacoes_enviadas.created_at,
-- mas a tabela legada (criada antes do nosso PR, schema do Lovable) tem
-- enviado_em em vez de created_at. Erro fez rollback completo da migration,
-- e a UNIQUE em pedidos.gmail_message_id (parte A) também não foi aplicada.
--
-- Esta migration aplica só o que faz sentido sem quebrar o schema legado:
--   1. UNIQUE parcial em pedidos.gmail_message_id (parte A — blindagem
--      contra processar-email-pdf criar 2 pedidos pra mesmo gmail message)
--   2. Índice em notificacoes_enviadas usando enviado_em (acelera dedup
--      de 60s feita pelo enviar-notificacao-email)
--   3. RLS + policies em notificacoes_enviadas (legado provavelmente sem)
--
-- NÃO mexe na estrutura de notificacoes_enviadas pra evitar risco em
-- produção. Se quiser padronizar pra (tenant_id + created_at), aí vai
-- migration separada com plano explícito de migração de dados.

-- 1) UNIQUE parcial em pedidos.gmail_message_id
CREATE UNIQUE INDEX IF NOT EXISTS pedidos_gmail_message_id_uidx
    ON public.pedidos(gmail_message_id)
    WHERE gmail_message_id IS NOT NULL;

-- 2) Índice de dedup em notificacoes_enviadas
CREATE INDEX IF NOT EXISTS notificacoes_enviadas_dedup_idx
    ON public.notificacoes_enviadas(pedido_id, status, enviado_em DESC);

-- 3) RLS — idempotente
ALTER TABLE public.notificacoes_enviadas ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    CREATE POLICY "Tenant members view notificacoes_enviadas"
        ON public.notificacoes_enviadas
        FOR SELECT TO authenticated
        USING (
            EXISTS (
                SELECT 1 FROM public.pedidos p
                WHERE p.id = notificacoes_enviadas.pedido_id
                  AND public.is_tenant_member(p.tenant_id)
            )
        );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE POLICY "Super admin full access on notificacoes_enviadas"
        ON public.notificacoes_enviadas
        FOR ALL TO authenticated
        USING (public.is_super_admin())
        WITH CHECK (public.is_super_admin());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
