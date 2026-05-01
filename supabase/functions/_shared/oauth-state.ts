// HMAC-signed state pra OAuth Gmail (CSRF protection).
//
// O parâmetro `state` do OAuth carrega o tenant_id e é devolvido pelo
// Google no callback. Sem assinatura, atacante pode forjar `state` e
// fazer com que tokens Gmail de uma indústria sejam gravados sob outro
// tenant (ou vice-versa). Solução: assinar o state com HMAC-SHA256 +
// nonce + expiração curta. O callback verifica a assinatura antes de
// confiar no tenant_id.
//
// Formato do state: `<base64url(JSON payload)>.<base64url(HMAC)>`.
//
// Payload:
//   tid: tenant_id
//   n:   nonce aleatório (16 bytes hex) — protege contra replay
//   exp: epoch segundos de expiração (10 min após emissão)

const encoder = new TextEncoder();

export interface OAuthStatePayload {
  tid: string;
  n: string;
  exp: number;
}

async function hmacSha256(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return base64UrlEncode(new Uint8Array(sig));
}

function base64UrlEncode(input: Uint8Array | string): string {
  const bytes = typeof input === "string" ? encoder.encode(input) : input;
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(str: string): Uint8Array {
  let s = str.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function gerarNonce(): string {
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  return Array.from(buf).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function signOAuthState(tenantId: string, secret: string, ttlSeconds = 600): Promise<string> {
  const payload: OAuthStatePayload = {
    tid: tenantId,
    n: gerarNonce(),
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const data = base64UrlEncode(JSON.stringify(payload));
  const sig = await hmacSha256(secret, data);
  return `${data}.${sig}`;
}

/**
 * Valida o state do callback. Retorna o payload se ok; null se a
 * assinatura é inválida, o formato está errado ou o state expirou.
 */
export async function verifyOAuthState(state: string, secret: string): Promise<OAuthStatePayload | null> {
  const parts = state.split(".");
  if (parts.length !== 2) return null;
  const [data, sig] = parts;
  const expected = await hmacSha256(secret, data);
  // Comparação constant-time.
  if (sig.length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return null;

  try {
    const json = new TextDecoder().decode(base64UrlDecode(data));
    const payload = JSON.parse(json) as OAuthStatePayload;
    if (!payload.tid || !payload.n || typeof payload.exp !== "number") return null;
    if (Math.floor(Date.now() / 1000) > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}
