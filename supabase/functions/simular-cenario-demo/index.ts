import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";
import {
  CATALOGO_DEMO,
  DEMO_CNPJ_COMPRADOR,
  DEMO_NOME_COMPRADOR,
  DEMO_TENANT_ID,
} from "../_shared/demo-seed.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL_PUB = "https://arihejdirnhmcwuhkzde.supabase.co";

type Cenario =
  | "pedido_simples"
  | "pedido_multiplos_pdfs"
  | "pedido_codigos_novos"
  | "pedido_duplicado"
  | "pedido_erro_leitura"
  | "pedido_mal_escaneado"
  | "pedido_grande"
  | "pedido_encaminhado"
  | "pedido_com_ean"
  | "pedido_sem_ean";

interface ReqBody { tenant_id?: string; cenario: Cenario }

interface ItemSimulado {
  codigo_cliente: string;
  descricao: string;
  ean: string | null;
  quantidade: number;
  preco_unitario: number;
}

const SUPABASE_URL = SUPABASE_URL_PUB;

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

    const body = (await req.json()) as ReqBody;
    const cenario = body.cenario;
    if (!cenario) return jsonResp(400, { error: "cenario obrigatório" });

    const tenantId = body.tenant_id ?? DEMO_TENANT_ID;
    if (tenantId !== DEMO_TENANT_ID) return jsonResp(400, { error: "Apenas o tenant Demo aceita simulações." });

    const admin = createClient(supaUrl, serviceRole);

    if (cenario === "pedido_multiplos_pdfs") {
      const pedidosCriados: string[] = [];
      for (let i = 0; i < 3; i++) {
        const r = await processarUmCenario("pedido_simples", tenantId, serviceRole, admin, i + 1);
        if (r) pedidosCriados.push(r);
      }
      return jsonResp(200, { success: true, pedidos: pedidosCriados, cenario, multi: true });
    }

    const pedidoId = await processarUmCenario(cenario, tenantId, serviceRole, admin, 0);
    return jsonResp(200, { success: true, pedido_id: pedidoId, cenario });
  } catch (e) {
    console.error("Erro em simular-cenario-demo:", (e as Error).message);
    return jsonResp(500, { error: (e as Error).message });
  }
});

