import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL_PUB = "https://arihejdirnhmcwuhkzde.supabase.co";

interface ReqBody {
  pedido_item_id: string;
  codigo_erp_escolhido: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supaUrl = Deno.env.get("SUPABASE_URL") ?? SUPABASE_URL_PUB;
    const serviceRole = Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anon = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY");
    if (!serviceRole || !anon) {
      return jsonResp(500, { error: "Secrets do Supabase não configurados" });
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return jsonResp(401, { error: "Não autenticado" });
    }

    const userClient = createClient(supaUrl, anon, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes } = await userClient.auth.getUser();
    if (!userRes?.user) return jsonResp(401, { error: "Sessão inválida" });

    const body = (await req.json()) as ReqBody;
    const pedidoItemId = String(body.pedido_item_id ?? "").trim();
    const codigoEscolhido = String(body.codigo_erp_escolhido ?? "").trim();
    if (!pedidoItemId || !codigoEscolhido) {
      return jsonResp(400, { error: "pedido_item_id e codigo_erp_escolhido são obrigatórios" });
    }

    const admin = createClient(supaUrl, serviceRole);

    const { data: itemRow, error: itemErr } = await admin
      .from("pedido_itens")
      .select("id, pedido_id, tenant_id, codigo_cliente")
      .eq("id", pedidoItemId)
      .maybeSingle();
    if (itemErr) throw itemErr;
    if (!itemRow) return jsonResp(404, { error: "Item de pedido não encontrado" });

    const tenantId = (itemRow as any).tenant_id as string;

    const { data: isAdmin, error: adminErr } = await userClient.rpc("is_tenant_admin", { p_tenant_id: tenantId });
    if (adminErr) throw adminErr;
    const { data: isSuper } = await userClient.rpc("is_super_admin");
    if (!isAdmin && !isSuper) {
      return jsonResp(403, { error: "Apenas administradores do tenant" });
    }

    const { data: produto, error: produtoErr } = await admin
      .from("catalogo_produtos")
      .select("codigo_erp, descricao, fator_conversao")
      .eq("tenant_id", tenantId)
      .eq("codigo_erp", codigoEscolhido)
      .maybeSingle();
    if (produtoErr) throw produtoErr;
    if (!produto) return jsonResp(404, { error: "Código ERP escolhido não está no catálogo do tenant" });

    const { data: pedidoRow, error: pedidoErr } = await admin
      .from("pedidos")
      .select("id, cnpj, empresa, status")
      .eq("id", (itemRow as any).pedido_id)
      .maybeSingle();
    if (pedidoErr) throw pedidoErr;
    if (!pedidoRow) return jsonResp(404, { error: "Pedido não encontrado" });

    const codigoCliente = ((itemRow as any).codigo_cliente ?? "").toString();
    if (codigoCliente) {
      const { data: existente } = await admin
        .from("de_para")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("tipo", "PRODUTO_CODIGO")
        .eq("valor_origem", codigoCliente)
        .eq("ativo", true)
        .limit(1);
      const payloadDePara = {
        tenant_id: tenantId,
        tipo: "PRODUTO_CODIGO",
        cnpj_comprador: (pedidoRow as any).cnpj ?? null,
        nome_comprador: (pedidoRow as any).empresa ?? null,
        valor_origem: codigoCliente,
        valor_destino: codigoEscolhido,
        descricao: (produto as any).descricao,
        fator_conversao: (produto as any).fator_conversao ?? null,
        ativo: true,
        criado_por: userRes.user.id,
        origem: "ia",
      };
      if (existente && existente.length > 0) {
        await admin
          .from("de_para")
          .update({ ...payloadDePara, atualizado_em: new Date().toISOString() })
          .eq("id", (existente[0] as any).id);
      } else {
        await admin.from("de_para").insert(payloadDePara);
      }
    }

    await admin
      .from("pedido_itens")
      .update({ codigo_produto_erp: codigoEscolhido })
      .eq("id", pedidoItemId);

    await admin
      .from("pedido_itens_pendentes_de_para")
      .update({
        resolvido: true,
        codigo_escolhido: codigoEscolhido,
        resolvido_em: new Date().toISOString(),
      })
      .eq("pedido_item_id", pedidoItemId);

    const { count: pendentesRestantes } = await admin
      .from("pedido_itens_pendentes_de_para")
      .select("id", { count: "exact", head: true })
      .eq("pedido_id", (pedidoRow as any).id)
      .eq("resolvido", false);

    let novoStatus: string | null = null;
    const statusAtual = (pedidoRow as any).status as string;
    if ((pendentesRestantes ?? 0) === 0 && (statusAtual === "aguardando_de_para" || statusAtual === "aprovado_parcial")) {
      novoStatus = "aprovado";
      await admin
        .from("pedidos")
        .update({
          status: "aprovado",
          aprovado_por: userRes.user.id,
          aprovado_em: new Date().toISOString(),
        })
        .eq("id", (pedidoRow as any).id);
    }

    return jsonResp(200, {
      success: true,
      pendentes_restantes: pendentesRestantes ?? 0,
      novo_status: novoStatus,
    });
  } catch (e) {
    console.error("Erro em confirmar-de-para-pedido:", (e as Error).message);
    await registrarErro("edge_function_error", "confirmar-de-para-pedido", (e as Error).message, {
      severidade: "media",
      detalhes: { stack: (e as Error).stack },
    });
    return jsonResp(500, { error: (e as Error).message });
  }
});

function jsonResp(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function registrarErro(
  tipo: string,
  origem: string,
  mensagem: string,
  opts: { detalhes?: any; tenant_id?: string | null; severidade?: "baixa" | "media" | "alta" | "critica" } = {},
): Promise<void> {
  try {
    const sr = Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!sr) return;
    const url = (Deno.env.get("SUPABASE_URL") ?? SUPABASE_URL_PUB) + "/functions/v1/registrar-erro";
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${sr}` },
      body: JSON.stringify({ tipo, origem, mensagem, ...opts }),
    });
  } catch {
    // best-effort
  }
}
