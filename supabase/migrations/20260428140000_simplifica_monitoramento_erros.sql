-- Simplifica monitoramento de erros: alerta passa a ser apenas via sino do
-- Super Admin. Removemos o cron horário que disparava enviar-resumo-erros.
--
-- O secret 'service_role_key' no vault e a configuração 'email_alertas_admin'
-- em configuracoes_globais ficam órfãos, mas não atrapalham. Não tocamos neles.

SELECT cron.unschedule('enviar-resumo-erros')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'enviar-resumo-erros');