async function processarUmCenario(
  cenario: Cenario,
  tenantId: string,
  serviceRole: string,
  admin: any,
  variant: number,
): Promise<string | null> {
  const itens = escolherItens(cenario);
  const numeroPedido = `DEMO-${Date.now().toString().slice(-7)}${variant}`;
  const pdfBytes = cenario === "pedido_erro_leitura"
    ? gerarBytesCorrompidos()
    : await gerarPdf(numeroPedido, itens, cenario === "pedido_mal_escaneado");

  const pdfUrl = await uploadPdf(pdfBytes, tenantId, cenario, numeroPedido, serviceRole);

  const valorTotal = itens.reduce((acc, it) => acc + it.quantidade * it.preco_unitario, 0);

  let status = "pendente";
  let duplicadoDe: string | null = null;
  if (cenario === "pedido_erro_leitura") status = "erro";

  if (cenario === "pedido_duplicado") {
    const { data: existente } = await admin
      .from("pedidos")
      .select("numero_pedido_cliente")
      .eq("tenant_id", tenantId)
      .eq("status", "pendente")
      .order("created_at", { ascending: false })
      .limit(1);
    if (existente && existente.length > 0 && existente[0].numero_pedido_cliente) {
      duplicadoDe = existente[0].numero_pedido_cliente;
      status = "duplicado";
    }
  }

  const emailRemetente = cenario === "pedido_encaminhado"
    ? "Fwd: comprador@atacadaodemo.com.br"
    : "comprador@atacadaodemo.com.br";

  const { data: pedidoIns, error: pedidoErr } = await admin
    .from("pedidos")
    .insert({
      tenant_id: tenantId,
      empresa: DEMO_NOME_COMPRADOR,
      cnpj: DEMO_CNPJ_COMPRADOR,
      numero_pedido_cliente: duplicadoDe ?? numeroPedido,
      data_emissao: new Date().toISOString().slice(0, 10),
      data_entrega_solicitada: new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10),
      valor_total: valorTotal,
      confianca_ia: cenario === "pedido_mal_escaneado" ? 0.5 : 0.95,
      status,
      assunto_email: `[Pedido] Demo cenário ${cenario}`,
      remetente_email: emailRemetente,
      email_remetente: emailRemetente,
      canal_entrada: "demo",
      pdf_url: pdfUrl,
      json_ia_bruto: JSON.stringify({ demo: true, cenario }),
    })
    .select("id")
    .single();
  if (pedidoErr || !pedidoIns) {
    console.error("Falha ao inserir pedido demo:", pedidoErr);
    return null;
  }
  const pedidoId = (pedidoIns as any).id as string;

  if (status === "erro") {
    await admin.from("notificacoes_painel").insert({
      tenant_id: tenantId,
      tipo: "erro_leitura",
      titulo: "Pedido com erro de leitura",
      mensagem: `Pedido ${numeroPedido} não pôde ser lido (PDF inválido). Abra para revisar.`,
      link: `/pedido/${pedidoId}`,
    });
    return pedidoId;
  }

  const itensPayload = itens.map((it, idx) => ({
    pedido_id: pedidoId,
    tenant_id: tenantId,
    numero_item: idx + 1,
    codigo_cliente: it.codigo_cliente,
    descricao: it.descricao,
    ean: it.ean,
    unidade_medida: "UN",
    quantidade: it.quantidade,
    preco_unitario: it.preco_unitario,
    preco_total: it.quantidade * it.preco_unitario,
  }));
  const { data: itensInseridos, error: itensErr } = await admin
    .from("pedido_itens")
    .insert(itensPayload)
    .select("id, codigo_cliente, descricao, ean");
  if (itensErr || !itensInseridos) {
    console.error("Falha ao inserir itens:", itensErr);
    return pedidoId;
  }

  if (status === "duplicado") {
    await admin.from("notificacoes_painel").insert({
      tenant_id: tenantId,
      tipo: "pedido_duplicado",
      titulo: "Pedido duplicado detectado",
      mensagem: `Pedido ${numeroPedido} caiu como duplicado. Abra para Arquivar ou Marcar como pedido novo.`,
      link: "/dashboard?statusFiltro=duplicado",
    });
    return pedidoId;
  }

  const pendentesCount = await aplicarDeParaELevantarPendencias(
    pedidoId, tenantId, itensInseridos as any[], serviceRole,
  );

  // Aplica comportamento_codigo_novo (default aprovar_parcial).
  const { data: cfgRow } = await admin
    .from("configuracoes")
    .select("valor")
    .eq("tenant_id", tenantId)
    .eq("chave", "comportamento_codigo_novo")
    .maybeSingle();
  const comportamento = ((cfgRow as any)?.valor ?? "aprovar_parcial") as
    | "bloquear" | "aprovar_original" | "aprovar_parcial";

  let statusFinal = status;
  if (pendentesCount > 0 && comportamento === "bloquear") statusFinal = "aguardando_de_para";
  else if (pendentesCount > 0 && comportamento === "aprovar_parcial") statusFinal = "aprovado_parcial";

  if (statusFinal !== status) {
    await admin.from("pedidos").update({ status: statusFinal }).eq("id", pedidoId);
  }

  if (pendentesCount > 0) {
    await admin.from("notificacoes_painel").insert({
      tenant_id: tenantId,
      tipo: "codigos_novos",
      titulo: "Pedido demo com códigos novos",
      mensagem: `${pendentesCount} item(ns) sem DE-PARA aguardando confirmação no pedido ${numeroPedido}.`,
    });
  }

  return pedidoId;
}

