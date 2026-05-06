import { SUPABASE_URL, getServiceRole } from "../_shared/supabase-client.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { tenant_id } = await req.json();
    if (!tenant_id) {
      return new Response(JSON.stringify({ error: "tenant_id é obrigatório" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const serviceRole = getServiceRole();
    if (!serviceRole) {
      console.error("SUPABASE_SERVICE_ROLE_KEY não configurada");
      return new Response(JSON.stringify({ error: "Service role não configurada" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const tenantRes = await fetch(
      `${SUPABASE_URL}/rest/v1/tenants?id=eq.${tenant_id}&select=nome`,
      { headers: { apikey: serviceRole, Authorization: `Bearer ${serviceRole}` } },
    );
    const tenants = await tenantRes.json();
    const nomeTenant = tenants[0]?.nome ?? "desconhecido";

    await criarNotificacaoSuperAdmin(tenant_id, nomeTenant, serviceRole);

    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error("Erro:", (e as Error).message);
    await registrarErro("edge_function_error", "enviar-alerta-gmail-desconectado", (e as Error).message, {
      severidade: "alta",
      detalhes: { stack: (e as Error).stack },
    });
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function registrarErro(
  tipo: string,
  origem: string,
  mensagem: string,
  opts: { detalhes?: any; tenant_id?: string | null; severidade?: "baixa" | "media" | "alta" | "critica" } = {},
): Promise<void> {
  try {
    const sr = getServiceRole();
    if (!sr) return;
    await fetch(`${SUPABASE_URL}/functions/v1/registrar-erro`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${sr}` },
      body: JSON.stringify({ tipo, origem, mensagem, ...opts }),
    });
  } catch {
    // best-effort
  }
}

async function criarNotificacaoSuperAdmin(tenantId: string, nomeTenant: string, serviceRole: string): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/notificacoes_painel`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: serviceRole,
      Authorization: `Bearer ${serviceRole}`,
    },
    body: JSON.stringify({
      tenant_id: null,
      tipo: "gmail_desconectado",
      titulo: "⚠️ EMAIL DESCONECTADO — CONECTAR URGENTE",
      mensagem: `O Gmail do tenant ${nomeTenant} foi desconectado. Reconecte imediatamente para não perder pedidos.`,
      link: `/admin/tenants/${tenantId}`,
    }),
  });
  if (!res.ok) {
    console.error("Falha ao criar notificação de painel:", await res.text());
  }
}
