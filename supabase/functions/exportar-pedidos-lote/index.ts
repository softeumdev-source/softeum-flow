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

interface ReqBody {
  tenant_id: string;
  pedido_ids: string[];
}

// deno-lint-ignore no-explicit-any
type AnyObj = Record<string, any>;

interface PedidoLinhas {
  pedido: AnyObj;
  linhas: Linha[];
}

interface PedidoFalha {
  id: string;
  motivo: string;
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

    // Authz: super admin ou membro do tenant solicitado.
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

    // 1. Mapeamento ERP do tenant — só usado pra cabeçalho/ordem.
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

    // 2. Pedidos do batch (filtra por tenant pra defesa em profundidade).
    const idsParam = pedidoIds.map((id) => `"${id}"`).join(",");
    const pedidosRes = await fetch(
      `${SUPABASE_URL}/rest/v1/pedidos?id=in.(${idsParam})&tenant_id=eq.${tenantId}&select=*`,
      { headers: { apikey: serviceRole, Authorization: `Bearer ${serviceRole}` } },
    );
    const pedidos = await pedidosRes.json() as AnyObj[];
    if (pedidos.length === 0) return jsonResp(404, { error: "Nenhum pedido encontrado para o lote" });

    // 3. Particionar pedidos por presença de dados_layout.linhas.
    // Sem chamada externa, é uma leitura síncrona — loop simples.
    const sucesso: PedidoLinhas[] = [];
    const pedidosFalha: PedidoFalha[] = [];
    for (const pedido of pedidos) {
      const linhas = lerLinhasDoPedido(pedido);
      if (linhas.length === 0) {
        pedidosFalha.push({
          id: pedido.id,
          motivo: "Pedido sem dados extraídos (dados_layout vazio). Reenvie o PDF.",
        });
      } else {
        sucesso.push({ pedido, linhas });
      }
    }

    if (pedidosFalha.length > 0) {
      console.warn("[exportar-pedidos-lote] pedidos sem dados_layout", {
        tenant_id: tenantId,
        total: pedidos.length,
        sucesso: sucesso.length,
        falha: pedidosFalha.length,
        amostra: pedidosFalha.slice(0, 5),
      });
    }

    if (sucesso.length === 0) {
      return jsonResp(500, {
        error: "Nenhum pedido tem dados extraídos disponíveis para exportação",
        total_pedidos: pedidos.length,
        pedidos_falha: pedidosFalha,
      });
    }

    // 4. Geração do arquivo concatenado. Coluna "Pedido origem" sempre vai
    // como primeira coluna (planilhas/CSV/TXT) ou atributo (XML/JSON).
    const COLUNA_ORIGEM = "Pedido origem";
    const colsAtivas = (mapeamento.colunas ?? []).filter((c: AnyObj) => c?.nome_coluna);
    const colsPedido = colsAtivas.filter((c: AnyObj) => c.tipo !== "item");
    const colsItem = colsAtivas.filter((c: AnyObj) => c.tipo === "item");
    const formato = (mapeamento.formato ?? "csv") as string;
    const separadorRaw = mapeamento.separador ?? ";";
    const separador = separadorRaw === "tab" ? "\t" : separadorRaw === "pipe" ? "|" : separadorRaw;
    const valor = (linha: Linha, col: AnyObj) => linha[col.nome_coluna] ?? "";
    const numeroOrigemDe = (r: PedidoLinhas) =>
      String((r.linhas[0] && Object.values(r.linhas[0])[0]) || r.pedido.numero || r.pedido.id);

    let totalLinhas = 0;
    let conteudoArquivo = "";
    let mimeType = "text/plain";
    let extensao = "txt";
    let xlsxBuffer: Uint8Array | null = null;

