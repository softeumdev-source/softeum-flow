// Edge function: desativa/reativa um membro do tenant.
// Quando desativa (ativo=false), também invalida todas as sessões ativas
// do usuário via auth.admin.signOut, forçando logout imediato.
// Permitido para super admin OU admin do mesmo tenant.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.104.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON =
      Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;

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

    const body = await req.json().catch(() => ({}));
    const membro_id = body?.membro_id as string | undefined;
    const tenant_id = body?.tenant_id as string | undefined;
    const ativo = Boolean(body?.ativo);

    if (!membro_id || !tenant_id) {
      return jsonResponse({ error: "membro_id e tenant_id obrigatórios" }, 400);
    }

    // Autorização: super admin OU admin do tenant
    const { data: superRow } = await admin
      .from("super_admins")
      .select("user_id")
      .eq("user_id", callerId)
      .maybeSingle();

    let autorizado = !!superRow;
    if (!autorizado) {
      const { data: callerMember } = await admin
        .from("tenant_membros")
        .select("papel, ativo")
        .eq("user_id", callerId)
        .eq("tenant_id", tenant_id)
        .maybeSingle();
      autorizado =
        !!callerMember && callerMember.ativo !== false && callerMember.papel === "admin";
    }

    if (!autorizado) {
      return jsonResponse({ error: "Sem permissão" }, 403);
    }

    // Localizar membro alvo
    const { data: membro, error: mErr } = await admin
      .from("tenant_membros")
      .select("id, user_id, tenant_id")
      .eq("id", membro_id)
      .eq("tenant_id", tenant_id)
      .maybeSingle();
    if (mErr) throw mErr;
    if (!membro) return jsonResponse({ error: "Membro não encontrado" }, 404);

    // Atualiza status
    const { error: updErr } = await admin
      .from("tenant_membros")
      .update({ ativo })
      .eq("id", membro_id);
    if (updErr) throw updErr;

    // Se desativando, força logout imediato em todos os dispositivos
    if (!ativo) {
      try {
        await admin.auth.admin.signOut(membro.user_id, "global");
      } catch (e) {
        console.warn("signOut falhou (ignorado):", e);
      }
    }

    return jsonResponse({ sucesso: true, ativo });
  } catch (e: any) {
    console.error("desativar-membro-tenant error:", e);
    return jsonResponse({ error: e?.message ?? String(e) }, 500);
  }
});
