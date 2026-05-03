import { useCallback, useMemo, useState } from "react";
import { AlertTriangle, Ban, GitBranch, Loader2, Play, Search, X } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type TipoOperacao = "criar_coluna" | "mapear_existente" | "ignorar" | "falha_ddl";
type TabelaAlvo = "pedidos" | "pedido_itens";

interface SchemaLog {
  id: string;
  created_at: string;
  tipo_operacao: TipoOperacao;
  tenant_id_origem: string | null;
  tabela_alvo: TabelaAlvo;
  nome_coluna_origem: string;
  campo_sistema_resultado: string | null;
  tipo_dado_proposto: string | null;
  justificativa_ia: string | null;
  dados_amostra: any;
  confianca_ia: number | null;
  executado_em: string | null;
  executor: string | null;
  executor_user_id: string | null;
  ddl_executado: string | null;
  erro_ddl: string | null;
}

interface Tenant {
  id: string;
  nome: string;
}

const TIPOS: TipoOperacao[] = ["criar_coluna", "mapear_existente", "ignorar", "falha_ddl"];

const CORES_TIPO: Record<TipoOperacao, string> = {
  criar_coluna: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  mapear_existente: "bg-green-500/15 text-green-700 dark:text-green-400",
  ignorar: "bg-slate-500/15 text-slate-600 dark:text-slate-400",
  falha_ddl: "bg-red-500/15 text-red-700 dark:text-red-400",
};

