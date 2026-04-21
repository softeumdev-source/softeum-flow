-- Adiciona coluna `numero` com sequência por tenant e formato PED-000001
CREATE SEQUENCE IF NOT EXISTS public.pedidos_numero_seq START 1;

ALTER TABLE public.pedidos
  ADD COLUMN IF NOT EXISTS numero text;

-- Função que gera o próximo número formatado
CREATE OR REPLACE FUNCTION public.set_pedido_numero()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.numero IS NULL OR NEW.numero = '' THEN
    NEW.numero := 'PED-' || LPAD(nextval('public.pedidos_numero_seq')::text, 6, '0');
  END IF;
  RETURN NEW;
END;
$$;

-- Trigger para popular `numero` automaticamente em inserts
DROP TRIGGER IF EXISTS trg_set_pedido_numero ON public.pedidos;
CREATE TRIGGER trg_set_pedido_numero
  BEFORE INSERT ON public.pedidos
  FOR EACH ROW
  EXECUTE FUNCTION public.set_pedido_numero();

-- Backfill: gera número para pedidos existentes que ainda não têm
UPDATE public.pedidos
SET numero = 'PED-' || LPAD(nextval('public.pedidos_numero_seq')::text, 6, '0')
WHERE numero IS NULL OR numero = '';

-- Garante unicidade e NOT NULL
ALTER TABLE public.pedidos
  ALTER COLUMN numero SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_pedidos_numero ON public.pedidos(numero);
CREATE INDEX IF NOT EXISTS idx_pedidos_tenant_created ON public.pedidos(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pedido_itens_pedido ON public.pedido_itens(pedido_id);
CREATE INDEX IF NOT EXISTS idx_pedido_logs_pedido ON public.pedido_logs(pedido_id, created_at DESC);

-- Trigger para updated_at em pedidos (caso ainda não exista)
DROP TRIGGER IF EXISTS trg_pedidos_updated_at ON public.pedidos;
CREATE TRIGGER trg_pedidos_updated_at
  BEFORE UPDATE ON public.pedidos
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
