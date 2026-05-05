-- Adiciona cron para polling dos batches Anthropic a cada 5 minutos
SELECT cron.schedule(
  'coletar-resultados-batch',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.supabase_url') || '/functions/v1/coletar-resultados-batch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body := '{}',
    timeout_milliseconds := 120000
  );
  $$
);
