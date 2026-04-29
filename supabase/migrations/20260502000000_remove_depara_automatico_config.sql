-- Remove a configuração legada `depara_automatico_ativo`.
--
-- A feature "DE-PARA automático por IA" foi substituída pelo fluxo do
-- DE-PARA inteligente (catalogo_produtos + sugerir-de-para-ia + modal
-- de confirmação). A chave não é mais lida pelo código.
--
-- Idempotente: rodar 2x simplesmente não acha nada na 2ª.

DELETE FROM public.configuracoes
WHERE chave = 'depara_automatico_ativo';
