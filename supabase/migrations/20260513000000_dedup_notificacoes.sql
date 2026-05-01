-- Blindagem dupla contra notificações duplicadas:
--
-- A) UNIQUE em pedidos.gmail_message_id (parcial, só onde não-NULL):
--    impede que duas invocações simultâneas de processar-email-pdf
--    criem dois pedidos para o mesmo e-mail do Gmail. Pedidos demo /
--    manuais ficam com gmail_message_id NULL e são ignorados pelo
--    índice parcial.
--
-- B) Tabela notificacoes_enviadas: registra cada envio bem-sucedido
--    de e-mail (pedido_id, status, created_at). enviar-notificacao-
--    email checa se já houve envio do mesmo (pedido, status) na
--    janela recente (últimos 60s); se houve, pula. Cada transição
--    REAL de status fica liberada — aprovou→reprovou→aprovou gera
--    3 e-mails (3 inserts em created_at distintos), só duplicações
--    em janela curta são bloqueadas.
--
-- Idempotente.

-- A) UNIQUE parcial em pedidos.gmail_message_id
CREATE UNIQUE INDEX IF NOT EXISTS pedidos_gmail_message_id_uidx
    ON public.pedidos(gmail_message_id)
    WHERE gmail_message_id IS NOT NULL;

-- B) notificacoes_enviadas
CREATE TABLE IF NOT EXISTS public.notificacoes_enviadas (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pedido_id uuid NOT NULL REFERENCES public.pedidos(id) ON DELETE CASCADE,
    tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
    status text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notificacoes_enviadas_dedup_idx
    ON public.notificacoes_enviadas(pedido_id, status, created_at DESC);

ALTER TABLE public.notificacoes_enviadas ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    CREATE POLICY "Tenant members view notificacoes_enviadas"
        ON public.notificacoes_enviadas
        FOR SELECT TO authenticated
        USING (tenant_id IS NULL OR public.is_tenant_member(tenant_id));
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
