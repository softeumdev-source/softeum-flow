import * as XLSX from "https://cdn.sheetjs.com/xlsx-0.20.1/package/xlsx.mjs";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import {
  colunasOrdenadas, escaparCSV, escaparXML,
  montarCamposItem, montarCamposPedido, valorDaColuna,
} from "../_shared/exportador-helpers.ts";
import { SUPABASE_URL, getServiceRole } from "../_shared/supabase-client.ts";
import { isServiceRoleCaller, requireTenantAccess } from "../_shared/authz.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ReqBody {
  tenant_id: string;
  pedido_ids: string[];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = (await req.json()) as ReqBody;
    const tenantId = body.tenant_id;
    const pedidoIds = Array.isArray(body.pedido_ids) ? body.pedido_ids.filter(Boolean) : [];

    if (!tenantId || pedidoIds.length === 0) {
      return jsonResp(400, { error: "tenant_id e pedido_ids (array não vazio) são obrigatórios" });
    }

    const serviceRole = getServiceRole();
    if (!serviceRole) return jsonResp(500, { error: "Service role não configurado" });

    // Authz: caller precisa ser super admin ou membro do tenant solicitado.
    // Caller interno (service role) é confiável e pula. O filtro de
    // tenant_id no SELECT mais abaixo já barra acesso a pedidos de outros
    // tenants mesmo com pedido_ids forjados, mas validamos o membership
    // do caller pra impedir export legítimo de tenant alheio.
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!isServiceRoleCaller(authHeader, serviceRole)) {
      const anon = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY");
      if (!anon) return jsonResp(500, { error: "Anon key não configurada" });
      const userClient = createClient(SUPABASE_URL, anon, { global: { headers: { Authorization: authHeader } } });
      const { data: userRes } = await userClient.auth.getUser();
      if (!userRes?.user) return jsonResp(401, { error: "Sessão inválida" });

      const authz = await requireTenantAccess(userClient, tenantId);
      if (!authz.ok) {
        await registrarErro("authz_denied", "exportar-pedidos-lote",
          `User ${userRes.user.id} tentou exportar lote do tenant ${tenantId} (${pedidoIds.length} pedidos)`,
          { severidade: "alta", tenant_id: tenantId, detalhes: { user_id: userRes.user.id, pedido_ids: pedidoIds } });
        return jsonResp(authz.status!, { error: authz.message });
      }
    }

    // 1. Mapeamento ERP do tenant
    const configRes = await fetch(
      `${SUPABASE_URL}/rest/v1/tenant_erp_config?tenant_id=eq.${tenantId}&select=*`,
      { headers: { apikey: serviceRole, Authorization: `Bearer ${serviceRole}` } },
    );
    const configs = await configRes.json();
    const config = configs[0];
    if (!config?.mapeamento_campos?.colunas?.length) {
      return jsonResp(400, { error: "Mapeamento do ERP não encontrado. Acesse Integrações e salve o layout novamente." });
    }
    const mapeamento = config.mapeamento_campos;

    // 2. Carrega todos os pedidos do batch (filtra pelo tenant pra segurança)
    const idsParam = pedidoIds.map((id) => `"${id}"`).join(",");
    const pedidosRes = await fetch(
      `${SUPABASE_URL}/rest/v1/pedidos?id=in.(${idsParam})&tenant_id=eq.${tenantId}&select=*`,
      { headers: { apikey: serviceRole, Authorization: `Bearer ${serviceRole}` } },
    );
    const pedidos = await pedidosRes.json() as any[];

    if (pedidos.length === 0) {
      return jsonResp(404, { error: "Nenhum pedido encontrado para o lote" });
    }

    // 3. Busca itens de todos os pedidos em UMA query
    const itensRes = await fetch(
      `${SUPABASE_URL}/rest/v1/pedido_itens?pedido_id=in.(${idsParam})&select=*&order=pedido_id.asc,numero_item.asc`,
      { headers: { apikey: serviceRole, Authorization: `Bearer ${serviceRole}` } },
    );
    const itensRaw = await itensRes.json() as any[];
    const itensPorPedido = new Map<string, any[]>();
    for (const it of itensRaw) {
      const arr = itensPorPedido.get(it.pedido_id) ?? [];
      arr.push(it);
      itensPorPedido.set(it.pedido_id, arr);
    }

    // Colunas na ordem EXATA do layout subido pelo cliente
    // (analisar-layout-erp já preserva a ordem do arquivo original).
    const colsAtivas = colunasOrdenadas(mapeamento.colunas ?? []);
    const colsPedido = colsAtivas.filter((c: any) => c.tipo !== "item");
    const colsItem = colsAtivas.filter((c: any) => c.tipo === "item");

    const formato = (mapeamento.formato ?? "csv") as string;
    const separadorRaw = mapeamento.separador ?? ";";
    const separador = separadorRaw === "tab" ? "\t" : separadorRaw === "pipe" ? "|" : separadorRaw;

    // ---------- Cabeçalho extra: rastreabilidade do pedido de origem ----------
    // Sempre fica como PRIMEIRA coluna em planilhas/CSV/TXT, e como atributo
    // dedicado em XML/JSON. Permite ao cliente filtrar/buscar no ERP.
    const COLUNA_ORIGEM = "Pedido origem";

    const contadorCodigos = { comDePara: 0, comOriginal: 0 };
    let totalItens = 0;

    let conteudoArquivo = "";
    let mimeType = "text/plain";
    let extensao = "txt";
    let isXlsx = false;
    let xlsxBuffer: Uint8Array | null = null;

    if (formato === "xlsx" || formato === "xls") {
      mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      extensao = "xlsx";
      isXlsx = true;

      // Cabeçalho na ordem do layout, com "Pedido origem" prepended pra rastreabilidade.
      const cabecalho = [COLUNA_ORIGEM, ...colsAtivas.map((c: any) => c.nome_coluna)];
      const linhas: any[][] = [cabecalho];

      for (const pedido of pedidos) {
        const camposPedido = montarCamposPedido(pedido, mapeamento);
        const itens = itensPorPedido.get(pedido.id) ?? (pedido.json_ia_bruto?.itens ?? []);
        const numeroOrigem = camposPedido.numero_pedido_cliente || pedido.numero || pedido.id;
        if (itens.length === 0) continue;
        for (const item of itens) {
          const camposItem = montarCamposItem(item, contadorCodigos, mapeamento);
          linhas.push([
            numeroOrigem,
            ...colsAtivas.map((c: any) => valorDaColuna(c, camposPedido, camposItem)),
          ]);
          totalItens++;
        }
      }

      const ws = XLSX.utils.aoa_to_sheet(linhas);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Pedidos");
      xlsxBuffer = XLSX.write(wb, { type: "array", bookType: "xlsx" });

    } else if (formato === "csv" || formato === "txt") {
      mimeType = "text/csv";
      extensao = formato === "csv" ? "csv" : "txt";

      if (mapeamento.tem_cabecalho) {
        const nomes = [COLUNA_ORIGEM, ...colsAtivas.map((c: any) => c.nome_coluna)];
        conteudoArquivo += nomes.join(separador) + "\n";
      }

      for (const pedido of pedidos) {
        const camposPedido = montarCamposPedido(pedido, mapeamento);
        const itens = itensPorPedido.get(pedido.id) ?? (pedido.json_ia_bruto?.itens ?? []);
        const numeroOrigem = camposPedido.numero_pedido_cliente || pedido.numero || pedido.id;
        if (itens.length === 0) continue;
        for (const item of itens) {
          const camposItem = montarCamposItem(item, contadorCodigos, mapeamento);
          const linha = [
            escaparCSV(String(numeroOrigem), separador),
            ...colsAtivas.map((c: any) =>
              escaparCSV(String(valorDaColuna(c, camposPedido, camposItem) ?? ""), separador),
            ),
          ];
          conteudoArquivo += linha.join(separador) + "\n";
          totalItens++;
        }
      }

    } else if (formato === "xml") {
      mimeType = "application/xml";
      extensao = "xml";

      conteudoArquivo = `<?xml version="1.0" encoding="UTF-8"?>\n<Pedidos>\n`;
      for (const pedido of pedidos) {
        const camposPedido = montarCamposPedido(pedido, mapeamento);
        const itens = itensPorPedido.get(pedido.id) ?? (pedido.json_ia_bruto?.itens ?? []);
        const numeroOrigem = String(camposPedido.numero_pedido_cliente || pedido.numero || pedido.id);
        conteudoArquivo += `  <Pedido pedido_origem="${escaparXML(numeroOrigem)}">\n    <Cabecalho>\n`;
        for (const col of colsPedido) {
          const tag = String(col.nome_coluna).replace(/\s/g, "_");
          const val = valorDaColuna(col, camposPedido, {});
          conteudoArquivo += `      <${tag}>${escaparXML(String(val ?? ""))}</${tag}>\n`;
        }
        conteudoArquivo += `    </Cabecalho>\n    <Itens>\n`;
        for (const item of itens) {
          const camposItem = montarCamposItem(item, contadorCodigos, mapeamento);
          conteudoArquivo += `      <Item>\n`;
          for (const col of colsItem) {
            const tag = String(col.nome_coluna).replace(/\s/g, "_");
            const val = valorDaColuna(col, camposPedido, camposItem);
            conteudoArquivo += `        <${tag}>${escaparXML(String(val ?? ""))}</${tag}>\n`;
          }
          conteudoArquivo += `      </Item>\n`;
          totalItens++;
        }
        conteudoArquivo += `    </Itens>\n  </Pedido>\n`;
      }
      conteudoArquivo += `</Pedidos>`;

    } else if (formato === "json") {
      mimeType = "application/json";
      extensao = "json";

      const obj = { pedidos: [] as any[] };
      for (const pedido of pedidos) {
        const camposPedido = montarCamposPedido(pedido, mapeamento);
        const itens = itensPorPedido.get(pedido.id) ?? (pedido.json_ia_bruto?.itens ?? []);
        const cabecalho: any = {};
        for (const col of colsPedido) cabecalho[col.nome_coluna] = valorDaColuna(col, camposPedido, {}) ?? "";
        const itensJson = itens.map((item: any) => {
          const camposItem = montarCamposItem(item, contadorCodigos, mapeamento);
          totalItens++;
          const out: any = {};
          for (const col of colsItem) out[col.nome_coluna] = valorDaColuna(col, camposPedido, camposItem) ?? "";
          return out;
        });
        obj.pedidos.push({
          pedido_origem: camposPedido.numero_pedido_cliente || pedido.numero || pedido.id,
          cabecalho,
          itens: itensJson,
        });
      }
      conteudoArquivo = JSON.stringify(obj, null, 2);

    } else {
      mimeType = "text/csv";
      extensao = "csv";
      conteudoArquivo = `${COLUNA_ORIGEM};numero_pedido;empresa;valor_total\n`;
      for (const pedido of pedidos) {
        const camposPedido = montarCamposPedido(pedido, mapeamento);
        const numero = camposPedido.numero_pedido_cliente || pedido.numero || pedido.id;
        conteudoArquivo += `${numero};${camposPedido.numero_pedido_cliente};${camposPedido.empresa};${camposPedido.valor_total}\n`;
      }
    }

    // 4. Marca todos os pedidos como exportados
    await fetch(
      `${SUPABASE_URL}/rest/v1/pedidos?id=in.(${idsParam})&tenant_id=eq.${tenantId}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          apikey: serviceRole,
          Authorization: `Bearer ${serviceRole}`,
        },
        body: JSON.stringify({
          exportado: true,
          exportado_em: new Date().toISOString(),
          exportacao_metodo: "arquivo_lote",
        }),
      },
    );

    const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
    const filename = `pedidos_lote_${stamp}.${extensao}`;

    let base64: string;
    if (isXlsx && xlsxBuffer) {
      let binary = "";
      for (let i = 0; i < xlsxBuffer.length; i++) binary += String.fromCharCode(xlsxBuffer[i]);
      base64 = btoa(binary);
    } else {
      base64 = btoa(unescape(encodeURIComponent(conteudoArquivo)));
    }

    return jsonResp(200, {
      success: true,
      arquivo: base64,
      filename,
      mime_type: mimeType,
      formato,
      total_pedidos: pedidos.length,
      total_itens: totalItens,
    });
  } catch (e) {
    console.error("Erro:", (e as Error).message);
    await registrarErro("edge_function_error", "exportar-pedidos-lote", (e as Error).message, {
      severidade: "alta",
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
    const sr = getServiceRole();
    if (!sr) return;
    await fetch(`${SUPABASE_URL}/functions/v1/registrar-erro`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${sr}` },
      body: JSON.stringify({ tipo, origem, mensagem, ...opts }),
    });
  } catch {
    // best-effort
  }
}

// Helpers de exportação compartilhados em supabase/functions/_shared/exportador-helpers.ts
