const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = "https://arihejdirnhmcwuhkzde.supabase.co";

function gerarEmailHTML(status: string, pedido: any, nomeIndustria: string, motivoReprovacao?: string): { assunto: string; html: string } {
  const configs: Record<string, { cor: string; icone: string; titulo: string; mensagem: string }> = {
    pendente: {
      cor: "#2196F3",
      icone: "⏳",
      titulo: "Pedido recebido e em análise",
      mensagem: "Seu pedido foi recebido com sucesso e está sendo analisado por nossa equipe. Em breve você receberá uma confirmação.",
    },
    aprovado: {
      cor: "#4CAF50",
      icone: "✅",
      titulo: "Pedido aprovado!",
      mensagem: "Ótima notícia! Seu pedido foi aprovado e será processado pela nossa equipe. Entraremos em contato para confirmar os próximos passos.",
    },
    reprovado: {
      cor: "#F44336",
      icone: "❌",
      titulo: "Pedido reprovado",
      mensagem: motivoReprovacao
        ? `Informamos que seu pedido não pôde ser aprovado. Motivo: ${motivoReprovacao}`
        : "Informamos que seu pedido não pôde ser aprovado no momento. Entre em contato conosco para mais informações.",
    },
    duplicado: {
      cor: "#FF9800",
      icone: "⚠️",
      titulo: "Pedido duplicado identificado",
      mensagem: "Identificamos que este pedido já foi recebido anteriormente pelo nosso sistema. Caso tenha dúvidas, entre em contato conosco.",
    },
    aprovado_parcial: {
      cor: "#3B82F6",
      icone: "🟢",
      titulo: "Pedido aprovado parcialmente",
      mensagem: "Seu pedido foi aprovado pela nossa equipe e será processado. Alguns itens passaram por ajustes na confirmação dos códigos — os detalhes finais serão alinhados em breve pelo time comercial.",
    },
    aguardando_de_para: {
      cor: "#FF9800",
      icone: "🔍",
      titulo: "Pedido recebido — em revisão de códigos",
      mensagem: "Recebemos seu pedido com sucesso. Alguns códigos de produtos precisam ser revisados pela nossa equipe antes de seguir para aprovação final. Você receberá uma confirmação assim que a revisão terminar.",
    },
  };

  const config = configs[status] ?? configs.pendente;
  const numeroPedido = pedido.numero_pedido_cliente ?? "—";
  const empresa = pedido.empresa ?? "—";
  const dataEmissao = pedido.data_emissao
    ? new Date(pedido.data_emissao).toLocaleDateString("pt-BR")
    : new Date().toLocaleDateString("pt-BR");
  const valorTotal = pedido.valor_total
    ? `R$ ${Number(pedido.valor_total).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
    : null;

  const assunto = `${config.icone} ${config.titulo} - Pedido Nº ${numeroPedido}`;

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${config.titulo}</title>
</head>
<body style="margin:0;padding:0;background-color:#f0f2f5;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f0f2f5;padding:30px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
          <tr>
            <td style="background:linear-gradient(135deg,#1a1a2e,#16213e);padding:32px 40px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;letter-spacing:1px;">${nomeIndustria}</h1>
              <p style="margin:6px 0 0;color:#90A4AE;font-size:13px;letter-spacing:0.5px;">CONFIRMAÇÃO DE PEDIDO</p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 40px 20px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-left:4px solid ${config.cor};padding:16px 20px;background:#f8f9fa;border-radius:0 8px 8px 0;">
                    <p style="margin:0;font-size:20px;font-weight:700;color:#263238;">${config.icone} ${config.titulo}</p>
                    <p style="margin:8px 0 0;font-size:14px;color:#546E7A;line-height:1.6;">${config.mensagem}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:0 40px 30px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e0e0e0;border-radius:8px;overflow:hidden;">
                <tr style="background:#ECEFF1;">
                  <td colspan="2" style="padding:12px 20px;font-weight:700;font-size:12px;color:#546E7A;text-transform:uppercase;letter-spacing:1px;">Detalhes do pedido</td>
                </tr>
                <tr>
                  <td style="padding:14px 20px;border-top:1px solid #eee;font-size:14px;color:#78909C;width:50%;">Nº do pedido</td>
                  <td style="padding:14px 20px;border-top:1px solid #eee;font-size:14px;font-weight:700;color:#263238;text-align:right;">${numeroPedido}</td>
                </tr>
                <tr style="background:#fafafa;">
                  <td style="padding:14px 20px;border-top:1px solid #eee;font-size:14px;color:#78909C;">Empresa</td>
                  <td style="padding:14px 20px;border-top:1px solid #eee;font-size:14px;font-weight:700;color:#263238;text-align:right;">${empresa}</td>
                </tr>
                <tr>
                  <td style="padding:14px 20px;border-top:1px solid #eee;font-size:14px;color:#78909C;">Data do pedido</td>
                  <td style="padding:14px 20px;border-top:1px solid #eee;font-size:14px;font-weight:700;color:#263238;text-align:right;">${dataEmissao}</td>
                </tr>
                ${valorTotal ? `
                <tr style="background:#fafafa;">
                  <td style="padding:14px 20px;border-top:1px solid #eee;font-size:14px;color:#78909C;">Valor total</td>
                  <td style="padding:14px 20px;border-top:1px solid #eee;font-size:16px;font-weight:700;color:#1a1a2e;text-align:right;">${valorTotal}</td>
                </tr>` : ""}
                <tr style="background:#fafafa;">
                  <td style="padding:14px 20px;border-top:1px solid #eee;font-size:14px;color:#78909C;">Status</td>
                  <td style="padding:14px 20px;border-top:1px solid #eee;text-align:right;">
                    <span style="background:${config.cor};color:#fff;font-size:12px;font-weight:700;padding:5px 14px;border-radius:20px;text-transform:uppercase;letter-spacing:0.5px;">${status}</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="background:#ECEFF1;padding:20px 40px;text-align:center;border-top:1px solid #e0e0e0;">
              <p style="margin:0;font-size:13px;color:#78909C;">⚠️ Este é um e-mail automático. Por favor, <strong>não responda</strong> a esta mensagem.</p>
              <p style="margin:6px 0 0;font-size:12px;color:#90A4AE;">Para dúvidas, entre em contato diretamente com nossa equipe comercial.</p>
              <p style="margin:10px 0 0;font-size:11px;color:#B0BEC5;">${nomeIndustria} · Sistema automatizado de pedidos</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { assunto, html };
}

async function renovarToken(config: any, serviceRole: string): Promise<string> {
  const clientId = Deno.env.get("GMAIL_CLIENT_ID");
  const clientSecret = Deno.env.get("GMAIL_CLIENT_SECRET");
  const refreshRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: config.refresh_token,
      client_id: clientId!,
      client_secret: clientSecret!,
    }),
  });
  const refreshJson = await refreshRes.json();
  if (!refreshRes.ok) throw new Error(`Falha ao renovar token: ${refreshJson.error}`);
  const novaExpiracao = new Date(Date.now() + (refreshJson.expires_in ?? 3600) * 1000).toISOString();
  await fetch(`${SUPABASE_URL}/rest/v1/tenant_gmail_config?tenant_id=eq.${config.tenant_id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", apikey: serviceRole, Authorization: `Bearer ${serviceRole}` },
    body: JSON.stringify({ access_token: refreshJson.access_token, token_expires_at: novaExpiracao }),
  });
  return refreshJson.access_token;
}

