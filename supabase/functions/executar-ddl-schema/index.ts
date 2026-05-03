// Edge function pra ações administrativas sobre schema_alteracoes_log:
//   - action="executar" : chama rpc executar_ddl_expansao_pedido(log_id)
//                         (a função SQL já valida estado e atualiza o log)
//   - action="cancelar" : insere nova linha tipo='ignorar' linkando ao log
//                         original via (tenant_id_origem, tabela_alvo,
//                         nome_coluna_origem). Append-only preservado.
//
// Autorização: somente super_admin autenticado. Sem fallback service_role.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
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

interface Payload {
  log_id?: string;
  action?: "executar" | "cancelar";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResp(405, { error: "Método não permitido" });

  try {
    const serviceRole = getServiceRole();
    const anon = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY");
    if (!serviceRole || !anon) return jsonResp(500, { error: "Secrets do Supabase não configurados" });

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return jsonResp(401, { error: "Não autenticado" });

    const userClient = createClient(SUPABASE_URL, anon, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes } = await userClient.auth.getUser();
    if (!userRes?.user) return jsonResp(401, { error: "Sessão inválida" });

    const { data: isSuper } = await userClient.rpc("is_super_admin");
    if (!isSuper) return jsonResp(403, { error: "Apenas super admins" });

    let payload: Payload;
    try {
      payload = await req.json();
    } catch {
      return jsonResp(400, { error: "Body JSON inválido" });
    }

    const logId = payload.log_id?.trim();
    const action = payload.action;
    if (!logId) return jsonResp(400, { error: "log_id obrigatório" });
    if (action !== "executar" && action !== "cancelar") {
      return jsonResp(400, { error: "action deve ser 'executar' ou 'cancelar'" });
    }

    const admin = createClient(SUPABASE_URL, serviceRole);

    // Busca o log original — usado em ambas as actions pra validar estado.
    const { data: log, error: logErr } = await admin
      .from("schema_alteracoes_log")
      .select("id, tipo_operacao, tenant_id_origem, tabela_alvo, nome_coluna_origem, executado_em")
      .eq("id", logId)
      .maybeSingle();

    if (logErr) return jsonResp(500, { error: "Erro ao buscar log: " + logErr.message });
    if (!log) return jsonResp(404, { error: "Registro não encontrado" });
    if (log.tipo_operacao !== "criar_coluna") {
      return jsonResp(400, {
        error: `Operação só é válida para tipo 'criar_coluna' (registro é '${log.tipo_operacao}')`,
      });
    }
    if (log.executado_em) {
      return jsonResp(409, { error: "Registro já foi executado em " + log.executado_em });
    }

    if (action === "executar") {
      const { data: rpcData, error: rpcErr } = await admin.rpc("executar_ddl_expansao_pedido", {
        p_log_id: logId,
      });
      if (rpcErr) return jsonResp(500, { error: "Falha ao executar DDL: " + rpcErr.message });
      return jsonResp(200, { ok: true, action: "executar", resultado: rpcData });
    }

    // action === "cancelar": idempotência — nenhuma row 'ignorar' já linkada
    // ao mesmo trio depois do log original.
    const { data: jaIgnorado, error: idemErr } = await admin
      .from("schema_alteracoes_log")
      .select("id")
      .eq("tipo_operacao", "ignorar")
      .eq("tenant_id_origem", log.tenant_id_origem)
      .eq("tabela_alvo", log.tabela_alvo)
      .eq("nome_coluna_origem", log.nome_coluna_origem)
      .limit(1)
      .maybeSingle();

    if (idemErr) return jsonResp(500, { error: "Erro ao checar idempotência: " + idemErr.message });
    if (jaIgnorado) {
      return jsonResp(409, { error: "Coluna já foi marcada como ignorada anteriormente" });
    }

    const { data: novo, error: insErr } = await admin
      .from("schema_alteracoes_log")
      .insert({
        tipo_operacao: "ignorar",
        tenant_id_origem: log.tenant_id_origem,
        tabela_alvo: log.tabela_alvo,
        nome_coluna_origem: log.nome_coluna_origem,
        campo_sistema_resultado: null,
        justificativa_ia: `Marcado como ignorado por super_admin via painel (log original: ${logId})`,
        executor: "super_admin",
        executor_user_id: userRes.user.id,
        executado_em: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (insErr) return jsonResp(500, { error: "Falha ao inserir log de cancelamento: " + insErr.message });
    return jsonResp(200, { ok: true, action: "cancelar", novo_log_id: novo.id });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonResp(500, { error: "Erro inesperado: " + msg });
  }
});
