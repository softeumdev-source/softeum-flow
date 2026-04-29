import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Bell, Boxes, Check, Copy, Loader2, MailWarning } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface Notificacao {
  id: string;
  tipo: string;
  titulo: string;
  mensagem: string;
  link: string | null;
  lida: boolean;
  created_at: string;
  lida_em: string | null;
}

const ICONES: Record<string, typeof Bell> = {
  gmail_desconectado: MailWarning,
  erro_sistema: AlertTriangle,
  codigos_novos: Boxes,
  pedido_duplicado: Copy,
  erro_leitura: AlertTriangle,
};

interface Props {
  scope?: "tenant" | "system";
}

export function NotificationBell({ scope = "tenant" }: Props) {
  const { tenantId, isSuperAdmin } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [marcandoId, setMarcandoId] = useState<string | null>(null);
  const [marcandoTodas, setMarcandoTodas] = useState(false);

  const isSystem = scope === "system";
  const queryKey = ["notificacoes_painel", isSystem ? "system" : tenantId];
  const enabled = isSystem ? isSuperAdmin : !!tenantId;

  const { data: notificacoes = [], isLoading } = useQuery<Notificacao[]>({
    queryKey,
    enabled,
    refetchInterval: 60_000,
    queryFn: async () => {
      const sb = supabase as any;
      const query = sb
        .from("notificacoes_painel")
        .select("id, tipo, titulo, mensagem, link, lida, created_at, lida_em")
        .order("created_at", { ascending: false })
        .limit(20);
      const finalQuery = isSystem
        ? query.is("tenant_id", null)
        : query.eq("tenant_id", tenantId);
      const { data, error } = await finalQuery;
      if (error) throw error;
      return (data ?? []) as Notificacao[];
    },
  });

  // Realtime: invalida a query toda vez que uma notificação é criada,
  // atualizada ou removida. Filtra do lado do canal pra reduzir chatter.
  useEffect(() => {
    if (!enabled) return;
    const filter = isSystem ? "tenant_id=is.null" : `tenant_id=eq.${tenantId}`;
    const channel = supabase
      .channel(`notificacoes_painel_${isSystem ? "system" : tenantId}`)
      .on(
        "postgres_changes" as any,
        { event: "*", schema: "public", table: "notificacoes_painel", filter },
        () => {
          queryClient.invalidateQueries({ queryKey });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, isSystem, tenantId]);

  const naoLidas = notificacoes.filter((n) => !n.lida).length;

  const marcarComoLida = async (id: string) => {
    setMarcandoId(id);
    try {
      const sb = supabase as any;
      const { error } = await sb
        .from("notificacoes_painel")
        .update({ lida: true, lida_em: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey });
    } catch (err: any) {
      toast.error("Não foi possível marcar como lida", { description: err.message });
    } finally {
      setMarcandoId(null);
    }
  };

  const marcarTodasComoLidas = async () => {
    setMarcandoTodas(true);
    try {
      const sb = supabase as any;
      let query = sb
        .from("notificacoes_painel")
        .update({ lida: true, lida_em: new Date().toISOString() })
        .eq("lida", false);
      query = isSystem ? query.is("tenant_id", null) : query.eq("tenant_id", tenantId);
      const { error } = await query;
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey });
    } catch (err: any) {
      toast.error("Não foi possível marcar todas como lidas", { description: err.message });
    } finally {
      setMarcandoTodas(false);
    }
  };

  const abrirNotificacao = async (n: Notificacao) => {
    if (!n.lida) {
      // Marca como lida em background — não bloqueia a navegação.
      marcarComoLida(n.id).catch(() => undefined);
    }
    if (n.link) {
      setOpen(false);
      navigate(n.link);
    }
  };

  if (!enabled) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative h-9 w-9"
          aria-label={`Notificações${naoLidas > 0 ? ` (${naoLidas} não lidas)` : ""}`}
        >
          <Bell className="h-5 w-5" />
          {naoLidas > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
              {naoLidas > 99 ? "99+" : naoLidas}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div className="flex items-baseline gap-2">
            <h3 className="text-sm font-semibold text-foreground">Notificações</h3>
            {naoLidas > 0 && (
              <span className="text-xs text-muted-foreground">{naoLidas} não lida{naoLidas > 1 ? "s" : ""}</span>
            )}
          </div>
          {naoLidas > 0 && (
            <button
              type="button"
              onClick={marcarTodasComoLidas}
              disabled={marcandoTodas}
              className="text-xs font-medium text-primary hover:underline disabled:opacity-50"
            >
              {marcandoTodas ? "Marcando..." : "Marcar todas como lidas"}
            </button>
          )}
        </div>
        {isLoading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Carregando...
          </div>
        ) : notificacoes.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            Sem notificações por enquanto.
          </div>
        ) : (
          <ScrollArea className="max-h-96">
            <ul className="divide-y divide-border">
              {notificacoes.map((n) => {
                const Icone = ICONES[n.tipo] ?? Bell;
                const clickable = !!n.link;
                return (
                  <li
                    key={n.id}
                    className={cn(
                      "flex gap-3 px-4 py-3",
                      !n.lida && "bg-primary/5",
                      clickable && "cursor-pointer hover:bg-muted/40",
                    )}
                    onClick={clickable ? () => abrirNotificacao(n) : undefined}
                  >
                    <div
                      className={cn(
                        "mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full",
                        !n.lida ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
                      )}
                    >
                      <Icone className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="truncate text-sm font-semibold text-foreground">{n.titulo}</p>
                        <span className="flex-shrink-0 text-[11px] text-muted-foreground">
                          {formatDistanceToNow(new Date(n.created_at), { addSuffix: true, locale: ptBR })}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">{n.mensagem}</p>
                      {!n.lida && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); marcarComoLida(n.id); }}
                          disabled={marcandoId === n.id}
                          className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline disabled:opacity-50"
                        >
                          {marcandoId === n.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Check className="h-3 w-3" />
                          )}
                          Marcar como lida
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </ScrollArea>
        )}
      </PopoverContent>
    </Popover>
  );
}
