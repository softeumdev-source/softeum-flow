// Edge function: cria registro em tenant_convites e dispara o email de
// convite. Substitui o fluxo de senha provisória do criar-usuario-tenant.
//
// Caller: admin do tenant autenticado (verifica via is_tenant_admin).
// Body: { tenant_id, email, papel: 'admin'|'operador' }
//
// Email delivery:
//   - Email novo (não existe no Auth): supabase.auth.admin.inviteUserByEmail
//     com redirectTo=/aceitar-convite?token=XXX. O Supabase manda o email
//     pelo SMTP do projeto.
//   - Email existente em outro tenant: generateLink({ type: 'magiclink' })
//     pra gerar URL com nosso token; envia via inviteUserByEmail também
//     (ambos cabem aqui — vide doc).
//
// Limite de membros: conta tenant_membros.ativo + tenant_convites.pendente
// e bloqueia se >= tenants.limite_usuarios.
//
// Reenvio: se já existe convite pendente pro (tenant, email), cancela o
// anterior (status='cancelado') e cria novo. Mantém histórico.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.104.0";
import { SUPABASE_URL, getServiceRole } from "../_shared/supabase-client.ts";
import { isServiceRoleCaller, requireTenantAccess } from "../_shared/authz.ts";

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

function gerarToken(): string {
  // ~72 chars: 2x UUID v4 sem hífens. Espaço de 256 bits, mais que
  // suficiente. crypto.randomUUID está disponível no runtime Deno do
  // Supabase Edge.
  return (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SERVICE_ROLE = getServiceRole();
    const ANON = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
      Deno.env.get("SUPABASE_ANON_KEY");
    if (!SERVICE_ROLE || !ANON) {
      return jsonResp(500, { error: "Configuração de servidor inválida" });
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    const internal = isServiceRoleCaller(authHeader, SERVICE_ROLE);

    const body = await req.json().catch(() => ({}));
    const tenantIdRaw = String(body?.tenant_id ?? "").trim();
    const emailRaw = String(body?.email ?? "").trim().toLowerCase();
    const papelRaw = String(body?.papel ?? "").trim();
    const papel: "admin" | "operador" = papelRaw === "admin" ? "admin" : "operador";

    if (!tenantIdRaw || !emailRaw) {
      return jsonResp(400, { error: "tenant_id e email são obrigatórios" });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw)) {
      return jsonResp(400, { error: "Email inválido" });
    }

    let convidadoPor: string | null = null;
    if (!internal) {
      if (!authHeader.startsWith("Bearer ")) {
        return jsonResp(401, { error: "Não autenticado" });
      }
      const userClient = createClient(SUPABASE_URL, ANON, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: userRes } = await userClient.auth.getUser();
      if (!userRes?.user) return jsonResp(401, { error: "Sessão inválida" });
      convidadoPor = userRes.user.id;

      const authz = await requireTenantAccess(userClient, tenantIdRaw);
      if (!authz.ok) return jsonResp(authz.status!, { error: authz.message });

      // Ainda precisa ser admin do tenant (não basta ser membro).
      const { data: isAdmin } = await userClient.rpc("is_tenant_admin", {
        p_tenant_id: tenantIdRaw,
      });
      const { data: isSuper } = await userClient.rpc("is_super_admin");
      if (!isAdmin && !isSuper) {
        return jsonResp(403, { error: "Apenas administradores do tenant" });
      }
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // 1. Limite de membros: já-ativos + convites-pendentes <= limite
    const { data: tenantRow, error: tenantErr } = await admin
      .from("tenants")
      .select("limite_usuarios, nome")
      .eq("id", tenantIdRaw)
      .maybeSingle();
    if (tenantErr) throw tenantErr;
    if (!tenantRow) return jsonResp(404, { error: "Tenant não encontrado" });

    if (tenantRow.limite_usuarios != null) {
      const { count: ativosCount } = await admin
        .from("tenant_membros")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantIdRaw)
        .eq("ativo", true);
      const { count: pendentesCount } = await admin
        .from("tenant_convites")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantIdRaw)
        .eq("status", "pendente");
      const total = (ativosCount ?? 0) + (pendentesCount ?? 0);
      if (total >= tenantRow.limite_usuarios) {
        return jsonResp(409, {
          error: "Limite de usuários do plano atingido (incluindo convites pendentes).",
        });
      }
    }

    // 2. Já é membro ativo desse tenant?
    const { data: existingMember } = await admin
      .from("tenant_membros")
      .select("id, ativo")
      .eq("tenant_id", tenantIdRaw)
      .ilike("email", emailRaw)
      .maybeSingle();
    if (existingMember?.ativo) {
      return jsonResp(409, { error: "Esse email já é membro ativo do tenant" });
    }

    // 3. Cancela convite pendente anterior pro mesmo (tenant, email).
    //    Necessário pra honrar uniq_convite_pendente.
    await admin
      .from("tenant_convites")
      .update({ status: "cancelado" })
      .eq("tenant_id", tenantIdRaw)
      .ilike("email", emailRaw)
      .eq("status", "pendente");

    // 4. Cria registro do convite
    const token = gerarToken();
    const { data: convite, error: insertErr } = await admin
      .from("tenant_convites")
      .insert({
        tenant_id: tenantIdRaw,
        email: emailRaw,
        papel,
        token,
        status: "pendente",
        convidado_por: convidadoPor,
      })
      .select("id, email, papel")
      .single();
    if (insertErr) throw insertErr;

    // 5. Envia email
    const SITE_URL = Deno.env.get("SITE_URL") ?? "https://app.softeum.com.br";
    const acceptUrl = `${SITE_URL}/aceitar-convite?token=${token}`;

    // Verifica se user já existe no Auth — define a estratégia de email.
    let usuarioJaExiste = false;
    {
      let page = 1;
      const perPage = 1000;
      while (page <= 50) {
        const { data: list, error: listErr } = await admin.auth.admin.listUsers({
          page,
          perPage,
        });
        if (listErr) break;
        const users = list?.users ?? [];
        if (users.some((u: any) => (u.email ?? "").toLowerCase() === emailRaw)) {
          usuarioJaExiste = true;
          break;
        }
        if (users.length < perPage) break;
        page++;
      }
    }

    let emailEnviado = false;
    let emailErro: string | null = null;

    try {
      if (!usuarioJaExiste) {
        // Email novo: invite cria placeholder e dispara email.
        const { error: invErr } = await admin.auth.admin.inviteUserByEmail(emailRaw, {
          redirectTo: acceptUrl,
          data: { tenant_id: tenantIdRaw, papel, empresa: tenantRow.nome ?? null },
        });
        if (invErr) emailErro = invErr.message;
        else emailEnviado = true;
      } else {
        // Email já existe: usa magic link com nosso token no redirect.
        // Supabase envia o email do magic link; o usuário aterrissa em
        // /aceitar-convite?token=XXX e o fluxo segue normal.
        const { error: linkErr } = await admin.auth.admin.generateLink({
          type: "magiclink",
          email: emailRaw,
          options: { redirectTo: acceptUrl },
        });
        if (linkErr) emailErro = linkErr.message;
        else emailEnviado = true;
      }
    } catch (e: any) {
      emailErro = e?.message ?? String(e);
    }

    if (!emailEnviado) {
      // Convite ficou gravado, mas o email falhou. Retorna o accept_url
      // pro admin compartilhar manualmente como fallback.
      return jsonResp(207, {
        sucesso: true,
        convite_id: convite.id,
        email: convite.email,
        email_enviado: false,
        email_erro: emailErro,
        accept_url: acceptUrl,
      });
    }

    return jsonResp(200, {
      sucesso: true,
      convite_id: convite.id,
      email: convite.email,
      email_enviado: true,
    });
  } catch (e: any) {
    console.error("enviar-convite-membro error:", e?.message ?? e);
    return jsonResp(500, { error: e?.message ?? String(e) });
  }
});
