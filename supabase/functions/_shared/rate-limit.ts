// Rate limit por IP pra endpoints públicos de convite.
//
// Limite: 10 tentativas em 15 minutos. Acima disso, bloqueia.
// Sempre registra a tentativa (mesmo a bloqueada) — controle e auditoria.
//
// Uso típico:
//   const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
//   const ip = extrairIp(req);
//   const { permitido, tentativas } = await checarRateLimit(admin, ip, token);
//   if (!permitido) return jsonResp(429, { error: "Muitas tentativas..." });
//   ... processa o convite ...
//   await marcarTentativaSucesso(admin, ip, token);
//
// IP "unknown" (ambiente local sem proxy) NÃO é bloqueado — registra mas
// pula o gate. Em produção o gateway do Supabase injeta x-forwarded-for.

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

export const RATE_LIMIT_MAX_TENTATIVAS = 10;
export const RATE_LIMIT_JANELA_MINUTOS = 15;

export function extrairIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    // Pode vir como "client_ip, proxy1, proxy2" — pega o primeiro.
    const primeiro = xff.split(",")[0]?.trim();
    if (primeiro) return primeiro;
  }
  const xri = req.headers.get("x-real-ip");
  if (xri) return xri.trim();
  return "unknown";
}

export interface RateLimitResult {
  permitido: boolean;
  tentativas: number;
}

export async function checarRateLimit(
  admin: SupabaseClient,
  ip: string,
  token: string,
): Promise<RateLimitResult> {
  const tokenPrefix = token.slice(0, 8);
  const desde = new Date(Date.now() - RATE_LIMIT_JANELA_MINUTOS * 60 * 1000).toISOString();

  // Conta tentativas do IP nos últimos 15 minutos. IP "unknown" (dev local)
  // não é bloqueado, mas a tentativa é registrada pra auditoria.
  let tentativas = 0;
  if (ip !== "unknown") {
    const { count } = await admin
      .from("convite_tentativas")
      .select("id", { count: "exact", head: true })
      .eq("ip", ip)
      .gte("tentou_em", desde);
    tentativas = count ?? 0;
  }

  const permitido = ip === "unknown" || tentativas < RATE_LIMIT_MAX_TENTATIVAS;

  // Registra a tentativa (mesmo se for ser bloqueada). Best-effort: se
  // o INSERT falha, não derruba o request — rate limit fica lossy mas o
  // comportamento principal segue.
  await admin
    .from("convite_tentativas")
    .insert({
      ip,
      token_prefix: tokenPrefix,
      sucesso: false,
    })
    .select("id")
    .single()
    .then(() => undefined)
    .catch((e: unknown) => {
      console.error("checarRateLimit: falha ao registrar tentativa:", e);
    });

  return { permitido, tentativas };
}

// Após processar o convite com sucesso, marca a última tentativa daquele
// (ip, token_prefix) como sucesso=true. Best-effort.
export async function marcarTentativaSucesso(
  admin: SupabaseClient,
  ip: string,
  token: string,
): Promise<void> {
  const tokenPrefix = token.slice(0, 8);
  const desde = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  try {
    const { data: ultima } = await admin
      .from("convite_tentativas")
      .select("id")
      .eq("ip", ip)
      .eq("token_prefix", tokenPrefix)
      .gte("tentou_em", desde)
      .order("tentou_em", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (ultima?.id) {
      await admin
        .from("convite_tentativas")
        .update({ sucesso: true })
        .eq("id", ultima.id);
    }
  } catch (e) {
    console.error("marcarTentativaSucesso: falha:", e);
  }
}
