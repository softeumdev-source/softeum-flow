-- Adiciona cron para polling dos batches Anthropic a cada 5 minutos
SELECT cron.schedule(
  'coletar-resultados-batch',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://arihejdirnhmcwuhkzde.supabase.co/functions/v1/coletar-resultados-batch',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFyaWhlamRpcm5obWN3dWhremRlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjczOTkzMCwiZXhwIjoyMDkyMzE1OTMwfQ.TRzfUuzeUPzohpvCnj_TPW0t07QfJYIvpwwE-SJ88os"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
