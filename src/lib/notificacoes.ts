import { supabase } from "@/integrations/supabase/client";

const STATUS_NOTIFICAVEIS = new Set(["pendente", "aprovado", "reprovado", "duplicado"]);

/**
 * Dispara notificação por e-mail correspondente ao status novo do pedido.
 * Chama a edge function enviar-notificacao-email; o respeito aos toggles
 * (notif_email_ativo + notif_aprovacao/notif_reprovacao/etc) fica do
 * lado do backend. Falha silenciosa por design — falha de envio não
 * deve bloquear a UI.
 */
export async function disparaNotificacaoStatus(
  pedidoId: string,
  status: string,
): Promise<void> {
  if (!STATUS_NOTIFICAVEIS.has(status)) return;
  try {
    const sb = supabase as any;
    await sb.functions.invoke("enviar-notificacao-email", {
      body: { pedido_id: pedidoId, status },
    });
  } catch (err) {
    console.warn("[notificacoes] falha ao disparar status=", status, err);
  }
}
