// Edge function: cria um usuário admin no Supabase Auth com senha provisória
// e o vincula ao tenant informado em tenant_membros como 'admin'.
// Apenas super admins autenticados podem chamar.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function gerarSenhaProvisoria(): string {
  // 12 chars: maiúscula + minúscula + dígitos + símbolo
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const nums = "23456789";
  const sym = "!@#$%&*";
  const all = upper + lower + nums + sym;
  const pick = (s: string) => s[Math.floor(Math.random() * s.length)];
  let pwd = pick(upper) + pick(lower) + pick(nums) + pick(sym);
  for (let i = 0; i < 8; i++) pwd += pick(all);
  // embaralha
  return pwd.split("").sort(() => Math.random() - 0.5).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Não autenticado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Valida o token via API admin (suporta ES256 / chaves novas)
    const token = authHeader.replace("Bearer ", "").trim();
    const { data: userRes, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userRes?.user) {
      console.error("getUser error:", userErr);
      return new Response(JSON.stringify({ error: "Sessão inválida" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verifica super admin diretamente na tabela (sem depender de auth.uid() do RPC)
    const { data: superRow, error: superErr } = await admin
      .from("super_admins")
      .select("user_id")
      .eq("user_id", userRes.user.id)
      .maybeSingle();
    if (superErr || !superRow) {
      return new Response(JSON.stringify({ error: "Apenas super admins" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { tenant_id, admin_nome, admin_email, empresa_nome } = body ?? {};

    if (!tenant_id || !admin_email || !admin_nome) {
      return new Response(
        JSON.stringify({ error: "tenant_id, admin_nome e admin_email são obrigatórios" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 1) Verifica se já existe usuário com esse e-mail
    let adminUserId: string | null = null;
    let senhaProvisoria: string | null = null;

    const { data: list } = await admin.auth.admin.listUsers();
    const existing = list?.users?.find(
      (u: any) => (u.email ?? "").toLowerCase() === String(admin_email).toLowerCase(),
    );

    if (existing) {
      adminUserId = existing.id;
      // Reseta senha para uma nova provisória
      senhaProvisoria = gerarSenhaProvisoria();
      const { error: updErr } = await admin.auth.admin.updateUserById(existing.id, {
        password: senhaProvisoria,
        email_confirm: true,
        user_metadata: { ...(existing.user_metadata ?? {}), nome: admin_nome },
      });
      if (updErr) throw updErr;
    } else {
      senhaProvisoria = gerarSenhaProvisoria();
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email: admin_email,
        password: senhaProvisoria,
        email_confirm: true,
        user_metadata: { nome: admin_nome, empresa: empresa_nome ?? null },
      });
      if (createErr) throw createErr;
      adminUserId = created.user!.id;
    }

    // 2) Vincula ao tenant como admin (idempotente via RPC)
    const { error: rpcErr } = await admin.rpc("add_tenant_member", {
      p_user_id: adminUserId,
      p_tenant_id: tenant_id,
      p_papel: "admin",
      p_nome: admin_nome,
    });
    if (rpcErr) throw rpcErr;

    return new Response(
      JSON.stringify({
        sucesso: true,
        email: admin_email,
        senha_provisoria: senhaProvisoria,
        admin_user_id: adminUserId,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    console.error("criar-usuario-tenant error:", e);
    return new Response(JSON.stringify({ error: e?.message ?? String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