function escolherItens(cenario: Cenario): ItemSimulado[] {
  // Helpers para mapear catálogo → item simulado
  const itemDeCatalogo = (codigoErp: string, codigoCliente: string, options?: { sem_ean?: boolean }) => {
    const prod = CATALOGO_DEMO.find((p) => p.codigo_erp === codigoErp);
    if (!prod) throw new Error("produto não encontrado: " + codigoErp);
    return {
      codigo_cliente: codigoCliente,
      descricao: prod.descricao,
      ean: options?.sem_ean ? null : prod.ean,
      quantidade: Math.floor(Math.random() * 20) + 5,
      preco_unitario: Math.round((Math.random() * 50 + 5) * 100) / 100,
    };
  };

  switch (cenario) {
    case "pedido_simples":
    case "pedido_encaminhado":
    case "pedido_duplicado":
    case "pedido_mal_escaneado":
      return [
        itemDeCatalogo("ALIM-001", "ATC-A1"),
        itemDeCatalogo("ALIM-002", "ATC-A2"),
        itemDeCatalogo("BEBI-001", "ATC-B1"),
        itemDeCatalogo("LIMP-001", "ATC-L1"),
        itemDeCatalogo("HIGI-001", "ATC-H1"),
      ];
    case "pedido_codigos_novos":
      // 2 com DE-PARA + 3 sem (códigos 6-8 não foram cobertos pelo seed)
      return [
        itemDeCatalogo("ALIM-001", "ATC-A1"),
        itemDeCatalogo("BEBI-001", "ATC-B1"),
        itemDeCatalogo("ALIM-006", "ATC-A6"),
        itemDeCatalogo("BEBI-007", "ATC-B7"),
        itemDeCatalogo("LIMP-008", "ATC-L8"),
      ];
    case "pedido_grande":
      return CATALOGO_DEMO.map((p, idx) => ({
        codigo_cliente: `ATC-X${idx + 1}`,
        descricao: p.descricao,
        ean: p.ean,
        quantidade: Math.floor(Math.random() * 10) + 1,
        preco_unitario: Math.round((Math.random() * 30 + 3) * 100) / 100,
      }));
    case "pedido_com_ean":
      return [
        itemDeCatalogo("ALIM-006", "ATC-A6"),
        itemDeCatalogo("BEBI-008", "ATC-B8"),
        itemDeCatalogo("LIMP-009", "ATC-L9"),
      ];
    case "pedido_sem_ean":
      return [
        itemDeCatalogo("HIGI-006", "ATC-H6", { sem_ean: true }),
        itemDeCatalogo("DIVE-007", "ATC-D7", { sem_ean: true }),
        itemDeCatalogo("ALIM-008", "ATC-A8", { sem_ean: true }),
      ];
    default:
      return [];
  }
}

async function gerarPdf(numeroPedido: string, itens: ItemSimulado[], malEscaneado: boolean): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]); // A4
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const tituloSize = malEscaneado ? 9 : 18;
  const corpoSize = malEscaneado ? 5 : 10;
  const headerSize = malEscaneado ? 5 : 9;

  page.drawText("PEDIDO DE COMPRA", {
    x: 50, y: 800, size: tituloSize, font: bold,
    color: rgb(malEscaneado ? 0.5 : 0.1, malEscaneado ? 0.5 : 0.1, malEscaneado ? 0.5 : 0.3),
  });
  page.drawText(`Nº ${numeroPedido}`, { x: 50, y: 780, size: corpoSize + 2, font });
  page.drawText(`Data: ${new Date().toLocaleDateString("pt-BR")}`, { x: 50, y: 765, size: corpoSize, font });

  page.drawText(`Comprador: ${DEMO_NOME_COMPRADOR}`, { x: 50, y: 740, size: corpoSize, font: bold });
  page.drawText(`CNPJ: ${DEMO_CNPJ_COMPRADOR}`, { x: 50, y: 725, size: corpoSize, font });

  // Cabeçalho da tabela
  let y = 690;
  page.drawText("Cód. Cliente", { x: 50, y, size: headerSize, font: bold });
  page.drawText("Descrição", { x: 130, y, size: headerSize, font: bold });
  page.drawText("Qtd", { x: 380, y, size: headerSize, font: bold });
  page.drawText("V. Unit.", { x: 430, y, size: headerSize, font: bold });
  page.drawText("Total", { x: 500, y, size: headerSize, font: bold });

  y -= 12;
  let total = 0;
  for (const it of itens) {
    if (y < 60) break;
    const subtotal = it.quantidade * it.preco_unitario;
    total += subtotal;
    page.drawText(it.codigo_cliente, { x: 50, y, size: corpoSize, font });
    page.drawText(it.descricao.slice(0, 38), { x: 130, y, size: corpoSize, font });
    page.drawText(String(it.quantidade), { x: 380, y, size: corpoSize, font });
    page.drawText(it.preco_unitario.toFixed(2), { x: 430, y, size: corpoSize, font });
    page.drawText(subtotal.toFixed(2), { x: 500, y, size: corpoSize, font });
    y -= malEscaneado ? 7 : 14;
  }

  page.drawText(`TOTAL: R$ ${total.toFixed(2)}`, {
    x: 400, y: Math.max(40, y - 16), size: corpoSize + 2, font: bold,
  });

  return await pdf.save();
}

