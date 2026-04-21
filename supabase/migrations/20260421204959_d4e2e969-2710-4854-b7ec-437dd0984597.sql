ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS bloqueado_em timestamp with time zone,
  ADD COLUMN IF NOT EXISTS motivo_bloqueio text;