export default function AdminSchemaLog() {
  const queryClient = useQueryClient();
  const [filtroTipo, setFiltroTipo] = useState<string>("todos");
  const [filtroTabela, setFiltroTabela] = useState<string>("todas");
  const [filtroStatus, setFiltroStatus] = useState<string>("todos");
  const [filtroTenant, setFiltroTenant] = useState<string>("todos");
  const [busca, setBusca] = useState<string>("");
  const [logSelecionado, setLogSelecionado] = useState<SchemaLog | null>(null);
  const [acaoEmCurso, setAcaoEmCurso] = useState<"executar" | "cancelar" | null>(null);

  const queryKey = ["schema_alteracoes_log_admin"];

  const { data: logs = [], isLoading } = useQuery<SchemaLog[]>({
    queryKey,
    refetchInterval: 30_000,
    queryFn: async () => {
      const sb = supabase as any;
      const { data, error } = await sb
        .from("schema_alteracoes_log")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as SchemaLog[];
    },
  });

  const { data: tenants = [] } = useQuery<Tenant[]>({
    queryKey: ["tenants_lookup_schema_log"],
    queryFn: async () => {
      const sb = supabase as any;
      const { data, error } = await sb.from("tenants").select("id, nome").order("nome");
      if (error) throw error;
      return (data ?? []) as Tenant[];
    },
  });

  const tenantNomePorId = useMemo(() => {
    const m = new Map<string, string>();
    tenants.forEach((t) => m.set(t.id, t.nome));
    return m;
  }, [tenants]);

  // Set de "trio" (tenant|tabela|coluna_origem) que possui row 'ignorar'
  // — usado pra calcular "pendente real" em memória, sem precisar de view.
  const ignoradosTrio = useMemo(() => {
    const set = new Set<string>();
    logs.forEach((l) => {
      if (l.tipo_operacao === "ignorar") {
        set.add(`${l.tenant_id_origem ?? ""}|${l.tabela_alvo}|${l.nome_coluna_origem}`);
      }
    });
    return set;
  }, [logs]);

  const isPendenteReal = useCallback(
    (l: SchemaLog) =>
      l.tipo_operacao === "criar_coluna" &&
      l.executado_em === null &&
      !ignoradosTrio.has(`${l.tenant_id_origem ?? ""}|${l.tabela_alvo}|${l.nome_coluna_origem}`),
    [ignoradosTrio],
  );

  const filtrados = useMemo(() => {
    return logs.filter((l) => {
      if (filtroTipo !== "todos" && l.tipo_operacao !== filtroTipo) return false;
      if (filtroTabela !== "todas" && l.tabela_alvo !== filtroTabela) return false;
      if (filtroTenant !== "todos" && l.tenant_id_origem !== filtroTenant) return false;
      if (filtroStatus === "pendente" && !isPendenteReal(l)) return false;
      if (filtroStatus === "executado" && l.executado_em === null) return false;
      if (busca) {
        const b = busca.toLowerCase();
        const blobs = [
          l.nome_coluna_origem,
          l.campo_sistema_resultado ?? "",
          l.justificativa_ia ?? "",
        ];
        if (!blobs.some((s) => s.toLowerCase().includes(b))) return false;
      }
      return true;
    });
  }, [logs, filtroTipo, filtroTabela, filtroTenant, filtroStatus, busca, isPendenteReal]);

  const resumo = useMemo(() => {
    const total = logs.length;
    const pendentes = logs.filter(isPendenteReal).length;
    const falhas = logs.filter((l) => l.tipo_operacao === "falha_ddl").length;
    return { total, pendentes, falhas };
  }, [logs, isPendenteReal]);

  const acionar = async (action: "executar" | "cancelar") => {
    if (!logSelecionado) return;
    const confirmMsg =
      action === "executar"
        ? `Forçar execução DDL para criar a coluna "${logSelecionado.campo_sistema_resultado}" em ${logSelecionado.tabela_alvo}?\n\nEssa ação altera o schema do banco e é IRREVERSÍVEL via painel.`
        : `Marcar a coluna "${logSelecionado.nome_coluna_origem}" como ignorada?\n\nNenhum DDL será executado e o registro original permanece (append-only).`;
    if (!confirm(confirmMsg)) return;

    setAcaoEmCurso(action);
    try {
      const sb = supabase as any;
      const { data, error } = await sb.functions.invoke("executar-ddl-schema", {
        body: { log_id: logSelecionado.id, action },
      });
      if (error) {
        const msg = data?.error ?? error.message ?? "Falha desconhecida";
        throw new Error(msg);
      }
      if (data?.error) throw new Error(data.error);

      toast.success(
        action === "executar" ? "DDL executado com sucesso" : "Marcado como ignorado",
      );
      await queryClient.invalidateQueries({ queryKey });
      setLogSelecionado(null);
    } catch (err: any) {
      toast.error(action === "executar" ? "Falha ao executar DDL" : "Falha ao cancelar", {
        description: err.message,
      });
    } finally {
      setAcaoEmCurso(null);
    }
  };

  const podeAgir = logSelecionado && isPendenteReal(logSelecionado);

  return (
    <div className="mx-auto w-full max-w-[1280px] px-8 py-8">
      <div className="mb-7 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Schema IA</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Auditoria de expansão dinâmica de schema proposta pela IA. Append-only, atualiza a cada 30s.
          </p>
        </div>
      </div>

      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <CardResumo titulo="Total de registros" valor={resumo.total} cor="bg-slate-500/15 text-slate-700 dark:text-slate-300" />
        <CardResumo titulo="DDL pendente" valor={resumo.pendentes} cor="bg-amber-500/15 text-amber-700 dark:text-amber-400" />
        <CardResumo titulo="Falhas DDL" valor={resumo.falhas} cor="bg-red-500/15 text-red-700 dark:text-red-400" />
      </div>

      <div className="mb-4 grid gap-3 rounded-xl border border-border bg-card p-4 shadow-softeum-sm md:grid-cols-5">
        <div className="space-y-1.5">
          <Label className="text-xs">Tipo</Label>
          <Select value={filtroTipo} onValueChange={setFiltroTipo}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              {TIPOS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Tabela alvo</Label>
          <Select value={filtroTabela} onValueChange={setFiltroTabela}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas</SelectItem>
              <SelectItem value="pedidos">pedidos</SelectItem>
              <SelectItem value="pedido_itens">pedido_itens</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Status DDL</Label>
          <Select value={filtroStatus} onValueChange={setFiltroStatus}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              <SelectItem value="pendente">Pendente</SelectItem>
              <SelectItem value="executado">Executado</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Tenant</Label>
          <Select value={filtroTenant} onValueChange={setFiltroTenant}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              {tenants.map((t) => <SelectItem key={t.id} value={t.id}>{t.nome}</SelectItem>)}
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
              placeholder="coluna, campo ou justificativa"
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

      <div className="rounded-xl border border-border bg-card shadow-softeum-sm">
        {isLoading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Carregando...
          </div>
        ) : filtrados.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <GitBranch className="mb-2 h-8 w-8 opacity-30" />
            Nenhum registro encontrado com esses filtros.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3 text-left font-medium">Tipo</th>
                  <th className="px-4 py-3 text-left font-medium">Tenant</th>
                  <th className="px-4 py-3 text-left font-medium">Tabela</th>
                  <th className="px-4 py-3 text-left font-medium">Coluna origem</th>
                  <th className="px-4 py-3 text-left font-medium">Campo sistema</th>
                  <th className="px-4 py-3 text-center font-medium">Conf.</th>
                  <th className="px-4 py-3 text-center font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium">Criado em</th>
                  <th className="px-4 py-3 text-left font-medium">Executor</th>
                  <th className="px-4 py-3 text-right font-medium">Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtrados.map((l) => {
                  const pendente = isPendenteReal(l);
                  return (
                    <tr
                      key={l.id}
                      className="cursor-pointer border-b border-border/60 hover:bg-muted/20"
                      onClick={() => setLogSelecionado(l)}
                    >
                      <td className="px-4 py-3">
                        <span className={cn("inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider", CORES_TIPO[l.tipo_operacao])}>
                          {l.tipo_operacao}
                        </span>
                      </td>
                      <td className="px-4 py-3 max-w-[180px] truncate">
                        {l.tenant_id_origem ? (tenantNomePorId.get(l.tenant_id_origem) ?? l.tenant_id_origem.slice(0, 8)) : "—"}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">{l.tabela_alvo}</td>
                      <td className="px-4 py-3">{l.nome_coluna_origem}</td>
                      <td className="px-4 py-3 font-mono text-xs">{l.campo_sistema_resultado ?? "—"}</td>
                      <td className="px-4 py-3 text-center text-xs">
                        {l.confianca_ia !== null ? l.confianca_ia.toFixed(2) : "—"}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {l.tipo_operacao === "criar_coluna" ? (
                          pendente ? (
                            <span className="inline-block rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">pendente</span>
                          ) : l.executado_em ? (
                            <span className="inline-block rounded-full bg-green-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-green-700 dark:text-green-400">executado</span>
                          ) : (
                            <span className="inline-block rounded-full bg-slate-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">cancelado</span>
                          )
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-xs text-muted-foreground">
                        {new Date(l.created_at).toLocaleString("pt-BR")}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{l.executor ?? "—"}</td>
                      <td className="px-4 py-3 text-right">
                        <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setLogSelecionado(l); }}>
                          Detalhes
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Dialog open={!!logSelecionado} onOpenChange={(o) => !o && setLogSelecionado(null)}>
        <DialogContent className="max-w-3xl">
          {logSelecionado && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 flex-wrap">
                  <span className={cn("inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider", CORES_TIPO[logSelecionado.tipo_operacao])}>
                    {logSelecionado.tipo_operacao}
                  </span>
                  <span className="font-mono text-sm">{logSelecionado.tabela_alvo}</span>
                  <span className="text-muted-foreground">·</span>
                  <span>{logSelecionado.nome_coluna_origem}</span>
                  {logSelecionado.campo_sistema_resultado && (
                    <>
                      <span className="text-muted-foreground">→</span>
                      <span className="font-mono text-sm">{logSelecionado.campo_sistema_resultado}</span>
                    </>
                  )}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="grid gap-3 md:grid-cols-3">
                  <CampoDetalhe
                    label="Tenant"
                    valor={logSelecionado.tenant_id_origem
                      ? (tenantNomePorId.get(logSelecionado.tenant_id_origem) ?? logSelecionado.tenant_id_origem)
                      : "—"}
                  />
                  <CampoDetalhe label="Confiança IA" valor={logSelecionado.confianca_ia !== null ? logSelecionado.confianca_ia.toFixed(3) : "—"} />
                  <CampoDetalhe label="Tipo dado proposto" valor={logSelecionado.tipo_dado_proposto ?? "—"} />
                  <CampoDetalhe label="Criado em" valor={new Date(logSelecionado.created_at).toLocaleString("pt-BR")} />
                  <CampoDetalhe label="Executado em" valor={logSelecionado.executado_em ? new Date(logSelecionado.executado_em).toLocaleString("pt-BR") : "—"} />
                  <CampoDetalhe label="Executor" valor={logSelecionado.executor ?? "—"} />
                </div>

                {logSelecionado.justificativa_ia && (
                  <div>
                    <Label className="text-xs">Justificativa da IA</Label>
                    <p className="mt-1 rounded-lg border border-border bg-muted/30 p-3 text-sm whitespace-pre-wrap">
                      {logSelecionado.justificativa_ia}
                    </p>
                  </div>
                )}

                {logSelecionado.dados_amostra && (
                  <div>
                    <Label className="text-xs">Dados de amostra</Label>
                    <pre className="mt-1 max-h-40 overflow-auto rounded-lg border border-border bg-muted/30 p-3 text-xs font-mono">
                      {JSON.stringify(logSelecionado.dados_amostra, null, 2)}
                    </pre>
                  </div>
                )}

                {logSelecionado.ddl_executado && (
                  <div>
                    <Label className="text-xs">DDL executado</Label>
                    <pre className="mt-1 rounded-lg border border-green-500/30 bg-green-500/5 p-3 text-xs font-mono text-green-700 dark:text-green-400 whitespace-pre-wrap">
                      {logSelecionado.ddl_executado}
                    </pre>
                  </div>
                )}

                {logSelecionado.erro_ddl && (
                  <div>
                    <Label className="text-xs">Erro DDL</Label>
                    <pre className="mt-1 rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-xs font-mono text-red-700 dark:text-red-400 whitespace-pre-wrap">
                      {logSelecionado.erro_ddl}
                    </pre>
                  </div>
                )}

                {podeAgir && (
                  <div className="flex justify-end gap-2 border-t border-border pt-4">
                    <Button
                      variant="outline"
                      onClick={() => acionar("cancelar")}
                      disabled={acaoEmCurso !== null}
                      className="gap-2"
                    >
                      {acaoEmCurso === "cancelar" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />}
                      Marcar como ignorada
                    </Button>
                    <Button
                      onClick={() => acionar("executar")}
                      disabled={acaoEmCurso !== null}
                      className="gap-2"
                    >
                      {acaoEmCurso === "executar" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                      Forçar execução DDL
                    </Button>
                  </div>
                )}
                {!podeAgir && logSelecionado.tipo_operacao === "criar_coluna" && (
                  <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
                    <AlertTriangle className="h-4 w-4" />
                    Sem ações disponíveis: registro já foi executado ou cancelado.
                  </div>
                )}
              </div>
            </>
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

function CampoDetalhe({ label, valor }: { label: string; valor: string }) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <p className="mt-1 truncate text-sm text-foreground">{valor}</p>
    </div>
  );
}
