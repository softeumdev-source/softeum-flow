// Helpers para cálculo de vencimento de mensalidade dos clientes.
// Usa o campo `dia_vencimento` (1-31) configurado em cada tenant
// e compara com a data atual.

export type StatusVencimento =
  | { tipo: "sem-data" }
  | { tipo: "ok"; diasRestantes: number; proximoVencimento: Date }
  | { tipo: "a-vencer"; diasRestantes: number; proximoVencimento: Date }
  | { tipo: "vence-hoje"; proximoVencimento: Date }
  | { tipo: "vencido"; diasAtraso: number; vencimentoNoMes: Date };

const ultimoDiaDoMes = (ano: number, mesIndex: number) =>
  new Date(ano, mesIndex + 1, 0).getDate();

/**
 * Calcula o status de vencimento de uma mensalidade a partir do dia configurado.
 * - Se o dia ainda não passou no mês corrente → próximo vencimento é neste mês.
 * - Se já passou → considera "vencido" no mês atual e calcula próximo no mês seguinte.
 *
 * @param diaVencimento dia (1-31) configurado no tenant
 * @param hoje (opcional) data de referência, usada para testes
 */
export function calcularStatusVencimento(
  diaVencimento: number | null | undefined,
  hoje: Date = new Date(),
): StatusVencimento {
  if (!diaVencimento || diaVencimento < 1 || diaVencimento > 31) {
    return { tipo: "sem-data" };
  }

  const ano = hoje.getFullYear();
  const mes = hoje.getMonth();
  const diaHoje = hoje.getDate();

  // Ajusta para o último dia do mês caso o dia configurado seja maior
  const diaNoMesAtual = Math.min(diaVencimento, ultimoDiaDoMes(ano, mes));
  const vencimentoNoMes = new Date(ano, mes, diaNoMesAtual);

  if (diaHoje < diaNoMesAtual) {
    const diasRestantes = diaNoMesAtual - diaHoje;
    if (diasRestantes <= 5) {
      return { tipo: "a-vencer", diasRestantes, proximoVencimento: vencimentoNoMes };
    }
    return { tipo: "ok", diasRestantes, proximoVencimento: vencimentoNoMes };
  }

  if (diaHoje === diaNoMesAtual) {
    return { tipo: "vence-hoje", proximoVencimento: vencimentoNoMes };
  }

  // Já passou no mês atual → vencido
  const diasAtraso = diaHoje - diaNoMesAtual;
  return { tipo: "vencido", diasAtraso, vencimentoNoMes };
}
