-- Renomeia coluna fornecedor para empresa na tabela pedidos
ALTER TABLE public.pedidos RENAME COLUMN fornecedor TO empresa;