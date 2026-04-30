import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import {
  CATALOGO_DEMO,
  DE_PARA_DEMO,
  DEMO_CNPJ_COMPRADOR,
  DEMO_NOME_COMPRADOR,
  DEMO_TENANT_ID,
  LAYOUT_DEMO_MIME,
  LAYOUT_DEMO_NOME,
  LAYOUT_DEMO_TIPO,
} from "../_shared/demo-seed.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL_PUB = "https://arihejdirnhmcwuhkzde.supabase.co";

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

    const admin = createClient(supaUrl, serviceRole);

    // 1. Garante tenant Demo
    await admin.from("tenants").upsert({
      id: DEMO_TENANT_ID,
      nome: "Indústria Demo",
      slug: "demo",
      ativo: true,
      is_demo: true,
      nome_fantasia: "Indústria Demo Ltda",
      cnpj: "00.000.000/0001-00",
    });

    // 2. Catálogo (upsert por (tenant_id, codigo_erp))
    const catalogoPayload = CATALOGO_DEMO.map((p) => ({
      tenant_id: DEMO_TENANT_ID,
      codigo_erp: p.codigo_erp,
      descricao: p.descricao,
      ean: p.ean,
      categoria: p.categoria,
      fator_conversao: 1,
      ativo: true,
    }));
    const { error: catErr } = await admin
      .from("catalogo_produtos")
      .upsert(catalogoPayload, { onConflict: "tenant_id,codigo_erp" });
    if (catErr) throw new Error("Falha ao popular catálogo: " + catErr.message);

    // 3. DE-PARAs do "Atacadão Demo"
    // Removemos TODOS os DE-PARAs PRODUTO_CODIGO do tenant demo e
    // reinserimos. Sem filtro por cnpj_comprador — confirmar-de-para-
    // pedido grava com cnpj do pedido (que pode ser NULL), o que
    // escapava do filtro antigo e deixava lixo de testes manuais
    // contaminando o demo (causava cenário "Códigos novos" não gerar
    // pendências porque ATC-NOVO* já existia no banco). Idempotente.
    await admin
      .from("de_para")
      .delete()
      .eq("tenant_id", DEMO_TENANT_ID)
      .eq("tipo", "PRODUTO_CODIGO");

    const deParaPayload = DE_PARA_DEMO.map((d) => ({
      tenant_id: DEMO_TENANT_ID,
      tipo: "PRODUTO_CODIGO",
      cnpj_comprador: DEMO_CNPJ_COMPRADOR,
      nome_comprador: DEMO_NOME_COMPRADOR,
      valor_origem: d.valor_origem,
      valor_destino: d.valor_destino,
      descricao: d.descricao,
      fator_conversao: 1,
      ativo: true,
    }));
    if (deParaPayload.length > 0) {
      const { error: dpErr } = await admin.from("de_para").insert(deParaPayload);
      if (dpErr) throw new Error("Falha ao popular DE-PARAs: " + dpErr.message);
    }

    // 4. Layout ERP de exemplo (1 entrada — a tabela tem UNIQUE(tenant_id))
    const layoutCsv = "codigo;descricao;quantidade;valor_unitario;valor_total\n";
    const layoutBase64 = btoa(layoutCsv);
    await admin.from("tenant_erp_config").upsert(
      {
        tenant_id: DEMO_TENANT_ID,
        tipo: "outro",
        tipo_erp: LAYOUT_DEMO_TIPO,
        layout_arquivo: layoutBase64,
        layout_filename: LAYOUT_DEMO_NOME,
        layout_mime: LAYOUT_DEMO_MIME,
        ativo: true,
      },
      { onConflict: "tenant_id" },
    );

    return jsonResp(200, {
      success: true,
      tenant_id: DEMO_TENANT_ID,
      catalogo: catalogoPayload.length,
      de_paras: deParaPayload.length,
      layouts: 1,
    });
  } catch (e) {
    console.error("Erro em inicializar-demo:", (e as Error).message);
    return jsonResp(500, { error: (e as Error).message });
  }
});

function jsonResp(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
