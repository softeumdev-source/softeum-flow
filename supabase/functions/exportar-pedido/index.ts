import * as XLSX from "npm:xlsx@0.18.5";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import {
  escaparCSV,
  escaparXML,
  lerLinhasDoPedido,
  type Linha,
} from "../_shared/exportador-helpers.ts";
import { SUPABASE_URL, getServiceRole } from "../_shared/supabase-client.ts";
import { isServiceRoleCaller, requireTenantAccess } from "../_shared/authz.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// deno-lint-ignore no-explicit-any
type AnyObj = Record<string, any>;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { pedido_id } = await req.json();
    if (!pedido_id) {
      return jsonResp(400, { error: "pedido_id é obrigatório" });
    }

    const serviceRole = getServiceRole();
    if (!serviceRole) {
      return jsonResp(500, { error: "Service role não configurado" });
    }

    // 1. Buscar pedido (derivamos tenant_id pra validação de authz).
    const pedidoRes = await fetch(
      `${SUPABASE_URL}/rest/v1/pedidos?id=eq.${pedido_id}&select=*`,
      { headers: { apikey: serviceRole, Authorization: `Bearer ${serviceRole}` } },
    );
    const pedidos = await pedidoRes.json();
    const pedido = pedidos[0];
    if (!pedido) return jsonResp(404, { error: "Pedido não encontrado" });

    const tenant_id = pedido.tenant_id;

    // 2. Authz: super admin ou membro do tenant DO PEDIDO. Service role bypass.
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!isServiceRoleCaller(authHeader, serviceRole)) {
      const anon = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY");
      if (!anon) return jsonResp(500, { error: "Anon key não configurada" });

      const userClient = createClient(SUPABASE_URL, anon, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: userRes } = await userClient.auth.getUser();
      if (!userRes?.user) return jsonResp(401, { error: "Sessão inválida" });

      const authz = await requireTenantAccess(userClient, tenant_id);
      if (!authz.ok) {
        await registrarErro("authz_denied", "exportar-pedido",
          `User ${userRes.user.id} tentou exportar pedido ${pedido_id} do tenant ${tenant_id}`,
          { severidade: "alta", tenant_id, detalhes: { user_id: userRes.user.id, pedido_id } });
        return jsonResp(authz.status!, { error: authz.message });
      }
    }

    // 3. Mapeamento ERP do tenant — só usado pra cabeçalho (nomes/tipos
    // das colunas). Os VALORES vêm de pedido.dados_layout.linhas, já
    // pré-extraído pela Haiku quando o pedido entrou.
    const configRes = await fetch(
      `${SUPABASE_URL}/rest/v1/tenant_erp_config?tenant_id=eq.${tenant_id}&select=*`,
      { headers: { apikey: serviceRole, Authorization: `Bearer ${serviceRole}` } },
    );
    const configs = await configRes.json();
    const config = configs[0];
    if (!config?.mapeamento_campos?.colunas?.length) {
      return jsonResp(400, { error: "Mapeamento do ERP não encontrado. Acesse Integrações e salve o layout novamente." });
    }
    const mapeamento = config.mapeamento_campos;

    // 4. Linhas pré-extraídas pela Haiku na entrada (dados_layout.linhas).
    // Se vazio: pedido legado (entrou antes da Fase 2) ou Haiku falhou
    // — operador precisa reenviar o PDF pra reprocessar.
    const linhas = lerLinhasDoPedido(pedido);
    if (linhas.length === 0) {
      return jsonResp(400, {
        error: "Pedido sem dados extraídos (dados_layout vazio). Reenvie o PDF.",
      });
    }

    console.log(`Exportando pedido ${pedido_id} com ${linhas.length} linhas. Formato: ${mapeamento.formato}`);

    // 5. Geração do arquivo. Writers consomem `linhas` direto.
    const colsAtivas = (mapeamento.colunas ?? []).filter((c: AnyObj) => c?.nome_coluna);
    const colsPedido = colsAtivas.filter((c: AnyObj) => c.tipo !== "item");
    const colsItem = colsAtivas.filter((c: AnyObj) => c.tipo === "item");
    const formato = mapeamento.formato ?? "csv";
    const separadorRaw = mapeamento.separador ?? ";";
    const separador = separadorRaw === "tab" ? "\t" : separadorRaw === "pipe" ? "|" : separadorRaw;
    const valor = (linha: Linha, col: AnyObj) => linha[col.nome_coluna] ?? "";

    let conteudoArquivo = "";
    let mimeType = "text/plain";
    let extensao = "txt";
    let xlsxBuffer: Uint8Array | null = null;

    if (formato === "xlsx" || formato === "xls") {
      mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      extensao = "xlsx";
      const cabecalho = colsAtivas.map((c: AnyObj) => c.nome_coluna);
      const matriz: string[][] = [cabecalho];
      for (const linha of linhas) {
        matriz.push(colsAtivas.map((c: AnyObj) => valor(linha, c)));
      }
      const ws = XLSX.utils.aoa_to_sheet(matriz);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Pedido");
      xlsxBuffer = XLSX.write(wb, { type: "array", bookType: "xlsx" });
    } else if (formato === "csv" || formato === "txt") {
      mimeType = "text/csv";
      extensao = formato === "csv" ? "csv" : "txt";
      if (mapeamento.tem_cabecalho) {
        conteudoArquivo += colsAtivas.map((c: AnyObj) => c.nome_coluna).join(separador) + "\n";
      }
      for (const linha of linhas) {
        const celulas = colsAtivas.map((c: AnyObj) => escaparCSV(valor(linha, c), separador));
        conteudoArquivo += celulas.join(separador) + "\n";
      }
    } else if (formato === "xml") {
      mimeType = "application/xml";
      extensao = "xml";
      conteudoArquivo = `<?xml version="1.0" encoding="UTF-8"?>\n<Pedido>\n  <Cabecalho>\n`;
      const primeira = linhas[0] ?? {};
      for (const col of colsPedido) {
        const tag = String(col.nome_coluna).replace(/\s/g, "_");
        conteudoArquivo += `    <${tag}>${escaparXML(valor(primeira, col))}</${tag}>\n`;
      }
      conteudoArquivo += `  </Cabecalho>\n  <Itens>\n`;
      for (const linha of linhas) {
        conteudoArquivo += `    <Item>\n`;
        for (const col of colsItem) {
          const tag = String(col.nome_coluna).replace(/\s/g, "_");
          conteudoArquivo += `      <${tag}>${escaparXML(valor(linha, col))}</${tag}>\n`;
        }
        conteudoArquivo += `    </Item>\n`;
      }
      conteudoArquivo += `  </Itens>\n</Pedido>`;
    } else if (formato === "json") {
      mimeType = "application/json";
      extensao = "json";
      const primeira = linhas[0] ?? {};
      const cabecalho: AnyObj = {};
      for (const col of colsPedido) cabecalho[col.nome_coluna] = valor(primeira, col);
      const itensJson = linhas.map((linha) => {
        const out: AnyObj = {};
        for (const col of colsItem) out[col.nome_coluna] = valor(linha, col);
        return out;
      });
      conteudoArquivo = JSON.stringify({ cabecalho, itens: itensJson }, null, 2);
    } else {
      mimeType = "text/csv";
      extensao = "csv";
      conteudoArquivo = colsAtivas.map((c: AnyObj) => c.nome_coluna).join(";") + "\n";
      for (const linha of linhas) {
        conteudoArquivo += colsAtivas.map((c: AnyObj) => valor(linha, c)).join(";") + "\n";
      }
    }

    // 6. Marca pedido como exportado.
    await fetch(`${SUPABASE_URL}/rest/v1/pedidos?id=eq.${pedido_id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceRole,
        Authorization: `Bearer ${serviceRole}`,
      },
      body: JSON.stringify({
        exportado: true,
        exportado_em: new Date().toISOString(),
        exportacao_metodo: "arquivo",
      }),
    });

    const numeroPedido = (linhas[0] && Object.values(linhas[0])[0]) || pedido_id;
    const filename = `pedido_${numeroPedido}.${extensao}`;
    console.log(`Exportação concluída. ${linhas.length} linhas. Arquivo: ${filename}`);

    let base64: string;
    if (xlsxBuffer) {
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
      total_linhas: linhas.length,
      preview: xlsxBuffer
        ? `Arquivo XLSX com ${linhas.length} linhas gerado`
        : conteudoArquivo.substring(0, 800),
    });
  } catch (e) {
    const msg = (e as Error).message;
    console.error("Erro:", msg);
    await registrarErro("edge_function_error", "exportar-pedido", msg, {
      severidade: "alta",
      detalhes: { stack: (e as Error).stack },
    });
    return jsonResp(500, { error: msg });
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
  // deno-lint-ignore no-explicit-any
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
