import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Search, X } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface SystemError {
  id: string;
  tipo: string;
  origem: string;
  mensagem: string;
  detalhes: any;
  tenant_id: string | null;
  severidade: "baixa" | "media" | "alta" | "critica";
  hash_agrupamento: string;
  count: number;
  primeiro_em: string;
  ultimo_em: string;
  alertado_em: string | null;
  resolvido: boolean;
  resolvido_em: string | null;
}

const SEVERIDADES = ["baixa", "media", "alta", "critica"] as const;

const CORES_SEVERIDADE: Record<string, string> = {
  baixa: "bg-slate-500/15 text-slate-700 dark:text-slate-300",
  media: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  alta: "bg-orange-500/15 text-orange-700 dark:text-orange-400",
  critica: "bg-red-500/15 text-red-700 dark:text-red-400",
};

export default function AdminErros() {
  const queryClient = useQueryClient();
  const [filtroSev, setFiltroSev] = useState<string>("todas");
  const [filtroOrigem, setFiltroOrigem] = useState<string>("todas");
  const [filtroResolvido, setFiltroResolvido] = useState<string>("nao");
  const [busca, setBusca] = useState<string>("");
  const [erroSelecionado, setErroSelecionado] = useState<SystemError | null>(null);
  const [resolvendo, setResolvendo] = useState<string | null>(null);
  const [resolvendoTodos, setResolvendoTodos] = useState(false);

  const queryKey = ["system_errors_admin"];

  const { data: erros = [], isLoading } = useQuery<SystemError[]>({
    queryKey,
    refetchInterval: 30_000,
    queryFn: async () => {
      const sb = supabase as any;
      const { data, error } = await sb
        .from("system_errors")
        .select("*")
        .order("ultimo_em", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as SystemError[];
    },
  });

  const origensDisponiveis = useMemo(() => {
    const set = new Set<string>();
    erros.forEach((e) => set.add(e.origem));
    return Array.from(set).sort();
  }, [erros]);

  const filtrados = useMemo(() => {
    return erros.filter((e) => {
      if (filtroSev !== "todas" && e.severidade !== filtroSev) return false;
      if (filtroOrigem !== "todas" && e.origem !== filtroOrigem) return false;
      if (filtroResolvido === "sim" && !e.resolvido) return false;
      if (filtroResolvido === "nao" && e.resolvido) return false;
      if (busca) {
        const b = busca.toLowerCase();
        if (
          !e.mensagem.toLowerCase().includes(b) &&
          !e.tipo.toLowerCase().includes(b) &&
          !e.origem.toLowerCase().includes(b)
        ) return false;
      }
      return true;
    });
  }, [erros, filtroSev, filtroOrigem, filtroResolvido, busca]);

  const resumo = useMemo(() => {
    const naoResolvidos = erros.filter((e) => !e.resolvido);
    const criticos = naoResolvidos.filter((e) => e.severidade === "critica").length;
    const porOrigem = new Map<string, number>();
    naoResolvidos.forEach((e) => {
      porOrigem.set(e.origem, (porOrigem.get(e.origem) ?? 0) + 1);
    });
    const top5 = Array.from(porOrigem.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    return {
      totalNaoResolvidos: naoResolvidos.length,
      criticos,
      top5,
    };
  }, [erros]);

  const marcarResolvido = async (id: string) => {
    setResolvendo(id);
    try {
      const sb = supabase as any;
      const { error } = await sb
        .from("system_errors")
        .update({ resolvido: true, resolvido_em: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey });
      toast.success("Erro marcado como resolvido");
    } catch (err: any) {
      toast.error("Não foi possível marcar como resolvido", { description: err.message });
    } finally {
      setResolvendo(null);
    }
  };

  const marcarTodosResolvidos = async () => {
    if (filtrados.filter((e) => !e.resolvido).length === 0) return;
    if (!confirm(`Marcar ${filtrados.filter((e) => !e.resolvido).length} erros visíveis como resolvidos?`)) return;
    setResolvendoTodos(true);
    try {
      const sb = supabase as any;
      const ids = filtrados.filter((e) => !e.resolvido).map((e) => e.id);
      const { error } = await sb
        .from("system_errors")
        .update({ resolvido: true, resolvido_em: new Date().toISOString() })
        .in("id", ids);
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey });
      toast.success(`${ids.length} erros marcados como resolvidos`);
    } catch (err: any) {
      toast.error("Não foi possível concluir", { description: err.message });
    } finally {
      setResolvendoTodos(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1280px] px-8 py-8">
      <div className="mb-7 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Erros do sistema</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Erros capturados automaticamente das Edge Functions, agrupados por hash. Atualiza a cada 30s.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={marcarTodosResolvidos}
          disabled={resolvendoTodos || filtrados.filter((e) => !e.resolvido).length === 0}
          className="gap-2"
        >
          {resolvendoTodos ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          Marcar todos visíveis como resolvidos
        </Button>
      </div>

      {/* Cards de resumo */}
      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <CardResumo titulo="Total não resolvidos" valor={resumo.totalNaoResolvidos} cor="bg-amber-500/15 text-amber-700 dark:text-amber-400" />
        <CardResumo titulo="Críticos" valor={resumo.criticos} cor="bg-red-500/15 text-red-700 dark:text-red-400" />
        <div className="rounded-xl border border-border bg-card p-5 shadow-softeum-sm">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Top origens</p>
          {resumo.top5.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">Nada por aqui.</p>
          ) : (
            <ul className="mt-3 space-y-1.5">
              {resumo.top5.map(([origem, qtd]) => (
                <li key={origem} className="flex items-center justify-between text-sm">
                  <span className="truncate text-foreground">{origem}</span>
                  <span className="ml-2 font-semibold text-foreground">{qtd}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Filtros */}
      <div className="mb-4 grid gap-3 rounded-xl border border-border bg-card p-4 shadow-softeum-sm md:grid-cols-4">
        <div className="space-y-1.5">
          <Label className="text-xs">Severidade</Label>
          <Select value={filtroSev} onValueChange={setFiltroSev}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas</SelectItem>
              {SEVERIDADES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Origem</Label>
          <Select value={filtroOrigem} onValueChange={setFiltroOrigem}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas</SelectItem>
              {origensDisponiveis.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Status</Label>
          <Select value={filtroResolvido} onValueChange={setFiltroResolvido}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="nao">Não resolvidos</SelectItem>
              <SelectItem value="sim">Resolvidos</SelectItem>
              <SelectItem value="todos">Todos</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Buscar</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="tipo, origem ou mensagem"
              className="pl-8"
            />
            {busca && (
              <button
                onClick={() => setBusca("")}
                className="absolute right-2 top-2 text-muted-foreground hover:text-foreground"
                aria-label="Limpar busca"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Tabela */}
      <div className="rounded-xl border border-border bg-card shadow-softeum-sm">
        {isLoading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Carregando...
          </div>
        ) : filtrados.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <AlertTriangle className="mb-2 h-8 w-8 opacity-30" />
            Nenhum erro encontrado com esses filtros.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3 text-left font-medium">Severidade</th>
                  <th className="px-4 py-3 text-left font-medium">Tipo / Origem</th>
                  <th className="px-4 py-3 text-left font-medium">Mensagem</th>
                  <th className="px-4 py-3 text-center font-medium">Ocorr.</th>
                  <th className="px-4 py-3 text-right font-medium">Última</th>
                  <th className="px-4 py-3 text-right font-medium">Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtrados.map((e) => (
                  <tr
                    key={e.id}
                    className={cn("border-b border-border/60 hover:bg-muted/20", e.resolvido && "opacity-60")}
                  >
                    <td className="px-4 py-3">
                      <span className={cn("inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider", CORES_SEVERIDADE[e.severidade])}>
                        {e.severidade}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-xs text-muted-foreground">{e.tipo}</div>
                      <div className="font-medium text-foreground">{e.origem}</div>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => setErroSelecionado(e)}
                        className="text-left text-foreground hover:underline"
                      >
                        <span className="line-clamp-2 max-w-md">{e.mensagem}</span>
                      </button>
                    </td>
                    <td className="px-4 py-3 text-center font-semibold">{e.count}</td>
                    <td className="px-4 py-3 text-right text-xs text-muted-foreground">
                      {new Date(e.ultimo_em).toLocaleString("pt-BR")}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {!e.resolvido ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => marcarResolvido(e.id)}
                          disabled={resolvendo === e.id}
                          className="gap-1.5"
                        >
                          {resolvendo === e.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                          Resolver
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">resolvido</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal de detalhes */}
      <Dialog open={!!erroSelecionado} onOpenChange={(o) => !o && setErroSelecionado(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className={cn("inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider", erroSelecionado && CORES_SEVERIDADE[erroSelecionado.severidade])}>
                {erroSelecionado?.severidade}
              </span>
              <span>{erroSelecionado?.tipo}</span>
              <span className="text-muted-foreground">·</span>
              <span className="font-mono text-sm">{erroSelecionado?.origem}</span>
            </DialogTitle>
          </DialogHeader>
          {erroSelecionado && (
            <div className="space-y-4">
              <div>
                <Label className="text-xs">Mensagem</Label>
                <p className="mt-1 rounded-lg border border-border bg-muted/30 p-3 text-sm font-mono whitespace-pre-wrap">{erroSelecionado.mensagem}</p>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <CampoDetalhe label="Ocorrências" valor={String(erroSelecionado.count)} />
                <CampoDetalhe label="Primeiro em" valor={new Date(erroSelecionado.primeiro_em).toLocaleString("pt-BR")} />
                <CampoDetalhe label="Último em" valor={new Date(erroSelecionado.ultimo_em).toLocaleString("pt-BR")} />
                <CampoDetalhe label="Tenant" valor={erroSelecionado.tenant_id ?? "—"} />
                <CampoDetalhe label="Hash" valor={erroSelecionado.hash_agrupamento} mono />
                <CampoDetalhe label="Alertado em" valor={erroSelecionado.alertado_em ? new Date(erroSelecionado.alertado_em).toLocaleString("pt-BR") : "—"} />
              </div>
              {erroSelecionado.detalhes && (
                <div>
                  <Label className="text-xs">Detalhes (JSON)</Label>
                  <pre className="mt-1 max-h-72 overflow-auto rounded-lg border border-border bg-muted/30 p-3 text-xs font-mono">
                    {JSON.stringify(erroSelecionado.detalhes, null, 2)}
                  </pre>
                </div>
              )}
              {!erroSelecionado.resolvido && (
                <div className="flex justify-end">
                  <Button onClick={() => { marcarResolvido(erroSelecionado.id); setErroSelecionado(null); }} className="gap-2">
                    <CheckCircle2 className="h-4 w-4" />
                    Marcar como resolvido
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CardResumo({ titulo, valor, cor }: { titulo: string; valor: number; cor: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-softeum-sm">
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{titulo}</p>
      <p className={cn("mt-2 inline-block rounded-lg px-3 py-1 text-2xl font-bold", cor)}>{valor}</p>
    </div>
  );
}

function CampoDetalhe({ label, valor, mono }: { label: string; valor: string; mono?: boolean }) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <p className={cn("mt-1 truncate text-sm text-foreground", mono && "font-mono text-xs")}>{valor}</p>
    </div>
  );
}
