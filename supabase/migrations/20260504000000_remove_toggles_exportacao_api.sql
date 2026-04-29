-- Remove os toggles "Exportação de arquivo" e "Integração via API" que
-- existiam em Configurações mas eram puramente decorativos: nenhuma
-- edge function nem trecho de backend lia essas chaves. Os pedidos
-- aprovados sempre cairam na fila de exportação por arquivo.
--
-- Idempotente.

DELETE FROM public.configuracoes
WHERE chave IN ('exportacao_arquivo_ativo', 'integracao_api_ativo');
