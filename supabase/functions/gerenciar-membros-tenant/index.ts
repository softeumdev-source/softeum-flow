// Edge function: gerencia membros de um tenant a partir do painel super admin.
// Ações suportadas:
//  - listar: retorna membros do tenant com email + last_sign_in_at vindos do auth
//  - redefinir-senha: gera nova senha provisória (Softeum1234!) para o user_id informado
//  - toggle-ativo: ativa/desativa um membro específico
// Apenas super admins autenticados podem chamar.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.104.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function gerarSenhaProvisoria(): string {
  // Mesmo formato usado em criar-usuario-tenant: Softeum + 4 dígitos + !
  const n = Math.floor(1000 + Math.random() * 9000);
  return `Softeum${n}!`;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function findAuthUserById(admin: ReturnType<typeof createClient>, userId: string) {
  // listUsers não tem filtro por id; paginamos até encontrar.
  const perPage = 1000;
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const users = data?.users ?? [];
    const found = users.find((u: any) => u.id === userId);
    if (found) return found;
    if (users.length < perPage) break;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return jsonResponse({ error: "Não autenticado" }, 401);
    }

    const token = authHeader.replace("Bearer ", "").trim();
    const userClient = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    const { data: claimsRes, error: claimsErr } = await userClient.auth.getClaims(token);
    const callerId = claimsRes?.claims?.sub;
    if (claimsErr || !callerId) {
      return jsonResponse({ error: "Sessão inválida" }, 401);
    }

    const { data: superRow, error: superErr } = await admin
      .from("super_admins")
      .select("user_id")
      .eq("user_id", callerId)
      .maybeSingle();
    if (superErr || !superRow) {
      return jsonResponse({ error: "Apenas super admins" }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const acao = String(body?.acao ?? "");

    // ---------- LISTAR ----------
    if (acao === "listar") {
      const tenant_id = body?.tenant_id;
      if (!tenant_id) return jsonResponse({ error: "tenant_id obrigatório" }, 400);

      const { data: membros, error: mErr } = await admin
        .from("tenant_membros")
        .select("id, user_id, nome, papel, ativo, created_at, ultimo_acesso")
        .eq("tenant_id", tenant_id)
        .order("ativo", { ascending: false })
        .order("papel", { ascending: true });
      if (mErr) throw mErr;

      // Buscar dados de auth (email + last_sign_in_at) paginando
      const userIds = new Set((membros ?? []).map((m: any) => m.user_id));
      const authMap = new Map<string, { email: string | null; last_sign_in_at: string | null }>();
      const perPage = 1000;
      for (let page = 1; page <= 50; page++) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
        if (error) throw error;
        const users = data?.users ?? [];
        for (const u of users) {
          if (userIds.has(u.id)) {
            authMap.set(u.id, {
              email: u.email ?? null,
              last_sign_in_at: u.last_sign_in_at ?? null,
            });
          }
        }
        if (users.length < perPage) break;
        if (authMap.size >= userIds.size) break;
      }

      const enriched = (membros ?? []).map((m: any) => ({
        ...m,
        email: authMap.get(m.user_id)?.email ?? null,
        last_sign_in_at: authMap.get(m.user_id)?.last_sign_in_at ?? null,
      }));

      return jsonResponse({ membros: enriched });
    }

    // ---------- REDEFINIR SENHA ----------
    if (acao === "redefinir-senha") {
      const user_id = body?.user_id;
      const tenant_id = body?.tenant_id;
      if (!user_id || !tenant_id) {
        return jsonResponse({ error: "user_id e tenant_id obrigatórios" }, 400);
      }

      // Confirma que o usuário pertence ao tenant
      const { data: membro, error: mErr } = await admin
        .from("tenant_membros")
        .select("id, user_id, nome")
        .eq("tenant_id", tenant_id)
        .eq("user_id", user_id)
        .maybeSingle();
      if (mErr) throw mErr;
      if (!membro) return jsonResponse({ error: "Membro não pertence a este tenant" }, 404);

      const authUser = await findAuthUserById(admin, user_id);
      if (!authUser) return jsonResponse({ error: "Usuário não encontrado no Auth" }, 404);

      const senha = gerarSenhaProvisoria();
      const { error: updErr } = await admin.auth.admin.updateUserById(user_id, {
        password: senha,
        email_confirm: true,
      });
      if (updErr) throw updErr;

      return jsonResponse({
        sucesso: true,
        email: authUser.email,
        nome: membro.nome,
        senha_provisoria: senha,
      });
    }

    // ---------- TOGGLE ATIVO ----------
    if (acao === "toggle-ativo") {
      const membro_id = body?.membro_id;
      const ativo = Boolean(body?.ativo);
      const tenant_id = body?.tenant_id;
      if (!membro_id || !tenant_id) {
        return jsonResponse({ error: "membro_id e tenant_id obrigatórios" }, 400);
      }

      const { error: updErr } = await admin
        .from("tenant_membros")
        .update({ ativo })
        .eq("id", membro_id)
        .eq("tenant_id", tenant_id);
      if (updErr) throw updErr;

      return jsonResponse({ sucesso: true, ativo });
    }

    return jsonResponse({ error: `Ação desconhecida: ${acao}` }, 400);
  } catch (e: any) {
    console.error("gerenciar-membros-tenant error:", e);
    return jsonResponse({ error: e?.message ?? String(e) }, 500);
  }
});
