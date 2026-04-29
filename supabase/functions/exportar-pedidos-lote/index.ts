import * as XLSX from "https://cdn.sheetjs.com/xlsx-0.20.1/package/xlsx.mjs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = "https://arihejdirnhmcwuhkzde.supabase.co";

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

    const serviceRole = Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY");
    if (!serviceRole) return jsonResp(500, { error: "Service role não configurado" });

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

    const colunas: any[] = mapeamento.colunas ?? [];
    const colsPedido = colunas.filter((c: any) => c.tipo === "pedido" && c.campo_sistema !== "não mapeado");
    const colsItemVistos = new Set<string>();
    const colsItem = colunas
      .filter((c: any) => c.tipo === "item" && c.campo_sistema !== "não mapeado")
      .filter((c: any) => {
        if (colsItemVistos.has(c.nome_coluna)) return false;
        colsItemVistos.add(c.nome_coluna);
        return true;
      });

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

      const cabecalho = [COLUNA_ORIGEM, ...colsPedido.map((c: any) => c.nome_coluna), ...colsItem.map((c: any) => c.nome_coluna)];
      const linhas: any[][] = [cabecalho];

      for (const pedido of pedidos) {
        const camposPedido = montarCamposPedido(pedido, mapeamento);
        const itens = itensPorPedido.get(pedido.id) ?? (pedido.json_ia_bruto?.itens ?? []);
        const numeroOrigem = camposPedido.numero_pedido_cliente || pedido.numero || pedido.id;
        if (itens.length === 0) {
          // Pedido sem itens não vira linha — mantém a planilha enxuta.
          continue;
        }
        for (const item of itens) {
          const camposItem = montarCamposItem(item, contadorCodigos);
          linhas.push([
            numeroOrigem,
            ...colsPedido.map((c: any) => camposPedido[c.campo_sistema] ?? ""),
            ...colsItem.map((c: any) => camposItem[c.campo_sistema] ?? ""),
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
        const nomes = [COLUNA_ORIGEM, ...colsPedido.map((c: any) => c.nome_coluna), ...colsItem.map((c: any) => c.nome_coluna)];
        conteudoArquivo += nomes.join(separador) + "\n";
      }

      for (const pedido of pedidos) {
        const camposPedido = montarCamposPedido(pedido, mapeamento);
        const itens = itensPorPedido.get(pedido.id) ?? (pedido.json_ia_bruto?.itens ?? []);
        const numeroOrigem = camposPedido.numero_pedido_cliente || pedido.numero || pedido.id;
        if (itens.length === 0) continue;
        for (const item of itens) {
          const camposItem = montarCamposItem(item, contadorCodigos);
          const linha = [
            escaparCSV(String(numeroOrigem), separador),
            ...colsPedido.map((c: any) => escaparCSV(String(camposPedido[c.campo_sistema] ?? ""), separador)),
            ...colsItem.map((c: any) => escaparCSV(String(camposItem[c.campo_sistema] ?? ""), separador)),
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
          const tag = col.nome_coluna.replace(/\s/g, "_");
          conteudoArquivo += `      <${tag}>${escaparXML(String(camposPedido[col.campo_sistema] ?? ""))}</${tag}>\n`;
        }
        conteudoArquivo += `    </Cabecalho>\n    <Itens>\n`;
        for (const item of itens) {
          const camposItem = montarCamposItem(item, contadorCodigos);
          conteudoArquivo += `      <Item>\n`;
          for (const col of colsItem) {
            const tag = col.nome_coluna.replace(/\s/g, "_");
            conteudoArquivo += `        <${tag}>${escaparXML(String(camposItem[col.campo_sistema] ?? ""))}</${tag}>\n`;
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
        for (const col of colsPedido) cabecalho[col.nome_coluna] = camposPedido[col.campo_sistema] ?? "";
        const itensJson = itens.map((item: any) => {
          const camposItem = montarCamposItem(item, contadorCodigos);
          totalItens++;
          const out: any = {};
          for (const col of colsItem) out[col.nome_coluna] = camposItem[col.campo_sistema] ?? "";
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

function montarCamposPedido(pedido: any, mapeamento: any): Record<string, any> {
  const ia = pedido.json_ia_bruto ?? {};
  const v = (campo: string, fallback: any = "") => pedido[campo] ?? ia[campo] ?? fallback;
  const itensIA = ia.itens ?? [];
  const valorTotalCalculado = itensIA.reduce((acc: number, it: any) => acc + (Number(it.preco_total) || 0), 0);

  return {
    numero_pedido_cliente: v("numero_pedido_cliente") || ia.numero_pedido || pedido.numero || "",
    empresa: v("empresa") || ia.empresa_cliente || "",
    nome_comprador: v("nome_comprador") || "",
    data_emissao: formatarData(v("data_emissao") || ia.data_pedido || pedido.created_at, mapeamento.colunas ?? []),
    cnpj: v("cnpj") || ia.cnpj || "",
    endereco_faturamento: v("endereco_faturamento") || "",
    cidade_faturamento: v("cidade_faturamento") || "",
    estado_faturamento: v("estado_faturamento") || "",
    cep_faturamento: v("cep_faturamento") || "",
    telefone_comprador: v("telefone_comprador") || "",
    email_comprador: v("email_comprador") || pedido.remetente_email || "",
    remetente_email: v("remetente_email") || pedido.remetente_email || "",
    observacoes_gerais: v("observacoes_gerais") || ia.observacoes || "",
    condicao_pagamento: v("condicao_pagamento") || ia.condicao_pagamento || "",
    valor_total: v("valor_total") || ia.valor_total || valorTotalCalculado || "",
    valor_frete: v("valor_frete") || ia.valor_frete || "",
    valor_desconto: v("valor_desconto") || ia.valor_desconto || "",
    transportadora: v("transportadora") || "",
    tipo_frete: v("tipo_frete") || "",
    endereco_entrega: v("endereco_entrega") || "",
    cidade_entrega: v("cidade_entrega") || "",
    estado_entrega: v("estado_entrega") || "",
    cep_entrega: v("cep_entrega") || "",
  };
}

function montarCamposItem(item: any, contador: { comDePara: number; comOriginal: number }): Record<string, any> {
  const codErp = String(item.codigo_produto_erp ?? "").trim();
  const codCliente = String(item.codigo_cliente ?? "").trim();
  const usouDePara = codErp !== "";
  if (usouDePara) contador.comDePara++;
  else contador.comOriginal++;

  return {
    descricao: item.descricao ?? "",
    codigo_cliente: item.codigo_cliente ?? "",
    codigo_produto_erp: usouDePara ? codErp : codCliente,
    unidade_medida: item.unidade_medida ?? "UN",
    quantidade: item.quantidade ?? "",
    preco_unitario: item.preco_unitario ?? "",
    preco_total: item.preco_total ?? "",
    referencia: item.referencia ?? "",
    marca: item.marca ?? "",
    desconto: item.desconto ?? "",
    observacao_item: item.observacao_item ?? "",
  };
}

function escaparCSV(valor: string, sep: string): string {
  const s = String(valor);
  if (s.includes(sep) || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function escaparXML(valor: string): string {
  return valor
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function formatarData(dataISO: string, colunas: any[]): string {
  if (!dataISO) return "";
  const col = colunas.find((c: any) => c.campo_sistema === "data_emissao");
  const fmt = col?.formato_data ?? "DD/MM/YYYY";
  const d = new Date(dataISO);
  if (isNaN(d.getTime())) return dataISO;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = String(d.getFullYear());
  if (fmt === "YYYY-MM-DD") return `${yyyy}-${mm}-${dd}`;
  return `${dd}/${mm}/${yyyy}`;
}
