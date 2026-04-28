const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = "https://arihejdirnhmcwuhkzde.supabase.co";

type Severidade = "baixa" | "media" | "alta" | "critica";

interface RegistrarErroBody {
  tipo: string;
  origem: string;
  mensagem: string;
  detalhes?: any;
  tenant_id?: string | null;
  severidade?: Severidade;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json() as RegistrarErroBody;
    const { tipo, origem, mensagem, detalhes, tenant_id } = body;

    if (!tipo || !origem || !mensagem) {
      return new Response(JSON.stringify({ error: "tipo, origem e mensagem são obrigatórios" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sev: Severidade = (body.severidade ?? "media");
    if (!["baixa", "media", "alta", "critica"].includes(sev)) {
      return new Response(JSON.stringify({ error: "severidade inválida" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const serviceRole = Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY");
    if (!serviceRole) {
      return new Response(JSON.stringify({ error: "Service role não configurado" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const hash = await calcularHash(tipo, origem, mensagem);
    const mensagemTrunc = mensagem.slice(0, 2000);

    // 1) Tenta INSERT.
    // Se já existir registro NÃO resolvido com mesmo hash, o índice unique
    // parcial (system_errors_hash_aberto_uidx) faz o INSERT falhar com 409.
    const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/system_errors`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceRole,
        Authorization: `Bearer ${serviceRole}`,
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        tipo,
        origem,
        mensagem: mensagemTrunc,
        detalhes: detalhes ?? null,
        tenant_id: tenant_id ?? null,
        severidade: sev,
        hash_agrupamento: hash,
      }),
    });

    if (insertRes.ok) {
      // Novo erro. Cria notificação no painel e retorna.
      await criarNotificacaoSistema(serviceRole, tipo, origem, sev);
      return new Response(JSON.stringify({ success: true, novo: true }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2) Se 409 (unique violation), incrementa o registro existente.
    if (insertRes.status === 409) {
      const incrementado = await incrementarOcorrencia(serviceRole, hash);
      if (!incrementado) {
        console.error(`Falha ao incrementar erro hash=${hash}`);
        return new Response(JSON.stringify({ error: "Falha ao incrementar contador" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ success: true, novo: false }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3) Outro erro inesperado.
    const errBody = await insertRes.text();
    console.error("Falha ao inserir erro:", insertRes.status, errBody);
    return new Response(JSON.stringify({ error: "Falha ao gravar erro", details: errBody }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error("Erro em registrar-erro:", (e as Error).message);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function calcularHash(tipo: string, origem: string, mensagem: string): Promise<string> {
  const primeiraLinha = mensagem.split("\n")[0].trim().slice(0, 500);
  const input = `${tipo}::${origem}::${primeiraLinha}`;
  const data = new TextEncoder().encode(input);
  const buffer = await crypto.subtle.digest("SHA-256", data);
  const hex = Array.from(new Uint8Array(buffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return hex.slice(0, 32);
}

async function incrementarOcorrencia(serviceRole: string, hash: string): Promise<boolean> {
  // Lê o registro atual (count) para incrementar de forma explícita.
  // Não é totalmente atômico, mas o pior caso é perder uma contagem (++ em vez de ++ ++).
  const getRes = await fetch(
    `${SUPABASE_URL}/rest/v1/system_errors?hash_agrupamento=eq.${hash}&resolvido=eq.false&select=id,count`,
    { headers: { apikey: serviceRole, Authorization: `Bearer ${serviceRole}` } },
  );
  if (!getRes.ok) {
    console.error("Falha ao buscar erro existente:", await getRes.text());
    return false;
  }
  const rows = await getRes.json();
  if (!Array.isArray(rows) || rows.length === 0) {
    // Race: registro foi resolvido entre o INSERT e o GET. Tenta INSERT de novo seria ideal,
    // mas pra simplificar consideramos ok (o erro pode ser registrado na próxima ocorrência).
    return true;
  }
  const row = rows[0];
  const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/system_errors?id=eq.${row.id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      apikey: serviceRole,
      Authorization: `Bearer ${serviceRole}`,
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      count: (row.count ?? 1) + 1,
      ultimo_em: new Date().toISOString(),
    }),
  });
  return patchRes.ok;
}

async function criarNotificacaoSistema(serviceRole: string, tipo: string, origem: string, severidade: Severidade): Promise<void> {
  const titulo = `Novo erro do sistema (${severidade})`;
  const mensagem = `${tipo} em ${origem}. Veja detalhes em /admin/erros.`;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/notificacoes_painel`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: serviceRole,
      Authorization: `Bearer ${serviceRole}`,
    },
    body: JSON.stringify({
      tenant_id: null,
      tipo: "erro_sistema",
      titulo,
      mensagem,
    }),
  });
  if (!res.ok) {
    console.error("Falha ao criar notificação de sistema:", await res.text());
  }
}
