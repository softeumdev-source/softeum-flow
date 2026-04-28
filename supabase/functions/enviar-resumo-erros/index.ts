const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = "https://arihejdirnhmcwuhkzde.supabase.co";
const APP_URL = "https://softeum-flow.vercel.app";

const ORDEM_SEVERIDADE: Record<string, number> = {
  baixa: 0,
  media: 1,
  alta: 2,
  critica: 3,
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const serviceRole = Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY");
    const clientId = Deno.env.get("GMAIL_CLIENT_ID");
    const clientSecret = Deno.env.get("GMAIL_CLIENT_SECRET");
    const systemRefreshToken = Deno.env.get("SYSTEM_GMAIL_REFRESH_TOKEN");
    const systemEmail = Deno.env.get("SYSTEM_GMAIL_EMAIL");

    if (!serviceRole) {
      return new Response(JSON.stringify({ error: "Service role não configurado" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1. Lê configurações globais
    const cfgs = await buscarConfiguracoesGlobais(serviceRole);
    const destinatario = cfgs.email_alertas_admin;
    const sevMinima = (cfgs.severidade_minima_email ?? "media").toLowerCase();
    const limiteSev = ORDEM_SEVERIDADE[sevMinima] ?? 1;

    if (!destinatario) {
      console.log("E-mail de alertas do admin não configurado — pulando envio.");
      return new Response(JSON.stringify({ message: "Sem destinatário configurado" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Busca erros NÃO RESOLVIDOS com novidades (alertado_em IS NULL ou < ultimo_em)
    const erros = await buscarErrosPendentes(serviceRole);
    const errosFiltrados = erros.filter(
      (e) => (ORDEM_SEVERIDADE[e.severidade] ?? 1) >= limiteSev,
    );

    if (errosFiltrados.length === 0) {
      console.log(`Sem erros pendentes acima da severidade '${sevMinima}'.`);
      return new Response(JSON.stringify({ message: "Sem erros pendentes" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!clientId || !clientSecret || !systemRefreshToken || !systemEmail) {
      console.error("Secrets do Gmail do sistema não configurados — não é possível enviar resumo.");
      return new Response(JSON.stringify({
        error: "Secrets do Gmail do sistema não configurados",
        erros_pendentes: errosFiltrados.length,
      }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3. Renova access token e envia
    const accessToken = await renovarTokenSistema(clientId, clientSecret, systemRefreshToken);
    const { assunto, html } = gerarEmail(errosFiltrados);

    console.log(`Enviando resumo de ${errosFiltrados.length} erros para ${destinatario}`);
    const sendRes = await enviarEmail(accessToken, systemEmail, destinatario, assunto, html);
    if (!sendRes.ok) {
      const errBody = await sendRes.text();
      console.error("Falha ao enviar resumo:", errBody);
      return new Response(JSON.stringify({ error: "Falha ao enviar e-mail", details: errBody }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 4. Marca alertado_em em todos os erros enviados
    const ids = errosFiltrados.map((e) => e.id);
    await marcarComoAlertados(serviceRole, ids);

    return new Response(JSON.stringify({ success: true, total: errosFiltrados.length }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error("Erro:", (e as Error).message);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function buscarConfiguracoesGlobais(serviceRole: string): Promise<Record<string, string>> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/configuracoes_globais?select=chave,valor`,
    { headers: { apikey: serviceRole, Authorization: `Bearer ${serviceRole}` } },
  );
  const rows = await res.json();
  const map: Record<string, string> = {};
  if (Array.isArray(rows)) {
    for (const r of rows) {
      if (r?.chave && r?.valor != null) map[r.chave] = String(r.valor);
    }
  }
  return map;
}

interface ErroPendente {
  id: string;
  tipo: string;
  origem: string;
  mensagem: string;
  severidade: string;
  count: number;
  primeiro_em: string;
  ultimo_em: string;
}

async function buscarErrosPendentes(serviceRole: string): Promise<ErroPendente[]> {
  // Erros não resolvidos onde alertado_em é NULL OU alertado_em < ultimo_em (algo novo desde o último envio).
  // PostgREST não permite comparação entre colunas direto via or, então buscamos não resolvidos e filtramos no código.
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/system_errors?resolvido=eq.false&select=id,tipo,origem,mensagem,severidade,count,primeiro_em,ultimo_em,alertado_em&order=ultimo_em.desc`,
    { headers: { apikey: serviceRole, Authorization: `Bearer ${serviceRole}` } },
  );
  const rows = await res.json();
  if (!Array.isArray(rows)) return [];
  return rows.filter((r: any) => {
    if (!r.alertado_em) return true;
    return new Date(r.alertado_em).getTime() < new Date(r.ultimo_em).getTime();
  }) as ErroPendente[];
}

async function marcarComoAlertados(serviceRole: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const idsList = ids.map((id) => `"${id}"`).join(",");
  await fetch(
    `${SUPABASE_URL}/rest/v1/system_errors?id=in.(${idsList})`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceRole,
        Authorization: `Bearer ${serviceRole}`,
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ alertado_em: new Date().toISOString() }),
    },
  );
}

async function renovarTokenSistema(clientId: string, clientSecret: string, refreshToken: string): Promise<string> {
  const refreshRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  const refreshJson = await refreshRes.json();
  if (!refreshRes.ok) {
    throw new Error(`Falha ao renovar token do Gmail do sistema: ${refreshJson.error ?? "desconhecido"}`);
  }
  return refreshJson.access_token;
}

async function enviarEmail(accessToken: string, remetente: string, destinatario: string, assunto: string, html: string): Promise<Response> {
  const boundary = "boundary_softeum_" + Date.now();
  const emailLines = [
    `From: ${remetente}`,
    `To: ${destinatario}`,
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
  ];
  const emailRaw = emailLines.join("\r\n");
  const emailBase64 = btoa(emailRaw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  return await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ raw: emailBase64 }),
  });
}

function gerarEmail(erros: ErroPendente[]): { assunto: string; html: string } {
  const total = erros.length;
  const criticos = erros.filter((e) => e.severidade === "critica").length;
  const altos = erros.filter((e) => e.severidade === "alta").length;

  const assunto = `[Softeum] ${total} erro${total > 1 ? "s" : ""} pendente${total > 1 ? "s" : ""}${criticos > 0 ? ` (${criticos} crítico${criticos > 1 ? "s" : ""})` : ""}`;

  const linhas = erros.map((e) => {
    const corSev = corPorSeveridade(e.severidade);
    const ultimoFmt = formatarData(e.ultimo_em);
    const msg = e.mensagem.length > 160 ? e.mensagem.slice(0, 160) + "…" : e.mensagem;
    return `
      <tr>
        <td style="padding:10px 12px;border-top:1px solid #eee;font-size:12px;color:#546E7A;">${escaparHTML(e.tipo)}</td>
        <td style="padding:10px 12px;border-top:1px solid #eee;font-size:12px;color:#263238;font-weight:600;">${escaparHTML(e.origem)}</td>
        <td style="padding:10px 12px;border-top:1px solid #eee;font-size:12px;color:#37474F;max-width:280px;">${escaparHTML(msg)}</td>
        <td style="padding:10px 12px;border-top:1px solid #eee;font-size:12px;color:#263238;text-align:center;font-weight:700;">${e.count}</td>
        <td style="padding:10px 12px;border-top:1px solid #eee;text-align:center;">
          <span style="background:${corSev};color:#fff;font-size:10px;font-weight:700;padding:3px 8px;border-radius:10px;text-transform:uppercase;">${e.severidade}</span>
        </td>
        <td style="padding:10px 12px;border-top:1px solid #eee;font-size:11px;color:#78909C;text-align:right;white-space:nowrap;">${ultimoFmt}</td>
      </tr>`;
  }).join("");

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><title>Resumo de erros</title></head>
<body style="margin:0;padding:0;background-color:#f0f2f5;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f0f2f5;padding:30px 0;">
    <tr><td align="center">
      <table width="800" cellpadding="0" cellspacing="0" style="max-width:800px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:linear-gradient(135deg,#1a1a2e,#16213e);padding:28px 36px;text-align:center;">
            <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">Softeum — Monitoramento</h1>
            <p style="margin:6px 0 0;color:#90A4AE;font-size:13px;">Resumo horário de erros pendentes</p>
          </td>
        </tr>
        <tr>
          <td style="padding:24px 36px 12px;">
            <p style="margin:0;font-size:15px;color:#263238;">
              <strong>${total}</strong> erro${total > 1 ? "s" : ""} pendente${total > 1 ? "s" : ""} agora.
              ${criticos > 0 ? `<span style="color:#B71C1C;"><strong>${criticos}</strong> crítico${criticos > 1 ? "s" : ""}.</span>` : ""}
              ${altos > 0 ? `<span style="color:#E65100;"><strong>${altos}</strong> alta${altos > 1 ? "s" : ""}.</span>` : ""}
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:0 36px 24px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e0e0e0;border-radius:8px;overflow:hidden;">
              <tr style="background:#ECEFF1;">
                <th style="padding:10px 12px;font-size:11px;color:#546E7A;text-transform:uppercase;letter-spacing:0.5px;text-align:left;">Tipo</th>
                <th style="padding:10px 12px;font-size:11px;color:#546E7A;text-transform:uppercase;letter-spacing:0.5px;text-align:left;">Origem</th>
                <th style="padding:10px 12px;font-size:11px;color:#546E7A;text-transform:uppercase;letter-spacing:0.5px;text-align:left;">Mensagem</th>
                <th style="padding:10px 12px;font-size:11px;color:#546E7A;text-transform:uppercase;letter-spacing:0.5px;text-align:center;">Ocorr.</th>
                <th style="padding:10px 12px;font-size:11px;color:#546E7A;text-transform:uppercase;letter-spacing:0.5px;text-align:center;">Sev</th>
                <th style="padding:10px 12px;font-size:11px;color:#546E7A;text-transform:uppercase;letter-spacing:0.5px;text-align:right;">Última</th>
              </tr>
              ${linhas}
            </table>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:0 36px 28px;">
            <a href="${APP_URL}/admin/erros" style="display:inline-block;background:#1a1a2e;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 28px;border-radius:8px;">
              Ver no painel admin
            </a>
          </td>
        </tr>
        <tr>
          <td style="background:#ECEFF1;padding:14px 36px;text-align:center;border-top:1px solid #e0e0e0;">
            <p style="margin:0;font-size:11px;color:#78909C;">Resumo gerado automaticamente a cada hora. Inclui apenas erros não resolvidos com atividade nova desde o último envio.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  return { assunto, html };
}

function corPorSeveridade(s: string): string {
  switch (s) {
    case "critica": return "#B71C1C";
    case "alta": return "#E65100";
    case "media": return "#F9A825";
    case "baixa": return "#546E7A";
    default: return "#78909C";
  }
}

function formatarData(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return iso;
  }
}

function escaparHTML(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