    if (formato === "xlsx" || formato === "xls") {
      mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      extensao = "xlsx";
      const cabecalho = [COLUNA_ORIGEM, ...colsAtivas.map((c: AnyObj) => c.nome_coluna)];
      const matriz: string[][] = [cabecalho];
      for (const r of sucesso) {
        const num = numeroOrigemDe(r);
        for (const linha of r.linhas) {
          matriz.push([num, ...colsAtivas.map((c: AnyObj) => valor(linha, c))]);
          totalLinhas++;
        }
      }
      const ws = XLSX.utils.aoa_to_sheet(matriz);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Pedidos");
      xlsxBuffer = XLSX.write(wb, { type: "array", bookType: "xlsx" });
    } else if (formato === "csv" || formato === "txt") {
      mimeType = "text/csv";
      extensao = formato === "csv" ? "csv" : "txt";
      if (mapeamento.tem_cabecalho) {
        conteudoArquivo += [COLUNA_ORIGEM, ...colsAtivas.map((c: AnyObj) => c.nome_coluna)].join(separador) + "\n";
      }
      for (const r of sucesso) {
        const num = numeroOrigemDe(r);
        for (const linha of r.linhas) {
          const celulas = [
            escaparCSV(num, separador),
            ...colsAtivas.map((c: AnyObj) => escaparCSV(valor(linha, c), separador)),
          ];
          conteudoArquivo += celulas.join(separador) + "\n";
          totalLinhas++;
        }
      }
    } else if (formato === "xml") {
      mimeType = "application/xml";
      extensao = "xml";
      conteudoArquivo = `<?xml version="1.0" encoding="UTF-8"?>\n<Pedidos>\n`;
      for (const r of sucesso) {
        const num = numeroOrigemDe(r);
        const primeira = r.linhas[0] ?? {};
        conteudoArquivo += `  <Pedido pedido_origem="${escaparXML(num)}">\n    <Cabecalho>\n`;
        for (const col of colsPedido) {
          const tag = String(col.nome_coluna).replace(/\s/g, "_");
          conteudoArquivo += `      <${tag}>${escaparXML(valor(primeira, col))}</${tag}>\n`;
        }
        conteudoArquivo += `    </Cabecalho>\n    <Itens>\n`;
        for (const linha of r.linhas) {
          conteudoArquivo += `      <Item>\n`;
          for (const col of colsItem) {
            const tag = String(col.nome_coluna).replace(/\s/g, "_");
            conteudoArquivo += `        <${tag}>${escaparXML(valor(linha, col))}</${tag}>\n`;
          }
          conteudoArquivo += `      </Item>\n`;
          totalLinhas++;
        }
        conteudoArquivo += `    </Itens>\n  </Pedido>\n`;
      }
      conteudoArquivo += `</Pedidos>`;
    } else if (formato === "json") {
      mimeType = "application/json";
      extensao = "json";
      const obj = { pedidos: [] as AnyObj[] };
      for (const r of sucesso) {
        const primeira = r.linhas[0] ?? {};
        const cabecalho: AnyObj = {};
        for (const col of colsPedido) cabecalho[col.nome_coluna] = valor(primeira, col);
        const itensJson = r.linhas.map((linha) => {
          totalLinhas++;
          const out: AnyObj = {};
          for (const col of colsItem) out[col.nome_coluna] = valor(linha, col);
          return out;
        });
        obj.pedidos.push({ pedido_origem: numeroOrigemDe(r), cabecalho, itens: itensJson });
      }
      conteudoArquivo = JSON.stringify(obj, null, 2);
    } else {
      mimeType = "text/csv";
      extensao = "csv";
      conteudoArquivo = `${COLUNA_ORIGEM};${colsAtivas.map((c: AnyObj) => c.nome_coluna).join(";")}\n`;
      for (const r of sucesso) {
        const num = numeroOrigemDe(r);
        for (const linha of r.linhas) {
          conteudoArquivo += `${num};${colsAtivas.map((c: AnyObj) => valor(linha, c)).join(";")}\n`;
          totalLinhas++;
        }
      }
    }

    // 5. Marca como exportados APENAS os pedidos cujas linhas entraram
    // no arquivo. Pedidos sem dados_layout ficam intocados pra retry.
    const idsSucessoParam = sucesso.map((r) => `"${r.pedido.id}"`).join(",");
    await fetch(
      `${SUPABASE_URL}/rest/v1/pedidos?id=in.(${idsSucessoParam})&tenant_id=eq.${tenantId}`,
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
      total_pedidos: pedidos.length,
      total_sucesso: sucesso.length,
      total_linhas: totalLinhas,
      pedidos_falha: pedidosFalha,
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
