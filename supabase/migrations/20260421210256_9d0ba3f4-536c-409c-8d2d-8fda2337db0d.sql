ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS limite_usuarios integer DEFAULT 5;

ALTER TABLE public.tenant_membros
  ADD COLUMN IF NOT EXISTS session_token text,
  ADD COLUMN IF NOT EXISTS ultimo_acesso timestamp with time zone;