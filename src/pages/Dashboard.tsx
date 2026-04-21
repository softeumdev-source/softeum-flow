import { useState } from "react";
import { Link } from "react-router-dom";
import { Search, Eye, X, Inbox, Clock, CheckCircle2, XCircle, AlertTriangle, Copy, EyeOff, DollarSign } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge, ConfiancaBadge, StatusPedido } from "@/components/StatusBadge";
import { cn } from "@/lib/utils";

interface PedidoMock {
  id: string;
  numero: string;
  empresa: string;
  recebido_em: string;
  pdfs_total: number;
  pdfs_processados: number;
  valor_total: number;
  status: StatusPedido;
  confianca_ia: number;
}

// Dados mockados da Fase 1 — serão substituídos pelas queries reais na Fase 2
const pedidosMock: PedidoMock[] = [
  { id: "1", numero: "PC-10234", empresa: "Indústria Metalúrgica Alpha Ltda", recebido_em: "2025-04-21T09:14:00", pdfs_total: 3, pdfs_processados: 3, valor_total: 45230.5, status: "pendente", confianca_ia: 92 },
  { id: "2", numero: "PC-10233", empresa: "Construtora Horizonte SA", recebido_em: "2025-04-21T08:47:00", pdfs_total: 1, pdfs_processados: 1, valor_total: 12800.0, status: "aprovado", confianca_ia: 97 },
  { id: "3", numero: "PC-10232", empresa: "Farma Distribuidora do Sul", recebido_em: "2025-04-21T08:12:00", pdfs_total: 2, pdfs_processados: 2, valor_total: 8450.75, status: "aprovado", confianca_ia: 95 },
  { id: "4", numero: "PC-10231", empresa: "TechParts Eletrônicos ME", recebido_em: "2025-04-21T07:55:00", pdfs_total: 1, pdfs_processados: 1, valor_total: 3200.0, status: "erro_ia", confianca_ia: 58 },
  { id: "5", numero: "PC-10230", empresa: "Auto Peças Brasil Ltda", recebido_em: "2025-04-20T18:31:00", pdfs_total: 2, pdfs_processados: 2, valor_total: 27650.0, status: "pendente", confianca_ia: 84 },
  { id: "6", numero: "PC-10229", empresa: "Alimentos Vitória EIRELI", recebido_em: "2025-04-20T17:02:00", pdfs_total: 1, pdfs_processados: 1, valor_total: 15420.3, status: "reprovado", confianca_ia: 72 },
  { id: "7", numero: "PC-10228", empresa: "Construtora Horizonte SA", recebido_em: "2025-04-20T16:10:00", pdfs_total: 1, pdfs_processados: 1, valor_total: 12800.0, status: "duplicado", confianca_ia: 99 },
  { id: "8", numero: "PC-10227", empresa: "Móveis Planejados Norte", recebido_em: "2025-04-20T15:30:00", pdfs_total: 1, pdfs_processados: 1, valor_total: 5670.9, status: "ignorado", confianca_ia: 91 },
];

const metricasMock = {
  total: 128,
  pendentes: 12,
  aprovados_hoje: 34,
  reprovados: 5,
  erro_ia: 3,
  duplicados: 2,
  ignorados: 4,
  valor_total_dia: 184320.5,
};

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dataHora = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

