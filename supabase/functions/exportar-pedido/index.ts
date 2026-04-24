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

    // 1. Buscar configuração e mapeamento do ERP do tenant
    const configRes = await fetch(
      `${SUPABASE_URL}/rest/v1/tenant_erp_config?tenant_id=eq.${tenant_id}&select=*`,
      { headers: { apikey: serviceRole, Authorization: `Bearer ${serviceRole}` } },
    );
    const configs = await configRes.json();
    const config = configs[0];

    if (!config?.mapeamento_campos || !config.mapeamento_campos.colunas?.length) {
      return new Response(JSON.stringify({ error: "Mapeamento do ERP não encontrado. Execute analisar-layout-erp primeiro." }), {
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

    // 3. Extrair dados do json_ia_bruto como fallback
    const ia = pedido.json_ia_bruto ?? {};
    const itensIA = ia.itens ?? [];

    // 4. Buscar itens da tabela itens_pedido
    const itensRes = await fetch(
      `${SUPABASE_URL}/rest/v1/itens_pedido?pedido_id=eq.${pedido_id}&select=*`,
      { headers: { apikey: serviceRole, Authorization: `Bearer ${serviceRole}` } },
    );
    const itensBanco = await itensRes.json();

    // Usa itens do banco se existir, senão usa os do json_ia_bruto
    const itens = itensBanco.length > 0 ? itensBanco : itensIA;

    console.log(`Exportando pedido ${pedido_id} com ${itens.length} itens. Formato: ${mapeamento.formato}`);

    // 5. Montar mapa de campos do pedido — campo do banco tem prioridade, fallback para ia
    const v = (campo: string, fallback: any = "") => pedido[campo] ?? ia[campo] ?? fallback;

    // Calcular valor total a partir dos itens se não tiver no pedido
    const valorTotalCalculado = itens.reduce((acc: number, it: any) => acc + (Number(it.preco_total) || 0), 0);

    const camposPedido: Record<string, any> = {
      numero_pedido_cliente: v("numero_pedido_cliente") || ia.numero_pedido || pedido.numero || "",
      empresa: v("empresa") || ia.empresa_cliente || "",
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

    // 6. Montar arquivo conforme formato
    let conteudoArquivo = "";
    let mimeType = "text/plain";
    let extensao = "txt";

    const formato = mapeamento.formato ?? "csv";
    const separadorRaw = mapeamento.separador ?? ";";
    const separador = separadorRaw === "tab" ? "\t" : separadorRaw === "pipe" ? "|" : separadorRaw;

    const colunas: any[] = mapeamento.colunas ?? [];
    const colsPedido = colunas.filter((c: any) => c.tipo === "pedido" && c.campo_sistema !== "não mapeado");
    const colsItem = colunas.filter((c: any) => c.tipo === "item" && c.campo_sistema !== "não mapeado");

    if (formato === "csv" || formato === "txt") {
      mimeType = "text/csv";
      extensao = formato === "csv" ? "csv" : "txt";

      if (mapeamento.tem_cabecalho) {
        const nomes = [...colsPedido, ...colsItem].map((c: any) => c.nome_coluna);
        conteudoArquivo += nomes.join(separador) + "\n";
      }

      for (const item of itens) {
        const camposItem: Record<string, any> = {
          descricao: item.descricao ?? item.descricao ?? "",
          codigo_cliente: item.codigo_cliente ?? "",
          codigo_produto_erp: item.codigo_produto_erp ?? item.codigo_cliente ?? "",
          unidade_medida: item.unidade_medida ?? "UN",
          quantidade: item.quantidade ?? "",
          preco_unitario: item.preco_unitario ?? "",
          preco_total: item.preco_total ?? "",
        };

        const valoresPedido = colsPedido.map((c: any) => escaparCSV(String(camposPedido[c.campo_sistema] ?? ""), separador));
        const valoresItem = colsItem.map((c: any) => escaparCSV(String(camposItem[c.campo_sistema] ?? ""), separador));
        conteudoArquivo += [...valoresPedido, ...valoresItem].join(separador) + "\n";
      }

    } else if (formato === "xml") {
      mimeType = "application/xml";
      extensao = "xml";

      conteudoArquivo = `<?xml version="1.0" encoding="UTF-8"?>\n<Pedido>\n  <Cabecalho>\n`;
      for (const col of colsPedido) {
        const val = camposPedido[col.campo_sistema] ?? "";
        conteudoArquivo += `    <${col.nome_coluna.replace(/\s/g, "_")}>${escaparXML(String(val))}</${col.nome_coluna.replace(/\s/g, "_")}>\n`;
      }
      conteudoArquivo += `  </Cabecalho>\n  <Itens>\n`;

      for (const item of itens) {
        const camposItem: Record<string, any> = {
          descricao: item.descricao ?? "",
          codigo_cliente: item.codigo_cliente ?? "",
          codigo_produto_erp: item.codigo_produto_erp ?? item.codigo_cliente ?? "",
          unidade_medida: item.unidade_medida ?? "UN",
          quantidade: item.quantidade ?? "",
          preco_unitario: item.preco_unitario ?? "",
          preco_total: item.preco_total ?? "",
        };
        conteudoArquivo += `    <Item>\n`;
        for (const col of colsItem) {
          const val = camposItem[col.campo_sistema] ?? "";
          conteudoArquivo += `      <${col.nome_coluna.replace(/\s/g, "_")}>${escaparXML(String(val))}</${col.nome_coluna.replace(/\s/g, "_")}>\n`;
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
        const camposItem: Record<string, any> = {
          descricao: item.descricao ?? "",
          codigo_cliente: item.codigo_cliente ?? "",
          codigo_produto_erp: item.codigo_produto_erp ?? item.codigo_cliente ?? "",
          unidade_medida: item.unidade_medida ?? "UN",
          quantidade: item.quantidade ?? "",
          preco_unitario: item.preco_unitario ?? "",
          preco_total: item.preco_total ?? "",
        };
        const itemObj: any = {};
        for (const col of colsItem) {
          itemObj[col.nome_coluna] = camposItem[col.campo_sistema] ?? "";
        }
        obj.itens.push(itemObj);
      }
      conteudoArquivo = JSON.stringify(obj, null, 2);

    } else {
      // fallback CSV simples
      mimeType = "text/csv";
      extensao = "csv";
      conteudoArquivo = "numero_pedido;empresa;data;valor_total\n";
      conteudoArquivo += `${camposPedido.numero_pedido_cliente};${camposPedido.empresa};${camposPedido.data_emissao};${camposPedido.valor_total}\n`;
    }

    // 7. Atualizar status do pedido
    await fetch(`${SUPABASE_URL}/rest/v1/pedidos?id=eq.${pedido_id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceRole,
        Authorization: `Bearer ${serviceRole}`,
      },
      body: JSON.stringify({ status: "exportado", exportado: true, exportado_em: new Date().toISOString() }),
    });

    console.log(`Exportação concluída. Arquivo: pedido_${camposPedido.numero_pedido_cliente}.${extensao}`);

    // 8. Retornar arquivo em base64
    const base64 = btoa(unescape(encodeURIComponent(conteudoArquivo)));
    return new Response(
      JSON.stringify({
        success: true,
        arquivo: base64,
        filename: `pedido_${camposPedido.numero_pedido_cliente}.${extensao}`,
        mime_type: mimeType,
        formato,
        total_itens: itens.length,
        valor_total: camposPedido.valor_total,
        preview: conteudoArquivo.substring(0, 800),
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
