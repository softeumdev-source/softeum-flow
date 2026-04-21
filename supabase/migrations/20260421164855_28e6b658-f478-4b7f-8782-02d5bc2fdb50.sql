-- Primeiro vamos verificar se o tenant existe
SELECT id, nome FROM public.tenants WHERE slug = 'empresa-demo';
