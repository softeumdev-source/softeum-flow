
ALTER TABLE public.pedidos
  ADD COLUMN IF NOT EXISTS exportado boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS exportado_em timestamptz,
  ADD COLUMN IF NOT EXISTS exportacao_metodo text,
  ADD COLUMN IF NOT EXISTS exportacao_tentativas integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS exportacao_erro text;

ALTER TABLE public.tenant_erp_config
  ADD COLUMN IF NOT EXISTS layout_arquivo text,
  ADD COLUMN IF NOT EXISTS layout_filename text,
  ADD COLUMN IF NOT EXISTS layout_mime text,
  ADD COLUMN IF NOT EXISTS tipo_erp text;
