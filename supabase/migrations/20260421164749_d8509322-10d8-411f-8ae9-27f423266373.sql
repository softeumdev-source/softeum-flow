-- Cria função para inserir membro do tenant com permissões elevadas
-- Isso permite inserir o user_id mesmo sem a FK validar imediatamente
CREATE OR REPLACE FUNCTION public.add_tenant_member(
  p_user_id uuid,
  p_tenant_id uuid,
  p_papel public.app_role,
  p_nome text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.tenant_membros (user_id, tenant_id, papel, nome, ativo)
  VALUES (p_user_id, p_tenant_id, p_papel, p_nome, true)
  ON CONFLICT (user_id, tenant_id) DO UPDATE SET
    papel = p_papel,
    nome = p_nome,
    ativo = true;
END;
$$;