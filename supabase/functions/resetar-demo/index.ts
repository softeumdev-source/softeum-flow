import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { DEMO_TENANT_ID } from "../_shared/demo-seed.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL_PUB = "https://arihejdirnhmcwuhkzde.supabase.co";

interface ReqBody { confirmar?: boolean }

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

    const body = (await req.json().catch(() => ({}))) as ReqBody;
    if (body.confirmar !== true) return jsonResp(400, { error: "Envie { confirmar: true } para reset destrutivo." });

    const admin = createClient(supaUrl, serviceRole);

    // Apaga só o que é "atividade" — mantém catálogo, DE-PARAs e layout intactos.
    // ON DELETE CASCADE de pedido_id apaga pedido_itens, pedido_logs, pedido_itens_pendentes_de_para.
    const { count: pedidosCount } = await admin
      .from("pedidos")
      .delete({ count: "exact" })
      .eq("tenant_id", DEMO_TENANT_ID);

    const { count: notifCount } = await admin
      .from("notificacoes_painel")
      .delete({ count: "exact" })
      .eq("tenant_id", DEMO_TENANT_ID);

    return jsonResp(200, {
      success: true,
      pedidos_apagados: pedidosCount ?? 0,
      notificacoes_apagadas: notifCount ?? 0,
    });
  } catch (e) {
    console.error("Erro em resetar-demo:", (e as Error).message);
    return jsonResp(500, { error: (e as Error).message });
  }
});

function jsonResp(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
