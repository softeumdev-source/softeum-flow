-- Tabela de_para: mapeamentos de códigos do comprador para o ERP do cliente
CREATE TABLE public.de_para (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  tipo text NOT NULL,
  cnpj_comprador text,
  nome_comprador text,
  valor_origem text NOT NULL,
  valor_destino text NOT NULL,
  descricao text,
  segmento text,
  fator_conversao numeric,
  ativo boolean NOT NULL DEFAULT true,
  criado_em timestamp with time zone NOT NULL DEFAULT now(),
  criado_por uuid,
  atualizado_em timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX idx_de_para_tenant ON public.de_para(tenant_id);
CREATE INDEX idx_de_para_tipo ON public.de_para(tenant_id, tipo);
CREATE INDEX idx_de_para_cnpj ON public.de_para(tenant_id, cnpj_comprador);
CREATE INDEX idx_de_para_busca ON public.de_para(tenant_id, valor_origem, valor_destino);

ALTER TABLE public.de_para ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can view de_para"
  ON public.de_para FOR SELECT TO authenticated
  USING (is_tenant_member(tenant_id));

CREATE POLICY "Tenant admins can manage de_para"
  ON public.de_para FOR ALL TO authenticated
  USING (is_tenant_admin(tenant_id))
  WITH CHECK (is_tenant_admin(tenant_id));

CREATE POLICY "Super admin full access on de_para"
  ON public.de_para FOR ALL TO authenticated
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

CREATE TRIGGER trg_de_para_atualizado
  BEFORE UPDATE ON public.de_para
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Tabela de histórico de importações
CREATE TABLE public.de_para_importacoes (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  quantidade_registros integer NOT NULL DEFAULT 0,
  usuario_id uuid,
  usuario_nome text,
  arquivo_nome text,
  criado_em timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX idx_de_para_imp_tenant ON public.de_para_importacoes(tenant_id, criado_em DESC);

ALTER TABLE public.de_para_importacoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can view de_para_importacoes"
  ON public.de_para_importacoes FOR SELECT TO authenticated
  USING (is_tenant_member(tenant_id));

CREATE POLICY "Tenant admins can manage de_para_importacoes"
  ON public.de_para_importacoes FOR ALL TO authenticated
  USING (is_tenant_admin(tenant_id))
  WITH CHECK (is_tenant_admin(tenant_id));

CREATE POLICY "Super admin full access on de_para_importacoes"
  ON public.de_para_importacoes FOR ALL TO authenticated
  USING (is_super_admin())
  WITH CHECK (is_super_admin());