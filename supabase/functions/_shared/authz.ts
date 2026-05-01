// Helper de autorização cross-tenant pra edge functions chamadas por
// usuários autenticados. Toda function que aceita tenant_id (ou pedido_id
// que resolve um tenant_id) DEVE chamar requireTenantAccess antes de
// fazer qualquer leitura/escrita pra evitar acesso cross-tenant.
//
// Uso típico:
//   const authHeader = req.headers.get("Authorization") ?? "";
//   const internal = isServiceRoleCaller(authHeader, serviceRole);
//   if (!internal) {
//     const userClient = createClient(SUPABASE_URL, anon, {
//       global: { headers: { Authorization: authHeader } },
//     });
//     const { data: userRes } = await userClient.auth.getUser();
//     if (!userRes?.user) return jsonResp(401, { error: "Sessão inválida" });
//
//     const authz = await requireTenantAccess(userClient, tenantId);
//     if (!authz.ok) return jsonResp(authz.status!, { error: authz.message });
//   }
//
// Caller interno (outra edge function via chamarFuncao com service role
// no Authorization) é confiável e pula o authz.

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

export interface AuthzResult {
  ok: boolean;
  status?: number;
  message?: string;
}

export async function requireTenantAccess(
  userClient: SupabaseClient,
  tenantId: string,
): Promise<AuthzResult> {
  if (!tenantId) {
    return { ok: false, status: 400, message: "tenant_id obrigatório" };
  }
  // Super admin sempre passa.
  const { data: isSuper } = await userClient.rpc("is_super_admin");
  if (isSuper) return { ok: true };
  // Membro ativo do tenant?
  const { data: isMember } = await userClient.rpc("is_tenant_member", { p_tenant_id: tenantId });
  if (isMember) return { ok: true };
  return { ok: false, status: 403, message: "Sem acesso a este tenant" };
}

/**
 * Detecta caller interno (edge function que invoca outra com a service
 * role key). Comparação por igualdade do bearer com o env. Se bater,
 * pula o authz check porque é caminho de sistema (cron / chamarFuncao).
 */
export function isServiceRoleCaller(authHeader: string, serviceRole: string): boolean {
  if (!authHeader.startsWith("Bearer ")) return false;
  return authHeader.slice(7) === serviceRole;
}
