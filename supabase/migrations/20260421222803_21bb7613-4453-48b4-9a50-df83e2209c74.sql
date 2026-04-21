-- 1) Tabela de documentos
CREATE TABLE public.tenant_documentos (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  nome_arquivo text NOT NULL,
  storage_path text NOT NULL,
  tipo text,
  tamanho bigint,
  criado_por uuid,
  criado_em timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX idx_tenant_documentos_tenant ON public.tenant_documentos(tenant_id);

ALTER TABLE public.tenant_documentos ENABLE ROW LEVEL SECURITY;

-- Super admin: acesso total
CREATE POLICY "Super admin full access on tenant_documentos"
ON public.tenant_documentos
FOR ALL
TO authenticated
USING (public.is_super_admin())
WITH CHECK (public.is_super_admin());

-- Admin do tenant: pode gerenciar (insert/update/delete/select)
CREATE POLICY "Tenant admins can manage tenant_documentos"
ON public.tenant_documentos
FOR ALL
TO authenticated
USING (public.is_tenant_admin(tenant_id))
WITH CHECK (public.is_tenant_admin(tenant_id));

-- Membros do tenant: somente leitura
CREATE POLICY "Tenant members can view tenant_documentos"
ON public.tenant_documentos
FOR SELECT
TO authenticated
USING (public.is_tenant_member(tenant_id));

-- 2) Bucket de storage (privado)
INSERT INTO storage.buckets (id, name, public)
VALUES ('documentos-clientes', 'documentos-clientes', false)
ON CONFLICT (id) DO NOTHING;

-- 3) Policies de storage no bucket. Caminho organizado como: <tenant_id>/<arquivo>
-- Super admin: acesso total
CREATE POLICY "Super admin full access on documentos-clientes"
ON storage.objects
FOR ALL
TO authenticated
USING (bucket_id = 'documentos-clientes' AND public.is_super_admin())
WITH CHECK (bucket_id = 'documentos-clientes' AND public.is_super_admin());

-- Tenant admins: gerenciam arquivos do próprio tenant (pasta = tenant_id)
CREATE POLICY "Tenant admins manage documentos-clientes"
ON storage.objects
FOR ALL
TO authenticated
USING (
  bucket_id = 'documentos-clientes'
  AND public.is_tenant_admin(((storage.foldername(name))[1])::uuid)
)
WITH CHECK (
  bucket_id = 'documentos-clientes'
  AND public.is_tenant_admin(((storage.foldername(name))[1])::uuid)
);

-- Tenant members: podem ler/baixar arquivos do próprio tenant
CREATE POLICY "Tenant members can read documentos-clientes"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'documentos-clientes'
  AND public.is_tenant_member(((storage.foldername(name))[1])::uuid)
);