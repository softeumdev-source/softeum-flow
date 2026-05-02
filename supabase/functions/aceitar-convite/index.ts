// Edge function: processa o aceite de um convite. Pública (verify_jwt
// desligado) — a autorização é o próprio token. Spec não usa expiração.
//
// Body: { token, nome, senha }
//
// Fluxo:
//   1. Valida token (existe + status='pendente').
//   2. Cria/atualiza usuário no Auth (define a senha escolhida).
//   3. Insere/atualiza tenant_membros com o papel do convite.
//   4. Marca convite como aceito.
//   5. Faz signInWithPassword via service role e devolve a sessão pro
//      frontend setar via supabase.auth.setSession.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.104.0";
import { SUPABASE_URL, getServiceRole } from "../_shared/supabase-client.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResp(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SERVICE_ROLE = getServiceRole();
    const ANON = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
      Deno.env.get("SUPABASE_ANON_KEY");
    if (!SERVICE_ROLE || !ANON) {
      return jsonResp(500, { error: "Configuração inválida" });
    }

    const body = await req.json().catch(() => ({}));
    const token = String(body?.token ?? "").trim();
    const nome = String(body?.nome ?? "").trim();
    const senha = String(body?.senha ?? "");

    if (!token) return jsonResp(400, { error: "token obrigatório" });
    if (nome.length < 2) return jsonResp(400, { error: "Informe seu nome completo" });
    if (senha.length < 8) {
      return jsonResp(400, { error: "A senha deve ter pelo menos 8 caracteres" });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // 1. Convite válido?
    const { data: convite, error: convErr } = await admin
      .from("tenant_convites")
      .select("id, tenant_id, email, papel, status")
      .eq("token", token)
      .maybeSingle();
    if (convErr) throw convErr;
    if (!convite) return jsonResp(404, { error: "Convite não encontrado" });
    if (convite.status === "aceito") {
      return jsonResp(409, { error: "Convite já foi aceito", status: "aceito" });
    }
    if (convite.status === "cancelado") {
      return jsonResp(409, { error: "Convite cancelado", status: "cancelado" });
    }

    const emailNorm = String(convite.email).trim().toLowerCase();

    // 2. Usuário já existe?
    let userId: string | null = null;
    {
      let page = 1;
      const perPage = 1000;
      while (page <= 50) {
        const { data: list, error: listErr } = await admin.auth.admin.listUsers({
          page,
          perPage,
        });
        if (listErr) throw listErr;
        const users = list?.users ?? [];
        const existing = users.find(
          (u: any) => (u.email ?? "").toLowerCase() === emailNorm,
        );
        if (existing) {
          userId = existing.id;
          break;
        }
        if (users.length < perPage) break;
        page++;
      }
    }

    if (userId) {
      const { error: updErr } = await admin.auth.admin.updateUserById(userId, {
        password: senha,
        email_confirm: true,
        user_metadata: { nome },
      });
      if (updErr) throw updErr;
    } else {
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email: emailNorm,
        password: senha,
        email_confirm: true,
        user_metadata: { nome },
      });
      if (createErr) throw createErr;
      userId = created.user!.id;
    }

    // 3. Vincula em tenant_membros (upsert manual, mesma lógica do
    //    criar-usuario-tenant — RPC add_tenant_member tem bug em ON CONFLICT).
    const { data: membroExistente, error: selErr } = await admin
      .from("tenant_membros")
      .select("id")
      .eq("user_id", userId)
      .eq("tenant_id", convite.tenant_id)
      .maybeSingle();
    if (selErr) throw selErr;

    if (membroExistente) {
      const { error: updMembroErr } = await admin
        .from("tenant_membros")
        .update({
          papel: convite.papel,
          nome,
          email: emailNorm,
          ativo: true,
        })
        .eq("id", membroExistente.id);
      if (updMembroErr) throw updMembroErr;
    } else {
      const { error: insMembroErr } = await admin
        .from("tenant_membros")
        .insert({
          user_id: userId,
          tenant_id: convite.tenant_id,
          papel: convite.papel,
          nome,
          email: emailNorm,
          ativo: true,
        });
      if (insMembroErr) throw insMembroErr;
    }

    // 4. Marca o convite como aceito
    const { error: updConvErr } = await admin
      .from("tenant_convites")
      .update({ status: "aceito", accepted_at: new Date().toISOString() })
      .eq("id", convite.id);
    if (updConvErr) throw updConvErr;

    // 5. Estabelece sessão pro frontend logar automaticamente
    const sessionClient = createClient(SUPABASE_URL, ANON);
    const { data: sess, error: sessErr } = await sessionClient.auth.signInWithPassword({
      email: emailNorm,
      password: senha,
    });
    if (sessErr || !sess?.session) {
      // Convite efetivado, mas signin falhou — frontend manda pra /login.
      return jsonResp(200, {
        sucesso: true,
        sessao: null,
        aviso: "Conta criada. Faça login com seu email e a senha que você acabou de definir.",
      });
    }

    return jsonResp(200, {
      sucesso: true,
      sessao: {
        access_token: sess.session.access_token,
        refresh_token: sess.session.refresh_token,
      },
    });
  } catch (e: any) {
    console.error("aceitar-convite error:", e?.message ?? e);
    return jsonResp(500, { error: e?.message ?? String(e) });
  }
});
