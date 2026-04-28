import * as XLSX from "https://cdn.sheetjs.com/xlsx-0.20.1/package/xlsx.mjs";

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

    // 4. Montar campos do pedido
    const v = (campo: string, fallback: any = "") => pedido[campo] ?? ia[campo] ?? fallback;
    const valorTotalCalculado = itens.reduce((acc: number, it: any) => acc + (Number(it.preco_total) || 0), 0);

    const camposPedido: Record<string, any> = {
      numero_pedido_cliente: v("numero_pedido_cliente") || ia.numero_pedido || pedido.numero || "",
      empresa: v("empresa") || ia.empresa_cliente || "",
      nome_comprador: v("nome_comprador") || "",
      data_emissao: formatarData(v("data_emissao") || ia.data_pedido || pedido.created_at, mapeamento.colunas),
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
      // Gerar XLSX com SheetJS
      mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      extensao = "xlsx";
      isXlsx = true;

      const colsItemCSV = colunas.filter((c: any) => c.tipo === "item" && c.campo_sistema !== "não mapeado");

      // Montar cabeçalho
      const cabecalho = [...colsPedido, ...colsItemCSV].map((c: any) => c.nome_coluna);

      // Montar linhas
      const linhas: any[][] = [cabecalho];
      for (const item of itens) {
        const camposItem = montarCamposItem(item, contadorCodigos);
        const valoresPedido = colsPedido.map((c: any) => camposPedido[c.campo_sistema] ?? "");
        const valoresItem = colsItemCSV.map((c: any) => camposItem[c.campo_sistema] ?? "");
        linhas.push([...valoresPedido, ...valoresItem]);
      }

      const ws = XLSX.utils.aoa_to_sheet(linhas);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Pedido");
      xlsxBuffer = XLSX.write(wb, { type: "array", bookType: "xlsx" });

    } else if (formato === "csv" || formato === "txt") {
      mimeType = "text/csv";
      extensao = formato === "csv" ? "csv" : "txt";

      const colsItemCSV = colunas.filter((c: any) => c.tipo === "item" && c.campo_sistema !== "não mapeado");

      if (mapeamento.tem_cabecalho) {
        const nomes = [...colsPedido, ...colsItemCSV].map((c: any) => c.nome_coluna);
        conteudoArquivo += nomes.join(separador) + "\n";
      }

      for (const item of itens) {
        const camposItem = montarCamposItem(item, contadorCodigos);
        const valoresPedido = colsPedido.map((c: any) => escaparCSV(String(camposPedido[c.campo_sistema] ?? ""), separador));
        const valoresItem = colsItemCSV.map((c: any) => escaparCSV(String(camposItem[c.campo_sistema] ?? ""), separador));
        conteudoArquivo += [...valoresPedido, ...valoresItem].join(separador) + "\n";
      }

    } else if (formato === "xml") {
      mimeType = "application/xml";
      extensao = "xml";

      conteudoArquivo = `<?xml version="1.0" encoding="UTF-8"?>\n<Pedido>\n  <Cabecalho>\n`;
      for (const col of colsPedido) {
        const val = camposPedido[col.campo_sistema] ?? "";
        const tag = col.nome_coluna.replace(/\s/g, "_");
        conteudoArquivo += `    <${tag}>${escaparXML(String(val))}</${tag}>\n`;
      }
      conteudoArquivo += `  </Cabecalho>\n  <Itens>\n`;
      for (const item of itens) {
        const camposItem = montarCamposItem(item, contadorCodigos);
        conteudoArquivo += `    <Item>\n`;
        for (const col of colsItem) {
          const tag = col.nome_coluna.replace(/\s/g, "_");
          const val = camposItem[col.campo_sistema] ?? "";
          conteudoArquivo += `      <${tag}>${escaparXML(String(val))}</${tag}>\n`;
        }
        conteudoArquivo += `    </Item>\n`;
      }
      conteudoArquivo += `  </Itens>\n</Pedido>`;

    } else if (formato === "json") {
      mimeType = "application/json";
      extensao = "json";

      const obj: any = { cabecalho: {}, itens: [] };
      for (const col of colsPedido) {
        obj.cabecalho[col.nome_coluna] = camposPedido[col.campo_sistema] ?? "";
      }
      for (const item of itens) {
        const camposItem = montarCamposItem(item, contadorCodigos);
        const itemObj: any = {};
        for (const col of colsItem) {
          itemObj[col.nome_coluna] = camposItem[col.campo_sistema] ?? "";
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
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

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
