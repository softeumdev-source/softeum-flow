import { cn } from "@/lib/utils";

// Conjunto fechado de status conhecidos. Aceitamos string genérica
// (mais flexível pra evolução de status novos sem refator) com fallback
// gracioso pra status desconhecido.
const labels: Record<string, string> = {
  pendente: "Pendente",
  aprovado: "Aprovado",
  reprovado: "Reprovado",
  erro: "Erro",
  erro_ia: "Erro IA",
  duplicado: "Duplicado",
  ignorado: "Ignorado",
  aguardando_de_para: "Aguardando DE-PARA",
  aprovado_parcial: "Aprovado parcial",
};

const styles: Record<string, string> = {
  pendente: "bg-status-pendente-soft text-status-pendente border-status-pendente/20",
  aprovado: "bg-status-aprovado-soft text-status-aprovado border-status-aprovado/20",
  reprovado: "bg-status-reprovado-soft text-status-reprovado border-status-reprovado/20",
  erro: "bg-status-erro-soft text-status-erro border-status-erro/20",
  erro_ia: "bg-status-erro-soft text-status-erro border-status-erro/20",
  duplicado: "bg-status-duplicado-soft text-status-duplicado border-status-duplicado/20",
  ignorado: "bg-status-ignorado-soft text-status-ignorado border-status-ignorado/20",
  aguardando_de_para: "bg-amber-100 text-amber-800 border-amber-300",
  aprovado_parcial: "bg-blue-100 text-blue-800 border-blue-300",
};

const FALLBACK_STYLE = "bg-muted text-muted-foreground border-border";

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const label = labels[status] ?? status;
  const style = styles[status] ?? FALLBACK_STYLE;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
        style,
        className,
      )}
    >
      <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}

/**
 * ConfiancaBadge — escala 0..1 (consistente com pedidos.confianca_ia
 * numeric(5,4) no banco). Aceita number | string | null para acomodar
 * o retorno do PostgREST que devolve numeric como string em alguns
 * casos. Retorna null se o valor for inválido.
 *
 * Thresholds (decisão F4/F5):
 *   - Verde:    >= 0.8
 *   - Amarelo:  0.4 - 0.79
 *   - Vermelho: < 0.4
 */
export function ConfiancaBadge({ valor, className }: { valor: number | string | null | undefined; className?: string }) {
  if (valor === null || valor === undefined || valor === "") return null;
  const n = Number(valor);
  if (!Number.isFinite(n)) return null;
  const pct = Math.round(n * 100);

  let tom = "bg-success-soft text-confianca-alta border-confianca-alta/20";
  if (n < 0.4) tom = "bg-status-reprovado-soft text-confianca-baixa border-confianca-baixa/20";
  else if (n < 0.8) tom = "bg-warning-soft text-confianca-media border-confianca-media/20";

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold tabular-nums",
        tom,
        className,
      )}
    >
      <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-current" />
      Confiança {pct}%
    </span>
  );
}