export default function Dashboard() {
  const [busca, setBusca] = useState("");
  const [status, setStatus] = useState<string>("todos");
  const [dataInicio, setDataInicio] = useState("");
  const [dataFim, setDataFim] = useState("");

  const pedidosFiltrados = pedidosMock.filter((p) => {
    if (status !== "todos" && p.status !== status) return false;
    if (busca) {
      const t = busca.toLowerCase();
      if (!p.empresa.toLowerCase().includes(t) && !p.numero.toLowerCase().includes(t)) return false;
    }
    return true;
  });

  const limparFiltros = () => {
    setBusca("");
    setStatus("todos");
    setDataInicio("");
    setDataFim("");
  };

  return (
    <div className="mx-auto w-full max-w-[1400px] px-8 py-8">
      {/* Header */}
      <div className="mb-7">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Visão geral dos pedidos recebidos hoje
        </p>
      </div>

      {/* Métricas linha 1 */}
      <div className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-4">
        <MetricCard titulo="Total de pedidos" valor={metricasMock.total} icone={Inbox} tom="primary" />
        <MetricCard titulo="Pendentes" valor={metricasMock.pendentes} icone={Clock} tom="warning" />
        <MetricCard titulo="Aprovados hoje" valor={metricasMock.aprovados_hoje} icone={CheckCircle2} tom="success" />
        <MetricCard titulo="Reprovados" valor={metricasMock.reprovados} icone={XCircle} tom="destructive" />
      </div>

      {/* Métricas linha 2 */}
      <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-4">
        <MetricCard titulo="Erro IA" valor={metricasMock.erro_ia} icone={AlertTriangle} tom="erro" />
        <MetricCard titulo="Duplicados" valor={metricasMock.duplicados} icone={Copy} tom="duplicado" />
        <MetricCard titulo="Ignorados" valor={metricasMock.ignorados} icone={EyeOff} tom="ignorado" />
        <MetricCard titulo="Valor total do dia" valor={brl(metricasMock.valor_total_dia)} icone={DollarSign} tom="primary" destaque />
      </div>

      {/* Pedidos recebidos */}
      <div className="rounded-xl border border-border bg-card shadow-softeum-sm">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">Pedidos recebidos</h2>
            <p className="text-xs text-muted-foreground">
              {pedidosFiltrados.length} {pedidosFiltrados.length === 1 ? "resultado encontrado" : "resultados encontrados"}
            </p>
          </div>
        </div>

        {/* Filtros */}
        <div className="grid grid-cols-1 gap-3 border-b border-border bg-muted/30 px-5 py-4 md:grid-cols-[1fr_180px_160px_160px_auto]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por empresa ou nº do pedido"
              className="pl-9 bg-card"
            />
          </div>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="bg-card">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              <SelectItem value="pendente">Pendente</SelectItem>
              <SelectItem value="aprovado">Aprovado</SelectItem>
              <SelectItem value="reprovado">Reprovado</SelectItem>
              <SelectItem value="erro_ia">Erro IA</SelectItem>
              <SelectItem value="duplicado">Duplicado</SelectItem>
              <SelectItem value="ignorado">Ignorado</SelectItem>
            </SelectContent>
          </Select>
          <Input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} className="bg-card" />
          <Input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} className="bg-card" />
          <Button variant="outline" onClick={limparFiltros} className="gap-2">
            <X className="h-4 w-4" />
            Limpar
          </Button>
        </div>

        {/* Tabela */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/20 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-5 py-3 text-left font-medium">Nº Pedido</th>
                <th className="px-5 py-3 text-left font-medium">Empresa</th>
                <th className="px-5 py-3 text-left font-medium">Recebido em</th>
                <th className="px-5 py-3 text-left font-medium">PDFs</th>
                <th className="px-5 py-3 text-right font-medium">Valor Total</th>
                <th className="px-5 py-3 text-left font-medium">Status</th>
                <th className="px-5 py-3 text-left font-medium">Confiança IA</th>
                <th className="px-5 py-3 text-right font-medium">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {pedidosFiltrados.map((p) => (
                <tr key={p.id} className="transition-colors hover:bg-muted/30">
                  <td className="px-5 py-3.5 font-semibold text-foreground">{p.numero}</td>
                  <td className="px-5 py-3.5 text-foreground">{p.empresa}</td>
                  <td className="px-5 py-3.5 tabular-nums text-muted-foreground">{dataHora(p.recebido_em)}</td>
                  <td className="px-5 py-3.5 tabular-nums text-muted-foreground">
                    {p.pdfs_processados}/{p.pdfs_total}
                  </td>
                  <td className="px-5 py-3.5 text-right font-semibold tabular-nums text-foreground">{brl(p.valor_total)}</td>
                  <td className="px-5 py-3.5"><StatusBadge status={p.status} /></td>
                  <td className="px-5 py-3.5"><ConfiancaBadge valor={p.confianca_ia} /></td>
                  <td className="px-5 py-3.5 text-right">
                    <Link
                      to={`/pedido/${p.id}`}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                      aria-label="Abrir pedido"
                    >
                      <Eye className="h-4 w-4" />
                    </Link>
                  </td>
                </tr>
              ))}
              {pedidosFiltrados.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-5 py-16 text-center text-sm text-muted-foreground">
                    Nenhum pedido encontrado com esses filtros.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

type Tom = "primary" | "success" | "warning" | "destructive" | "erro" | "duplicado" | "ignorado";

interface MetricCardProps {
  titulo: string;
  valor: string | number;
  icone: typeof Inbox;
  tom: Tom;
  destaque?: boolean;
}

function MetricCard({ titulo, valor, icone: Icone, tom, destaque }: MetricCardProps) {
  const tomStyles: Record<Tom, string> = {
    primary: "bg-primary-soft text-primary",
    success: "bg-status-aprovado-soft text-status-aprovado",
    warning: "bg-status-pendente-soft text-status-pendente",
    destructive: "bg-status-reprovado-soft text-status-reprovado",
    erro: "bg-status-erro-soft text-status-erro",
    duplicado: "bg-status-duplicado-soft text-status-duplicado",
    ignorado: "bg-status-ignorado-soft text-status-ignorado",
  };

  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-card p-5 shadow-softeum-sm transition-shadow hover:shadow-softeum",
        destaque && "border-primary/20 bg-primary-soft/30"
      )}
    >
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{titulo}</p>
          <p className="mt-2 truncate text-2xl font-bold tabular-nums text-foreground">{valor}</p>
        </div>
        <div className={cn("ml-3 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg", tomStyles[tom])}>
          <Icone className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}
