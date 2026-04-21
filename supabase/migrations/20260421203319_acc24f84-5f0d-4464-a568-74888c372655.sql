-- 1) Adicionar plano_id em tenants
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS plano_id uuid REFERENCES public.planos(id);

-- 2) Garantir unicidade de configurações por tenant + chave (necessário para upsert)
CREATE UNIQUE INDEX IF NOT EXISTS configuracoes_tenant_chave_uidx
  ON public.configuracoes(tenant_id, chave);

-- 3) Garantir unicidade de tenant_uso por tenant + ano_mes (necessário para upsert/cron)
CREATE UNIQUE INDEX IF NOT EXISTS tenant_uso_tenant_ano_mes_uidx
  ON public.tenant_uso(tenant_id, ano_mes);

-- 4) Função que cria registros zerados em tenant_uso para o mês atual
CREATE OR REPLACE FUNCTION public.criar_uso_mes_atual()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ano_mes text := to_char(now(), 'YYYY-MM');
BEGIN
  INSERT INTO public.tenant_uso (tenant_id, ano_mes, pedidos_processados, total_previsto_processado, erros_ia)
  SELECT t.id, v_ano_mes, 0, 0, 0
  FROM public.tenants t
  WHERE t.ativo = true
  ON CONFLICT (tenant_id, ano_mes) DO NOTHING;
END;
$$;

-- 5) Habilitar pg_cron e pg_net
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 6) Agendar para todo dia 1 às 00:05
SELECT cron.unschedule('criar-uso-mes-atual') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'criar-uso-mes-atual'
);

SELECT cron.schedule(
  'criar-uso-mes-atual',
  '5 0 1 * *',
  $$ SELECT public.criar_uso_mes_atual(); $$
);