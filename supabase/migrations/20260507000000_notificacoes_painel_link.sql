-- Notificações do sino agora podem carregar um link de navegação direta
-- (clique → tela relevante). Coluna nullable; notificações antigas
-- continuam funcionando sem link (sino mostra texto, não navega).

ALTER TABLE public.notificacoes_painel
    ADD COLUMN IF NOT EXISTS link text;
