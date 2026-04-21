// Edge function: cria um usuário admin no Supabase Auth e o tenant correspondente.
// Apenas super admins autenticados podem chamar.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Não autenticado" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Cliente "como o usuário" para checar se é super admin
    const userClient = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes } = await userClient.auth.getUser();
    if (!userRes?.user) {
      return new Response(JSON.stringify({ error: "Sessão inválida" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: isSuper, error: superErr } = await userClient.rpc("is_super_admin");
    if (superErr || !isSuper) {
      return new Response(JSON.stringify({ error: "Apenas super admins" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json();
    const { dados, admin_email, admin_nome, admin_senha } = body ?? {};
    if (!admin_email || !admin_nome) {
      return new Response(JSON.stringify({ error: "admin_email e admin_nome são obrigatórios" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Cliente admin com service role
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // 1) Tenta encontrar usuário existente por e-mail
    let adminUserId: string | null = null;
    const { data: list } = await admin.auth.admin.listUsers();
    const existing = list?.users?.find((u: any) => (u.email ?? "").toLowerCase() === String(admin_email).toLowerCase());
    if (existing) {
      adminUserId = existing.id;
    } else {
      const senha = admin_senha && String(admin_senha).length >= 8 ? String(admin_senha) : crypto.randomUUID() + "Aa1!";
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email: admin_email,
        password: senha,
        email_confirm: true,
        user_metadata: { nome: admin_nome },
      });
      if (createErr) throw createErr;
      adminUserId = created.user!.id;
    }

    // 2) Cria o tenant + vínculo via RPC (também valida super admin)
    const { data: tenantId, error: rpcErr } = await userClient.rpc("criar_tenant_completo", {
      p_dados: dados,
      p_admin_user_id: adminUserId,
      p_admin_nome: admin_nome,
    });
    if (rpcErr) throw rpcErr;

    return new Response(JSON.stringify({ tenant_id: tenantId, admin_user_id: adminUserId }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("criar-tenant-admin error:", e);
    return new Response(JSON.stringify({ error: e?.message ?? String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
