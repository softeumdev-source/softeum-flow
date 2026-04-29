-- Remove a configuração legada notif_destino: nunca teve UI para o cliente
-- alterar, sempre caiu no padrão "remetente". A cadeia de prioridade
-- (PDF → headers → fallbacks) em processar-email-pdf já resolve o
-- destinatário correto antes de chegar em enviar-notificacao-email.

DELETE FROM public.configuracoes
WHERE chave = 'notif_destino';
