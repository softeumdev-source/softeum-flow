-- Adiciona colunas de cadastro completo na tabela tenants
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS nome_fantasia text,
  ADD COLUMN IF NOT EXISTS cnpj text,
  ADD COLUMN IF NOT EXISTS inscricao_estadual text,
  ADD COLUMN IF NOT EXISTS inscricao_municipal text,
  ADD COLUMN IF NOT EXISTS cep text,
  ADD COLUMN IF NOT EXISTS endereco text,
  ADD COLUMN IF NOT EXISTS numero_endereco text,
  ADD COLUMN IF NOT EXISTS complemento text,
  ADD COLUMN IF NOT EXISTS bairro text,
  ADD COLUMN IF NOT EXISTS cidade text,
  ADD COLUMN IF NOT EXISTS estado text,
  ADD COLUMN IF NOT EXISTS responsavel_financeiro text,
  ADD COLUMN IF NOT EXISTS email_financeiro text,
  ADD COLUMN IF NOT EXISTS telefone text,
  ADD COLUMN IF NOT EXISTS valor_mensal numeric,
  ADD COLUMN IF NOT EXISTS valor_setup numeric,
  ADD COLUMN IF NOT EXISTS data_inicio_contrato date,
  ADD COLUMN IF NOT EXISTS data_inicio_pagamento date,
  ADD COLUMN IF NOT EXISTS dia_vencimento integer,
  ADD COLUMN IF NOT EXISTS forma_pagamento text,
  ADD COLUMN IF NOT EXISTS data_vencimento_contrato date,
  ADD COLUMN IF NOT EXISTS gestor_contrato text,
  ADD COLUMN IF NOT EXISTS executivo_venda text,
  ADD COLUMN IF NOT EXISTS tipo_integracao text,
  ADD COLUMN IF NOT EXISTS valor_excedente numeric,
  ADD COLUMN IF NOT EXISTS comentarios text;

-- Função para criar tenant + admin em uma única transação (server-side, evita problemas de RLS/Auth no client)
CREATE OR REPLACE FUNCTION public.criar_tenant_completo(
  p_dados jsonb,
  p_admin_user_id uuid,
  p_admin_nome text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Acesso negado: apenas super admins podem criar tenants';
  END IF;

  INSERT INTO public.tenants (
    nome, slug, nome_fantasia, cnpj, inscricao_estadual, inscricao_municipal,
    cep, endereco, numero_endereco, complemento, bairro, cidade, estado,
    responsavel_financeiro, email_financeiro, telefone,
    plano_id, valor_mensal, valor_setup, data_inicio_contrato, data_inicio_pagamento,
    dia_vencimento, forma_pagamento, data_vencimento_contrato, gestor_contrato,
    executivo_venda, tipo_integracao,
    limite_pedidos_mes, limite_usuarios, valor_excedente, comentarios, ativo
  ) VALUES (
    p_dados->>'nome',
    p_dados->>'slug',
    p_dados->>'nome_fantasia',
    p_dados->>'cnpj',
    p_dados->>'inscricao_estadual',
    p_dados->>'inscricao_municipal',
    p_dados->>'cep',
    p_dados->>'endereco',
    p_dados->>'numero_endereco',
    p_dados->>'complemento',
    p_dados->>'bairro',
    p_dados->>'cidade',
    p_dados->>'estado',
    p_dados->>'responsavel_financeiro',
    p_dados->>'email_financeiro',
    p_dados->>'telefone',
    NULLIF(p_dados->>'plano_id','')::uuid,
    NULLIF(p_dados->>'valor_mensal','')::numeric,
    NULLIF(p_dados->>'valor_setup','')::numeric,
    NULLIF(p_dados->>'data_inicio_contrato','')::date,
    NULLIF(p_dados->>'data_inicio_pagamento','')::date,
    NULLIF(p_dados->>'dia_vencimento','')::integer,
    p_dados->>'forma_pagamento',
    NULLIF(p_dados->>'data_vencimento_contrato','')::date,
    p_dados->>'gestor_contrato',
    p_dados->>'executivo_venda',
    p_dados->>'tipo_integracao',
    COALESCE(NULLIF(p_dados->>'limite_pedidos_mes','')::integer, 100),
    COALESCE(NULLIF(p_dados->>'limite_usuarios','')::integer, 5),
    NULLIF(p_dados->>'valor_excedente','')::numeric,
    p_dados->>'comentarios',
    true
  )
  RETURNING id INTO v_tenant_id;

  IF p_admin_user_id IS NOT NULL THEN
    INSERT INTO public.tenant_membros (user_id, tenant_id, papel, nome, ativo)
    VALUES (p_admin_user_id, v_tenant_id, 'admin'::app_role, p_admin_nome, true)
    ON CONFLICT (user_id, tenant_id) DO UPDATE SET
      papel = 'admin'::app_role, nome = p_admin_nome, ativo = true;
  END IF;

  RETURN v_tenant_id;
END;
$$;