function gerarBytesCorrompidos(): Uint8Array {
  const garbage = `%PDF-1.4\n%CORRUPTED DEMO\n${"\x00\x01\x02\x03".repeat(60)}`;
  return new TextEncoder().encode(garbage);
}

async function uploadPdf(
  bytes: Uint8Array,
  tenantId: string,
  cenario: string,
  numeroPedido: string,
  serviceRole: string,
): Promise<string | null> {
  const path = `${tenantId}/demo/${cenario}_${numeroPedido}.pdf`;
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/pedidos-pdf/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/pdf",
      apikey: serviceRole,
      Authorization: `Bearer ${serviceRole}`,
      "x-upsert": "true",
    },
    body: bytes,
  });
  if (!res.ok) {
    console.error("Falha upload PDF:", await res.text());
    return null;
  }
  return `${SUPABASE_URL}/storage/v1/object/public/pedidos-pdf/${path}`;
}

async function aplicarDeParaELevantarPendencias(
  pedidoId: string,
  tenantId: string,
  itens: Array<{ id: string; codigo_cliente: string | null; descricao: string | null; ean: string | null }>,
  serviceRole: string,
): Promise<number> {
  let pendentes = 0;
  for (const item of itens) {
    const codigoCliente = (item.codigo_cliente ?? "").trim();
    if (!codigoCliente) continue;

    const lookup = await fetch(
      `${SUPABASE_URL}/rest/v1/de_para?tenant_id=eq.${tenantId}&tipo=eq.PRODUTO_CODIGO&valor_origem=eq.${encodeURIComponent(codigoCliente)}&ativo=eq.true&select=valor_destino&limit=1`,
      { headers: { apikey: serviceRole, Authorization: `Bearer ${serviceRole}` } },
    );
    const matches = lookup.ok ? await lookup.json() : [];
    if (Array.isArray(matches) && matches.length > 0 && matches[0]?.valor_destino) {
      await fetch(`${SUPABASE_URL}/rest/v1/pedido_itens?id=eq.${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", apikey: serviceRole, Authorization: `Bearer ${serviceRole}` },
        body: JSON.stringify({ codigo_produto_erp: matches[0].valor_destino }),
      });
      continue;
    }

    let sugestoes: any[] = [];
    try {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/sugerir-de-para-ia`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceRole}` },
        body: JSON.stringify({
          tenant_id: tenantId,
          codigo_cliente: codigoCliente,
          descricao_pedido: item.descricao ?? "",
          ean: item.ean ?? "",
        }),
      });
      const json = await resp.json();
      sugestoes = Array.isArray(json?.sugestoes) ? json.sugestoes : [];
    } catch (e) {
      console.error("sugerir-de-para-ia falhou no demo:", (e as Error).message);
    }

    await fetch(`${SUPABASE_URL}/rest/v1/pedido_itens_pendentes_de_para`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceRole,
        Authorization: `Bearer ${serviceRole}`,
        Prefer: "resolution=ignore-duplicates",
      },
      body: JSON.stringify({
        pedido_id: pedidoId,
        pedido_item_id: item.id,
        tenant_id: tenantId,
        codigo_cliente: codigoCliente,
        descricao_pedido: item.descricao ?? null,
        sugestoes_ia: sugestoes,
      }),
    });
    pendentes++;
  }
  return pendentes;
}

function jsonResp(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
