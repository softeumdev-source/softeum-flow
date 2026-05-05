// orquestrador-emails
// Ponto central de disparo do processamento de emails por tenant.
// Chamado pelo cron a cada 5 min em substituição ao cron direto em
// processar-email-pdf e coletar-resultados-batch.
//
// Fluxo:
//   1. Autentica via service role
//   2. Busca todos os tenants com Gmail ativo (tenants.ativo = true)
//   3. Separa em imediato / batch
//   4. Dispara fire-and-forget para cada tenant (não aguarda resultado)
//   5. Retorna contadores imediatamente

import { SUPABASE_URL, getServiceRole } from "../_shared/supabase-client.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// deno-lint-ignore no-explicit-any
type AnyObj = Record<string, any>;

const TIMEOUT_MS = 110_000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const serviceRole = getServiceRole();
    if (!serviceRole) {
      return jsonResp(500, { error: "Secrets não configurados" });
    }

    // Busca tenants com Gmail ativo e tenant ativo, incluindo modo_processamento.
    // O filtro tenants.ativo=eq.true exige o inner join (!inner) para que
    // tenants sem ativo=true sejam excluídos do resultado.
    const configRes = await fetch(
      `${SUPABASE_URL}/rest/v1/tenant_gmail_config?ativo=eq.true&select=tenant_id,tenants!inner(modo_processamento,ativo)&tenants.ativo=eq.true`,
      { headers: { apikey: serviceRole, Authorization: `Bearer ${serviceRole}` } },
    );

    if (!configRes.ok) {
      const txt = await configRes.text();
      return jsonResp(500, { error: `Falha ao buscar configs: ${txt}` });
    }

    const configs: AnyObj[] = await configRes.json();
    console.log(`[orquestrador] tenants encontrados: ${configs.length}`);

    if (configs.length === 0) {
      return jsonResp(200, { imediato: 0, batch: 0, total: 0, motivo: "nenhum_tenant_ativo" });
    }

    const imediato: string[] = [];
    const batch: string[] = [];

    for (const c of configs) {
      const modo: string = c.tenants?.modo_processamento ?? "imediato";
      if (modo === "batch") {
        batch.push(c.tenant_id as string);
      } else {
        imediato.push(c.tenant_id as string);
      }
    }

    console.log(`[orquestrador] imediato=${imediato.length} batch=${batch.length}`);

    // Fire-and-forget: dispara todas as chamadas sem await.
    // Cada tenant é processado de forma independente e paralela.

    // Tenants batch → processar-email-batch (um por chamada)
    const batchPromises = batch.map((tenantId) =>
      fetchComTimeout(
        `${SUPABASE_URL}/functions/v1/processar-email-batch`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceRole}` },
          body: JSON.stringify({ tenant_id: tenantId }),
        },
        TIMEOUT_MS,
      ).catch((e) => console.error(`[orquestrador] erro batch tenant=${tenantId}:`, e.message))
    );

    // Tenants imediato → processar-email-pdf com tenant_id específico
    const imediatoPromises = imediato.map((tenantId) =>
      fetchComTimeout(
        `${SUPABASE_URL}/functions/v1/processar-email-pdf`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceRole}` },
          body: JSON.stringify({ tenant_id: tenantId }),
        },
        TIMEOUT_MS,
      ).catch((e) => console.error(`[orquestrador] erro imediato tenant=${tenantId}:`, e.message))
    );

    // Não await — fire-and-forget verdadeiro.
    Promise.all([...batchPromises, ...imediatoPromises]).catch(() => {});

    return jsonResp(200, {
      imediato: imediato.length,
      batch: batch.length,
      total: imediato.length + batch.length,
    });
  } catch (e) {
    console.error("[orquestrador] erro:", (e as Error).message);
    return jsonResp(500, { error: (e as Error).message });
  }
});

function fetchComTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  return fetch(url, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

function jsonResp(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
