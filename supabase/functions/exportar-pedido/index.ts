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

    if (!config?.mapeamento_campos) {
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

    // 3. Buscar itens do pedido
    const itensRes = await fetch(
      `${SUPABASE_URL}/rest/v1/itens_pedido?pedido_id=eq.${pedido_id}&select=*`,
      { headers: { apikey: serviceRole, Authorization: `Bearer ${serviceRole}` } },
    );
    const itens = await itensRes.json();

    console.log(`Exportando pedido ${pedido_id} com ${itens.length} itens. Formato: ${mapeamento.formato}`);

    // 4. Montar o arquivo conforme o formato mapeado
    let conteudoArquivo = "";
    let mimeType = "text/plain";
    let extensao = "txt";

    const formato = mapeamento.formato ?? "csv";
    const separador = mapeamento.separador === "pipe" ? "|"
      : mapeamento.separador === "\\t" ? "\t"
      : mapeamento.separador ?? ";";

    const colunas: any[] = mapeamento.colunas ?? [];

    // Mapa de campos do sistema para valores reais
    const camposPedido: Record<string, any> = {
      numero_pedido_cliente: pedido.numero_pedido_cliente ?? pedido.id,
      empresa: pedido.empresa ?? "",
      data_emissao: formatarData(pedido.created_at, colunas),
      cnpj: pedido.cnpj ?? "",
      endereco_faturamento: pedido.endereco_faturamento ?? "",
      cidade_faturamento: pedido.cidade_faturamento ?? "",
      estado_faturamento: pedido.estado_faturamento ?? "",
      cep_faturamento: pedido.cep_faturamento ?? "",
      telefone_comprador: pedido.telefone_comprador ?? "",
      email_comprador: pedido.email_comprador ?? "",
      remetente_email: pedido.remetente_email ?? "",
      observacoes_gerais: pedido.observacoes_gerais ?? "",
      condicao_pagamento: pedido.condicao_pagamento ?? "",
      valor_total: pedido.valor_total ?? "",
      valor_frete: pedido.valor_frete ?? "",
      valor_desconto: pedido.valor_desconto ?? "",
      transportadora: pedido.transportadora ?? "",
      tipo_frete: pedido.tipo_frete ?? "",
      endereco_entrega: pedido.endereco_entrega ?? "",
      cidade_entrega: pedido.cidade_entrega ?? "",
      estado_entrega: pedido.estado_entrega ?? "",
      cep_entrega: pedido.cep_entrega ?? "",
    };

    if (formato === "csv" || formato === "txt") {
      mimeType = "text/csv";
      extensao = formato === "csv" ? "csv" : "txt";

      const colsPedido = colunas.filter(c => c.tipo === "pedido");
      const colsItem = colunas.filter(c => c.tipo === "item");

      // Cabeçalho
      if (mapeamento.tem_cabecalho) {
        const nomesColunas = [...colsPedido, ...colsItem].map(c => c.nome_coluna);
        conteudoArquivo += nomesColunas.join(separador) + "\n";
      }

      // Uma linha por item
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

        const valoresPedido = colsPedido.map(c => escaparCSV(camposPedido[c.campo_sistema] ?? "", separador));
        const valoresItem = colsItem.map(c => escaparCSV(camposItem[c.campo_sistema] ?? "", separador));
        conteudoArquivo += [...valoresPedido, ...valoresItem].join(separador) + "\n";
      }

    } else if (formato === "xml") {
      mimeType = "application/xml";
      extensao = "xml";

      conteudoArquivo = `<?xml version="1.0" encoding="UTF-8"?>\n<Pedido>\n`;
      conteudoArquivo += `  <Cabecalho>\n`;
      for (const col of colunas.filter(c => c.tipo === "pedido")) {
        const val = camposPedido[col.campo_sistema] ?? "";
        conteudoArquivo += `    <${col.nome_coluna}>${escaparXML(String(val))}</${col.nome_coluna}>\n`;
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
        for (const col of colunas.filter(c => c.tipo === "item")) {
          const val = camposItem[col.campo_sistema] ?? "";
          conteudoArquivo += `      <${col.nome_coluna}>${escaparXML(String(val))}</${col.nome_coluna}>\n`;
        }
        conteudoArquivo += `    </Item>\n`;
      }
      conteudoArquivo += `  </Itens>\n</Pedido>`;

    } else if (formato === "json") {
      mimeType = "application/json";
      extensao = "json";

      const obj: any = { cabecalho: {}, itens: [] };
      for (const col of colunas.filter(c => c.tipo === "pedido")) {
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
        for (const col of colunas.filter(c => c.tipo === "item")) {
          itemObj[col.nome_coluna] = camposItem[col.campo_sistema] ?? "";
        }
        obj.itens.push(itemObj);
      }
      conteudoArquivo = JSON.stringify(obj, null, 2);
    } else {
      // fallback CSV
      mimeType = "text/csv";
      extensao = "csv";
      conteudoArquivo = "numero_pedido;data;valor_total\n";
      conteudoArquivo += `${pedido.numero_pedido_cliente ?? pedido.id};${pedido.created_at};${pedido.valor_total}\n`;
    }

    // 5. Salvar registro da exportação no banco
    await fetch(`${SUPABASE_URL}/rest/v1/exportacoes_pedido`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceRole,
        Authorization: `Bearer ${serviceRole}`,
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        pedido_id,
        tenant_id,
        formato,
        exportado_em: new Date().toISOString(),
        status: "exportado",
      }),
    });

    // 6. Atualizar status do pedido
    await fetch(`${SUPABASE_URL}/rest/v1/pedidos?id=eq.${pedido_id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceRole,
        Authorization: `Bearer ${serviceRole}`,
      },
      body: JSON.stringify({ status: "exportado" }),
    });

    console.log(`Exportação concluída. Arquivo: pedido_${pedido_id}.${extensao}`);

    // 7. Retornar arquivo em base64 + preview
    const base64 = btoa(unescape(encodeURIComponent(conteudoArquivo)));
    return new Response(
      JSON.stringify({
        success: true,
        arquivo: base64,
        filename: `pedido_${pedido.numero_pedido_cliente ?? pedido_id}.${extensao}`,
        mime_type: mimeType,
        formato,
        total_itens: itens.length,
        preview: conteudoArquivo.substring(0, 500),
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
  const col = colunas.find(c => c.campo_sistema === "data_emissao");
  const fmt = col?.formato_data ?? "DD/MM/YYYY";
  const d = new Date(dataISO);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = String(d.getFullYear());
  if (fmt === "YYYY-MM-DD") return `${yyyy}-${mm}-${dd}`;
  return `${dd}/${mm}/${yyyy}`;
}
