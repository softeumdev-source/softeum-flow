-- Feature: Modo Demonstração (Super Admin)
--
-- 1. Coluna `is_demo` em tenants
-- 2. Criação idempotente do tenant Demo (UUID fixo já referenciado no AuthContext)
--
-- O seed do catálogo, DE-PARAs e layouts vive na Edge Function inicializar-demo
-- (mais fácil de manter que SQL gigante e evolui sem nova migration).

ALTER TABLE public.tenants
    ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_tenants_is_demo
    ON public.tenants(is_demo)
    WHERE is_demo = true;

INSERT INTO public.tenants (id, nome, slug, ativo, is_demo, nome_fantasia, cnpj)
VALUES (
    '2b0389b5-e9bd-4279-8b2f-794ba132cdf5'::uuid,
    'Indústria Demo',
    'demo',
    true,
    true,
    'Indústria Demo Ltda',
    '00.000.000/0001-00'
)
ON CONFLICT (id) DO UPDATE SET
    is_demo = true,
    nome = COALESCE(public.tenants.nome, EXCLUDED.nome),
    slug = COALESCE(public.tenants.slug, EXCLUDED.slug),
    ativo = true;
