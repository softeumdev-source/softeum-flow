-- Remove duplicatas existentes (mantém o registro mais recente por tenant_id+chave)
DELETE FROM public.configuracoes a
USING public.configuracoes b
WHERE a.id < b.id
  AND a.tenant_id IS NOT DISTINCT FROM b.tenant_id
  AND a.chave = b.chave;

-- Adiciona constraint única necessária para UPSERT (onConflict: tenant_id,chave)
ALTER TABLE public.configuracoes
  ADD CONSTRAINT configuracoes_tenant_chave_unique UNIQUE (tenant_id, chave);