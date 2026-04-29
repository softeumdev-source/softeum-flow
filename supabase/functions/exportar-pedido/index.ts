import * as XLSX from "https://cdn.sheetjs.com/xlsx-0.20.1/package/xlsx.mjs";
import {
  colunasOrdenadas, escaparCSV, escaparXML,
  montarCamposItem, montarCamposPedido, valorDaColuna,
} from "../_shared/exportador-helpers.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = "https://arihejdirnhmcwuhkzde.supabase.co";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { pedido_id, tenant_id } = await req.json();
    if (!pedido_id || !tenant_id) {
      return new Response(JSON.stringify({ error: "pedido_id e tenant_id são obrigatórios" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const serviceRole = Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY");
    if (!serviceRole) {
      return new Response(JSON.stringify({ error: "Secret não configurado" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1. Buscar mapeamento do ERP do tenant
    const configRes = await fetch(
      `${SUPABASE_URL}/rest/v1/tenant_erp_config?tenant_id=eq.${tenant_id}&select=*`,
      { headers: { apikey: serviceRole, Authorization: `Bearer ${serviceRole}` } },
    );
    const configs = await configRes.json();
    const config = configs[0];

    if (!config?.mapeamento_campos || !config.mapeamento_campos.colunas?.length) {
      return new Response(JSON.stringify({ error: "Mapeamento do ERP não encontrado. Acesse Integrações e salve o layout novamente." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const mapeamento = config.mapeamento_campos;

    // 2. Buscar dados do pedido
    const pedidoRes = await fetch(
      `${SUPABASE_URL}/rest/v1/pedidos?id=eq.${pedido_id}&select=*`,
      { headers: { apikey: serviceRole, Authorization: `Bearer ${serviceRole}` } },
    );
    const pedidos = await pedidoRes.json();
    const pedido = pedidos[0];

    if (!pedido) {
      return new Response(JSON.stringify({ error: "Pedido não encontrado" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ia = pedido.json_ia_bruto ?? {};
    const itensIA = ia.itens ?? [];

    // 3. Buscar itens da tabela pedido_itens
    const itensRes = await fetch(
      `${SUPABASE_URL}/rest/v1/pedido_itens?pedido_id=eq.${pedido_id}&select=*&order=numero_item.asc`,
      { headers: { apikey: serviceRole, Authorization: `Bearer ${serviceRole}` } },
    );
    const itensBanco = await itensRes.json();
    const itens = itensBanco.length > 0 ? itensBanco : itensIA;

    console.log(`Exportando pedido ${pedido_id} com ${itens.length} itens. Formato: ${mapeamento.formato}`);

    // 4. Montar campos do pedido (helpers compartilhados com fallbacks)
    const camposPedido = montarCamposPedido(pedido, mapeamento);

    // Colunas na ordem EXATA do layout subido pelo cliente.
    // (analisar-layout-erp já preserva a ordem do arquivo original.)
    const colsAtivas = colunasOrdenadas(mapeamento.colunas ?? []);
    // Mantém também os splits por tipo pra XML/JSON onde a estrutura
    // separa cabeçalho/itens.
    const colsPedido = colsAtivas.filter((c: any) => c.tipo !== "item");
    const colsItem = colsAtivas.filter((c: any) => c.tipo === "item");

    const formato = mapeamento.formato ?? "csv";
    const separadorRaw = mapeamento.separador ?? ";";
    const separador = separadorRaw === "tab" ? "\t" : separadorRaw === "pipe" ? "|" : separadorRaw;

    const contadorCodigos = { comDePara: 0, comOriginal: 0 };

    let conteudoArquivo = "";
    let mimeType = "text/plain";
    let extensao = "txt";
    let isXlsx = false;
    let xlsxBuffer: Uint8Array | null = null;

    if (formato === "xlsx" || formato === "xls") {
      mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      extensao = "xlsx";
      isXlsx = true;

      // Cabeçalho na ORDEM EXATA do layout original
      const cabecalho = colsAtivas.map((c: any) => c.nome_coluna);
      const linhas: any[][] = [cabecalho];
      for (const item of itens) {
        const camposItem = montarCamposItem(item, contadorCodigos);
        linhas.push(colsAtivas.map((c: any) => valorDaColuna(c, camposPedido, camposItem)));
      }

      const ws = XLSX.utils.aoa_to_sheet(linhas);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Pedido");
      xlsxBuffer = XLSX.write(wb, { type: "array", bookType: "xlsx" });

    } else if (formato === "csv" || formato === "txt") {
      mimeType = "text/csv";
      extensao = formato === "csv" ? "csv" : "txt";

      if (mapeamento.tem_cabecalho) {
        conteudoArquivo += colsAtivas.map((c: any) => c.nome_coluna).join(separador) + "\n";
      }
      for (const item of itens) {
        const camposItem = montarCamposItem(item, contadorCodigos);
        const linha = colsAtivas.map((c: any) =>
          escaparCSV(String(valorDaColuna(c, camposPedido, camposItem) ?? ""), separador),
        );
        conteudoArquivo += linha.join(separador) + "\n";
      }

    } else if (formato === "xml") {
      mimeType = "application/xml";
      extensao = "xml";

      conteudoArquivo = `<?xml version="1.0" encoding="UTF-8"?>\n<Pedido>\n  <Cabecalho>\n`;
      for (const col of colsPedido) {
        const val = valorDaColuna(col, camposPedido, {});
        const tag = String(col.nome_coluna).replace(/\s/g, "_");
        conteudoArquivo += `    <${tag}>${escaparXML(String(val ?? ""))}</${tag}>\n`;
      }
      conteudoArquivo += `  </Cabecalho>\n  <Itens>\n`;
      for (const item of itens) {
        const camposItem = montarCamposItem(item, contadorCodigos);
        conteudoArquivo += `    <Item>\n`;
        for (const col of colsItem) {
          const tag = String(col.nome_coluna).replace(/\s/g, "_");
          const val = valorDaColuna(col, camposPedido, camposItem);
          conteudoArquivo += `      <${tag}>${escaparXML(String(val ?? ""))}</${tag}>\n`;
        }
        conteudoArquivo += `    </Item>\n`;
      }
      conteudoArquivo += `  </Itens>\n</Pedido>`;

    } else if (formato === "json") {
      mimeType = "application/json";
      extensao = "json";

      const obj: any = { cabecalho: {}, itens: [] };
      for (const col of colsPedido) {
        obj.cabecalho[col.nome_coluna] = valorDaColuna(col, camposPedido, {}) ?? "";
      }
      for (const item of itens) {
        const camposItem = montarCamposItem(item, contadorCodigos);
        const itemObj: any = {};
        for (const col of colsItem) {
          itemObj[col.nome_coluna] = valorDaColuna(col, camposPedido, camposItem) ?? "";
        }
        obj.itens.push(itemObj);
      }
      conteudoArquivo = JSON.stringify(obj, null, 2);

    } else {
      mimeType = "text/csv";
      extensao = "csv";
      conteudoArquivo = "numero_pedido;empresa;data;valor_total\n";
      conteudoArquivo += `${camposPedido.numero_pedido_cliente};${camposPedido.empresa};${camposPedido.data_emissao};${camposPedido.valor_total}\n`;
    }

    console.log(`Itens exportados: ${contadorCodigos.comDePara} com código DE-PARA, ${contadorCodigos.comOriginal} com código original`);

    // 5. Atualizar status do pedido
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

    const numeroPedido = camposPedido.numero_pedido_cliente || pedido_id;
    const filename = `pedido_${numeroPedido}.${extensao}`;

    console.log(`Exportação concluída. ${itens.length} itens. Arquivo: ${filename}`);

    // 6. Retornar arquivo em base64
    let base64: string;
    if (isXlsx && xlsxBuffer) {
      // Converter Uint8Array para base64
      let binary = "";
      for (let i = 0; i < xlsxBuffer.length; i++) {
        binary += String.fromCharCode(xlsxBuffer[i]);
      }
      base64 = btoa(binary);
    } else {
      base64 = btoa(unescape(encodeURIComponent(conteudoArquivo)));
    }

    return new Response(
      JSON.stringify({
        success: true,
        arquivo: base64,
        filename,
        mime_type: mimeType,
        formato,
        total_itens: itens.length,
        valor_total: camposPedido.valor_total,
        preview: isXlsx ? `Arquivo XLSX com ${itens.length} itens gerado` : conteudoArquivo.substring(0, 800),
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );

  } catch (e) {
    console.error("Erro:", (e as Error).message);
    await registrarErro("edge_function_error", "exportar-pedido", (e as Error).message, {
      severidade: "alta",
      detalhes: { stack: (e as Error).stack },
    });
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function registrarErro(
  tipo: string,
  origem: string,
  mensagem: string,
  opts: { detalhes?: any; tenant_id?: string | null; severidade?: "baixa" | "media" | "alta" | "critica" } = {},
): Promise<void> {
  try {
    const sr = Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY");
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