async function enviarEmail(
  accessToken: string,
  destinatario: string,
  assunto: string,
  html: string,
  replyTo?: string,
): Promise<any> {
  const boundary = "boundary_softeum_" + Date.now();
  const emailLines: string[] = [`To: ${destinatario}`];
  if (replyTo) emailLines.push(`Reply-To: ${replyTo}`);
  emailLines.push(
    `Subject: =?UTF-8?B?${btoa(unescape(encodeURIComponent(assunto)))}?=`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/html; charset=UTF-8`,
    `Content-Transfer-Encoding: base64`,
    ``,
    btoa(unescape(encodeURIComponent(html))),
    `--${boundary}--`,
  );
  const emailRaw = emailLines.join("\r\n");
  const emailBase64 = btoa(emailRaw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  return await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ raw: emailBase64 }),
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { pedido_id, status } = await req.json();

    if (!pedido_id || !status) {
      return new Response(JSON.stringify({ error: "pedido_id e status são obrigatórios" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const serviceRole = Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY");
    if (!serviceRole) {
      return new Response(JSON.stringify({ error: "Service role não configurado" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1. Buscar pedido
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

    // 2. Buscar configurações do tenant
    const cfgRes = await fetch(
      `${SUPABASE_URL}/rest/v1/configuracoes?tenant_id=eq.${pedido.tenant_id}&select=chave,valor`,
      { headers: { apikey: serviceRole, Authorization: `Bearer ${serviceRole}` } },
    );
    const cfgs = await cfgRes.json();
    const cfgMap: Record<string, string> = {};
    (cfgs ?? []).forEach((c: any) => { cfgMap[c.chave] = c.valor; });

    // 3. Verificar se notificações estão ativas
    const notifAtiva = cfgMap["notif_email_ativo"] === "true";
    if (!notifAtiva) {
      console.log("Notificações desativadas para tenant:", pedido.tenant_id);
      return new Response(JSON.stringify({ message: "Notificações desativadas" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 4. Verificar toggle específico do status
    // Cada status tem seu próprio toggle no /configuracoes do tenant.
    // notif_aprovacao_parcial e notif_aguardando_codigos são default-true
    // (ausência da chave em configuracoes = ligado), pra garantir que
    // o cliente seja avisado desses status novos sem o admin do tenant
    // precisar ativar manualmente. Os demais seguem default-false
    // (precisam estar explicitamente "true" no banco).
    const toggleMap: Record<string, string> = {
      pendente: "notif_recebimento",
      aprovado: "notif_aprovacao",
      aprovado_parcial: "notif_aprovacao_parcial",
      reprovado: "notif_reprovacao",
      duplicado: "notif_duplicado",
      aguardando_de_para: "notif_aguardando_codigos",
    };
    const DEFAULT_TRUE_TOGGLES = new Set(["notif_aprovacao_parcial", "notif_aguardando_codigos"]);
    const toggleKey = toggleMap[status];
    if (toggleKey) {
      const valor = cfgMap[toggleKey];
      const ativo = DEFAULT_TRUE_TOGGLES.has(toggleKey)
        ? valor !== "false"
        : valor === "true";
      if (!ativo) {
        console.log(`Toggle ${toggleKey} desativado para tenant:`, pedido.tenant_id);
        return new Response(JSON.stringify({ message: `Notificação de ${status} desativada` }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // 5. Buscar nome do tenant
    const tenantRes = await fetch(
      `${SUPABASE_URL}/rest/v1/tenants?id=eq.${pedido.tenant_id}&select=nome`,
      { headers: { apikey: serviceRole, Authorization: `Bearer ${serviceRole}` } },
    );
    const tenants = await tenantRes.json();
    const nomeIndustria = tenants[0]?.nome ?? "Indústria";

    // 6. Buscar config Gmail
    const gmailRes = await fetch(
      `${SUPABASE_URL}/rest/v1/tenant_gmail_config?tenant_id=eq.${pedido.tenant_id}&select=*`,
      { headers: { apikey: serviceRole, Authorization: `Bearer ${serviceRole}` } },
    );
    const gmailConfigs = await gmailRes.json();
    const gmailConfig = gmailConfigs[0];
    if (!gmailConfig?.access_token) {
      return new Response(JSON.stringify({ error: "Gmail não configurado" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 7. Renovar token se necessário
    let accessToken = gmailConfig.access_token;
    const expiresAt = new Date(gmailConfig.token_expires_at).getTime();
    if (Date.now() > expiresAt - 5 * 60 * 1000) {
      accessToken = await renovarToken(gmailConfig, serviceRole);
    }

    // 8. Determinar destinatário
    // Cadeia de prioridade resolvida em processar-email-pdf (PDF → headers
    // → fallbacks). Aqui só consumimos o resultado.
    const destinatario = (pedido.remetente_email ?? pedido.email_remetente ?? "").trim();

    if (!destinatario) {
      return new Response(JSON.stringify({ error: "Destinatário não encontrado no pedido" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 9. Claim do bucket de dedup via INSERT-first (race-free).
    // Índice UNIQUE bucketizado por minuto em
    // notificacoes_enviadas(pedido_id, status, minute_bucket(enviado_em)):
    // 2 invocações simultâneas no mesmo minuto pra (pedido, status)
    // só uma vence o INSERT (return=representation devolve a row);
    // a outra recebe array vazio (resolution=ignore-duplicates) e pula
    // sem enviar. Re-transições em minutos diferentes passam.
    const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/notificacoes_enviadas`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceRole,
        Authorization: `Bearer ${serviceRole}`,
        Prefer: "resolution=ignore-duplicates,return=representation",
      },
      body: JSON.stringify({
        pedido_id,
        status,
        enviado_em: new Date().toISOString(),
      }),
    });
    let claimedId: string | null = null;
    if (insertRes.status === 409) {
      // Conflict explícito do PostgREST: outro processo venceu o claim
      // do bucket. Não enviar — caso contrário 2 e-mails saem (bug
      // confirmado por print do Gmail). Distinto de 4xx/5xx genérico
      // abaixo, que seguia fail-open.
      console.log(`[dedup] conflito 409 pra (pedido=${pedido_id}, status=${status}) — outro processo já enviou — skip`);
      return new Response(JSON.stringify({ skipped: "conflito_concorrente", pedido_id, status }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!insertRes.ok) {
      // Outros 4xx/5xx (não 409): falha de schema/RLS/etc. Loga e segue
      // (fail-open) — não bloqueia notificação por problema de infra na
      // tabela de dedup.
      console.error(`[dedup] INSERT notificacoes_enviadas falhou status=${insertRes.status} body=${(await insertRes.text()).slice(0, 300)}`);
    } else {
      const insertJson = await insertRes.json();
      if (Array.isArray(insertJson) && insertJson.length === 0) {
        console.log(`[dedup] outro envio em andamento pra (pedido=${pedido_id}, status=${status}) neste minuto — skip`);
        return new Response(JSON.stringify({ skipped: "ja_enviada_recentemente", pedido_id, status }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      claimedId = insertJson[0]?.id ?? null;
      console.log(`[dedup] claim ok id=${claimedId} pedido=${pedido_id} status=${status}`);
    }

    // 10. Gerar e enviar email
    const { assunto, html } = gerarEmailHTML(status, pedido, nomeIndustria, pedido.motivo_reprovacao);
    console.log(`Enviando email de ${status} para: ${destinatario}`);

    // Reply-To protetivo: se a notificação cair em destinatário errado,
    // a resposta do destinatário volta pra Indústria B (e-mail do tenant).
    const replyToTenant = (gmailConfig.email ?? "").trim() || undefined;
    const sendRes = await enviarEmail(accessToken, destinatario, assunto, html, replyToTenant);
    const sendJson = await sendRes.json();

    if (!sendRes.ok) {
      // Rollback do claim: sem isso, retentativa imediata seria bloqueada
      // pelo bucket de minuto sem ter e-mail gerado — pior dos mundos.
      if (claimedId) {
        await fetch(`${SUPABASE_URL}/rest/v1/notificacoes_enviadas?id=eq.${claimedId}`, {
          method: "DELETE",
          headers: { apikey: serviceRole, Authorization: `Bearer ${serviceRole}`, Prefer: "return=minimal" },
        }).catch((e) => console.warn("[dedup] rollback DELETE falhou:", e));
      }
      console.error("Erro ao enviar email:", sendJson);
      await registrarErro("edge_function_error", "enviar-notificacao-email", `Falha ao enviar e-mail: ${JSON.stringify(sendJson).slice(0, 500)}`, {
        tenant_id: pedido.tenant_id,
        severidade: "media",
        detalhes: { pedido_id, status, gmail_response: sendJson },
      });
      return new Response(JSON.stringify({ error: "Falha ao enviar e-mail", details: sendJson }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("Email enviado com sucesso:", sendJson.id);

    return new Response(JSON.stringify({ success: true, message_id: sendJson.id, destinatario }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error("Erro:", (e as Error).message);
    await registrarErro("edge_function_error", "enviar-notificacao-email", (e as Error).message, {
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
