import { cn } from "@/lib/utils";

export type StatusPedido =
  | "pendente"
  | "aprovado"
  | "reprovado"
  | "erro_ia"
  | "duplicado"
  | "ignorado"
  | "aguardando_de_para"
  | "aprovado_parcial";

const labels: Record<StatusPedido, string> = {
  pendente: "Pendente",
  aprovado: "Aprovado",
  reprovado: "Reprovado",
  erro_ia: "Erro IA",
  duplicado: "Duplicado",
  ignorado: "Ignorado",
  aguardando_de_para: "Aguardando DE-PARA",
  aprovado_parcial: "Aprovado parcial",
};

const styles: Record<StatusPedido, string> = {
  pendente: "bg-status-pendente-soft text-status-pendente border-status-pendente/20",
  aprovado: "bg-status-aprovado-soft text-status-aprovado border-status-aprovado/20",
  reprovado: "bg-status-reprovado-soft text-status-reprovado border-status-reprovado/20",
  erro_ia: "bg-status-erro-soft text-status-erro border-status-erro/20",
  duplicado: "bg-status-duplicado-soft text-status-duplicado border-status-duplicado/20",
  ignorado: "bg-status-ignorado-soft text-status-ignorado border-status-ignorado/20",
  aguardando_de_para: "bg-amber-100 text-amber-800 border-amber-300",
  aprovado_parcial: "bg-blue-100 text-blue-800 border-blue-300",
};

export function StatusBadge({ status, className }: { status: StatusPedido; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
        styles[status],
        className
      )}
    >
      <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-current" />
      {labels[status]}
    </span>
  );
}

export function ConfiancaBadge({ valor, className }: { valor: number; className?: string }) {
  const nivel = valor >= 90 ? "alta" : valor >= 70 ? "media" : "baixa";
  const styleMap = {
    alta: "bg-success-soft text-confianca-alta border-confianca-alta/20",
    media: "bg-warning-soft text-confianca-media border-confianca-media/20",
    baixa: "bg-status-reprovado-soft text-confianca-baixa border-confianca-baixa/20",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold tabular-nums",
        styleMap[nivel],
        className
      )}
    >
      {valor}%
    </span>
  );
}
