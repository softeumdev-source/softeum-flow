-- Ativa realtime para pedidos (para atualizações em tempo real no dashboard)
ALTER PUBLICATION supabase_realtime ADD TABLE public.pedidos;
ALTER PUBLICATION supabase_realtime ADD TABLE public.pedido_itens;