import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Search, Eye, X, Inbox, Clock, CheckCircle2, XCircle, AlertTriangle, Copy, EyeOff, DollarSign, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge, ConfiancaBadge } from "@/components/StatusBadge";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Pedido {
  id: string;
  numero: string;
  empresa: string | null;
  data_pedido: string | null;
  data_recebimento_email: string | null;
  status: "pendente" | "aprovado" | "parcial" | "rejeitado" | "concluido";
  confianca_ia: number | null;
  total_previsto: number | null;
  itens_count: number;
}

interface Metricas {
  total: number;
  pendentes: number;
  aprovados: number;
  rejeitados: number;
  parciais: number;
  concluidos: number;
  valor_total_dia: number;
}

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dataHora = (iso: string | null) => {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
};

export default function Dashboard() {
  const { user, tenantId, loading: authLoading } = useAuth();
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [metricas, setMetricas] = useState<Metricas>({
    total: 0,
    pendentes: 0,
    aprovados: 0,
    rejeitados: 0,
    parciais: 0,
    concluidos: 0,
    valor_total_dia: 0
  });
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState("");
  const [status, setStatus] = useState<string>("todos");
  const [dataInicio, setDataInicio] = useState("");
  const [dataFim, setDataFim] = useState("");

  // Carrega pedidos do Supabase com Realtime
  useEffect(() => {
    if (!user || authLoading) return;

    const loadPedidos = async () => {
      setLoading(true);
      try {
        // Busca pedidos com contagem de itens
        const { data, error } = await supabase
          .from('pedidos')
          .select(`
            id,
            numero,
            empresa: fornecedor,
            data_pedido,
            data_recebimento_email,
            status,
            confianca_ia,
            total_previsto
          `)
          .order('created_at', { ascending: false });

        if (error) throw error;

        // Para cada pedido, conta os itens
        const pedidosComItens: Pedido[] = await Promise.all(
          (data || []).map(async (p: any) => {
            const { count, error: countError } = await supabase
              .from('pedido_itens')
              .select('*', { count: 'exact', head: true })
              .eq('pedido_id', p.id);
            
            if (countError) console.error("Erro ao contar itens:", countError);
            
            return {
              id: p.id,
              numero: p.numero,
              empresa: p.fornecedor,
              data_pedido: p.data_pedido,
              data_recebimento_email: p.data_recebimento_email,
              status: p.status as Pedido['status'],
              confianca_ia: p.confianca_ia,
              total_previsto: p.total_previsto,
              itens_count: count || 0
            };
          })
        );

        setPedidos(pedidosComItens);
        calcularMetricas(pedidosComItens);
      } catch (err: any) {
        toast.error("Erro ao carregar pedidos", { description: err.message });
      } finally {
        setLoading(false);
      }
    };

    loadPedidos();

    // Realtime: pedidos + itens (afeta contagem)
    const channel = supabase
      .channel('pedidos-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos' }, () => {
        loadPedidos();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pedido_itens' }, () => {
        loadPedidos();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, authLoading]);

  const calcularMetricas = (pedidosData: Pedido[]) => {
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    
    const metricasCalculadas = pedidosData.reduce((acc, p) => {
      acc.total++;
      if (p.status === 'pendente') acc.pendentes++;
      if (p.status === 'aprovado') acc.aprovados++;
      if (p.status === 'rejeitado') acc.rejeitados++;
      if (p.status === 'parcial') acc.parciais++;
      if (p.status === 'concluido') acc.concluidos++;
      
      const dataRecebimento = p.data_recebimento_email ? new Date(p.data_recebimento_email) : null;
      if (dataRecebimento && dataRecebimento >= hoje && p.total_previsto) {
        acc.valor_total_dia += p.total_previsto;
      }
      
      return acc;
    }, { 
      total: 0, 
      pendentes: 0, 
      aprovados: 0, 
      rejeitados: 0, 
      parciais: 0, 
      concluidos: 0, 
      valor_total_dia: 0 
    });
    
    setMetricas(metricasCalculadas);
  };

  const pedidosFiltrados = pedidos.filter((p) => {
    if (status !== "todos" && p.status !== status) return false;
    if (busca) {
      const t = busca.toLowerCase();
      const matchEmpresa = p.empresa?.toLowerCase().includes(t) ?? false;
      const matchNumero = p.numero.toLowerCase().includes(t);
      if (!matchEmpresa && !matchNumero) return false;
    }
    if (dataInicio && p.data_pedido) {
      if (new Date(p.data_pedido) < new Date(dataInicio)) return false;
    }
    if (dataFim && p.data_pedido) {
      if (new Date(p.data_pedido) > new Date(dataFim)) return false;
    }
    return true;
  });

  const limparFiltros = () => {
    setBusca("");
    setStatus("todos");
    setDataInicio("");
    setDataFim("");
  };

  // Mapeia status do Supabase para exibição
  const mapStatusToBadge = (status: string): "pendente" | "aprovado" | "aprovado" | "erro_ia" | "duplicado" | "ignorado" | "reprovado" => {
    switch (status) {
      case 'pendente': return 'pendente';
      case 'aprovado': return 'aprovado';
      case 'parcial': return 'aprovado';
      case 'rejeitado': return 'erro_ia';
      case 'concluido': return 'aprovado';
      default: return 'pendente';
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1400px] px-8 py-8">
      {/* Header */}
      <div className="mb-7">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Visão geral dos pedidos recebidos
        </p>
      </div>

      {/* Métricas - Linha 1 */}
      <div className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-4">
        <MetricCard titulo="Total de pedidos" valor={metricas.total} icone={Inbox} tom="primary" />
        <MetricCard titulo="Pendentes" valor={metricas.pendentes} icone={Clock} tom="warning" />
        <MetricCard titulo="Aprovados" valor={metricas.aprovados} icone={CheckCircle2} tom="success" />
        <MetricCard titulo="Reprovados" valor={metricas.rejeitados} icone={XCircle} tom="destructive" />
      </div>

      {/* Métricas - Linha 2 */}
      <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-4">
        <MetricCard titulo="Parciais" valor={metricas.parciais} icone={AlertTriangle} tom="warning" />
        <MetricCard titulo="Concluídos" valor={metricas.concluidos} icone={CheckCircle2} tom="success" />
        <MetricCard titulo="Valor total do dia" valor={brl(metricas.valor_total_dia)} icone={DollarSign} tom="primary" destaque />
      </div>

      {/* Pedidos recebidos */}
      <div className="rounded-xl border border-border bg-card shadow-softeum-sm">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">Pedidos recebidos</h2>
            <p className="text-xs text-muted-foreground">
              {loading ? "Carregando..." : `${pedidosFiltrados.length} ${pedidosFiltrados.length === 1 ? "resultado encontrado" : "resultados encontrados"}`}
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
              placeholder="Buscar por fornecedor ou nº do pedido"
              className="pl-9 bg-card"
              disabled={loading}
            />
          </div>
          <Select value={status} onValueChange={setStatus} disabled={loading}>
            <SelectTrigger className="bg-card">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              <SelectItem value="pendente">Pendente</SelectItem>
              <SelectItem value="aprovado">Aprovado</SelectItem>
              <SelectItem value="parcial">Parcial</SelectItem>
              <SelectItem value="rejeitado">Rejeitado</SelectItem>
              <SelectItem value="concluido">Concluído</SelectItem>
            </SelectContent>
          </Select>
          <Input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} className="bg-card" disabled={loading} />
          <Input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} className="bg-card" disabled={loading} />
          <Button variant="outline" onClick={limparFiltros} className="gap-2" disabled={loading}>
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
                <th className="px-5 py-3 text-left font-medium">Fornecedor</th>
                <th className="px-5 py-3 text-left font-medium">Recebido em</th>
                <th className="px-5 py-3 text-left font-medium">Itens</th>
                <th className="px-5 py-3 text-right font-medium">Valor Total</th>
                <th className="px-5 py-3 text-left font-medium">Status</th>
                <th className="px-5 py-3 text-left font-medium">Confiança IA</th>
                <th className="px-5 py-3 text-right font-medium">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-5 py-16 text-center text-sm text-muted-foreground">
                    <div className="flex items-center justify-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Carregando pedidos...
                    </div>
                  </td>
                </tr>
              ) : (
                <>
                  {pedidosFiltrados.map((p) => (
                    <tr key={p.id} className="transition-colors hover:bg-muted/30">
                      <td className="px-5 py-3.5 font-semibold text-foreground">{p.numero}</td>
                      <td className="px-5 py-3.5 text-foreground">{p.empresa || "-"}</td>
                      <td className="px-5 py-3.5 tabular-nums text-muted-foreground">{dataHora(p.data_recebimento_email)}</td>
                      <td className="px-5 py-3.5 tabular-nums text-muted-foreground">
                        {p.itens_count}
                      </td>
                      <td className="px-5 py-3.5 text-right font-semibold tabular-nums text-foreground">
                        {p.total_previsto ? brl(p.total_previsto) : "-"}
                      </td>
                      <td className="px-5 py-3.5">
                        <StatusBadge status={mapStatusToBadge(p.status)} />
                      </td>
                      <td className="px-5 py-3.5">
                        <ConfiancaBadge valor={p.confianca_ia ? Math.round(p.confianca_ia * 100) : 0} />
                      </td>
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
                  {pedidosFiltrados.length === 0 && !loading && (
                    <tr>
                      <td colSpan={8} className="px-5 py-16 text-center text-sm text-muted-foreground">
                        Nenhum pedido encontrado com esses filtros.
                      </td>
                    </tr>
                  )}
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

type Tom = "primary" | "success" | "warning" | "destructive" | "info";

interface MetricCardProps {
  titulo: string;
  valor: string | number;
  icone: typeof Inbox;
  tom: Tom;
  destaque?: boolean;
}

function MetricCard({ titulo, valor, icone: Icone, tom, destaque }: MetricCardProps) {
  const tomStyles: Record<Tom, string> = {
    primary: "bg-primary/10 text-primary",
    success: "bg-green-500/10 text-green-600",
    warning: "bg-amber-500/10 text-amber-600",
    destructive: "bg-red-500/10 text-red-600",
    info: "bg-blue-500/10 text-blue-600"
  };

  return (
    <div
      className={`rounded-xl border border-border bg-card p-5 shadow-sm transition-shadow hover:shadow-md ${
        destaque ? "border-primary/20 bg-primary/5" : ""
      }`}
    >
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{titulo}</p>
          <p className="mt-2 truncate text-2xl font-bold tabular-nums text-foreground">{valor}</p>
        </div>
        <div className={`ml-3 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg ${tomStyles[tom]}`}>
          <Icone className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}
