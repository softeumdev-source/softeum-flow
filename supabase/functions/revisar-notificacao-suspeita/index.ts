import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL_PUB = "https://arihejdirnhmcwuhkzde.supabase.co";

interface ReqBody {
  pedido_id: string;
  acao: "confirmar" | "trocar" | "ignorar";
  destinatario_override?: string;
}

const STATUS_TO_NOTIF: Record<string, string | null> = {
  pendente: "pendente",
  aprovado: "aprovado",
  reprovado: "reprovado",
  duplicado: "duplicado",
  // Estados sem notificação automática (super admin marca revisada
  // sem enviar e-mail no momento — futuros disparos pegam fluxo normal):
  aprovado_parcial: null,
  aguardando_de_para: null,
  ignorado: null,
  erro: null,
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supaUrl = Deno.env.get("SUPABASE_URL") ?? SUPABASE_URL_PUB;
    const serviceRole = Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anon = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY");
    if (!serviceRole || !anon) return jsonResp(500, { error: "Secrets do Supabase não configurados" });

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return jsonResp(401, { error: "Não autenticado" });

    const userClient = createClient(supaUrl, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: userRes } = await userClient.auth.getUser();
    if (!userRes?.user) return jsonResp(401, { error: "Sessão inválida" });
    const { data: isSuper } = await userClient.rpc("is_super_admin");
    if (!isSuper) return jsonResp(403, { error: "Apenas super admins" });

    const body = (await req.json()) as ReqBody;
    const pedidoId = String(body.pedido_id ?? "").trim();
    const acao = body.acao;
    if (!pedidoId || !["confirmar", "trocar", "ignorar"].includes(acao)) {
      return jsonResp(400, { error: "pedido_id e acao (confirmar|trocar|ignorar) são obrigatórios" });
    }

    const admin = createClient(supaUrl, serviceRole);

    const { data: pedido, error: pedidoErr } = await admin
      .from("pedidos")
      .select("id, status, tenant_id, remetente_email, email_comprador, notif_suspeita_destinatario, notif_revisada")
      .eq("id", pedidoId)
      .maybeSingle();
    if (pedidoErr) throw pedidoErr;
    if (!pedido) return jsonResp(404, { error: "Pedido não encontrado" });
    if (!(pedido as any).notif_suspeita_destinatario) {
      return jsonResp(400, { error: "Pedido não está marcado como suspeito" });
    }
    if ((pedido as any).notif_revisada) {
      return jsonResp(400, { error: "Pedido já foi revisado" });
    }

    let destinatarioOverride: string | undefined;
    if (acao === "trocar") {
      const novo = String(body.destinatario_override ?? "").trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(novo)) {
        return jsonResp(400, { error: "destinatario_override inválido" });
      }
      destinatarioOverride = novo;
      // Persiste o e-mail novo no pedido — futuros disparos usam ele direto.
      const { error: updErr } = await admin
        .from("pedidos")
        .update({ remetente_email: novo, email_remetente: novo })
        .eq("id", pedidoId);
      if (updErr) throw updErr;
    }

    // Envia o e-mail correspondente ao status atual do pedido (se houver).
    let emailEnviado = false;
    let skipReason: string | undefined;
    if (acao !== "ignorar") {
      const statusAtual = (pedido as any).status as string;
      const notifStatus = STATUS_TO_NOTIF[statusAtual];
      if (notifStatus) {
        const r = await fetch(`${supaUrl}/functions/v1/enviar-notificacao-email`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceRole}` },
          body: JSON.stringify({
            pedido_id: pedidoId,
            status: notifStatus,
            bypass_suspeita: true,
            destinatario_override: destinatarioOverride,
          }),
        });
        emailEnviado = r.ok;
        if (!r.ok) {
          const txt = await r.text();
          console.error("Falha ao enviar notificação:", txt);
          skipReason = `enviar-notificacao-email retornou ${r.status}`;
        }
      } else {
        skipReason = `status '${statusAtual}' não dispara notificação automática`;
      }
    }

    // Marca como revisada — futuros disparos passam direto pelo bloqueio.
    const { error: revErr } = await admin
      .from("pedidos")
      .update({ notif_revisada: true })
      .eq("id", pedidoId);
    if (revErr) throw revErr;

    return jsonResp(200, {
      success: true,
      acao,
      email_enviado: emailEnviado,
      skip_reason: skipReason ?? null,
    });
  } catch (e) {
    console.error("Erro em revisar-notificacao-suspeita:", (e as Error).message);
    return jsonResp(500, { error: (e as Error).message });
  }
});

function jsonResp(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
