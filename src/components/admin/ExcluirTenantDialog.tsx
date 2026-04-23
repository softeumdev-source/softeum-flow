import { useEffect, useState } from "react";
import { Loader2, AlertTriangle } from "lucide-react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface ExcluirTenantDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantId: string | null;
  tenantNome: string | null;
  /** Disparado após exclusão bem-sucedida (ex: recarregar lista, navegar). */
  onExcluido?: () => void;
}

export function ExcluirTenantDialog({
  open,
  onOpenChange,
  tenantId,
  tenantNome,
  onExcluido,
}: ExcluirTenantDialogProps) {
  const [confirmacao, setConfirmacao] = useState("");
  const [excluindo, setExcluindo] = useState(false);

  useEffect(() => {
    if (!open) {
      setConfirmacao("");
      setExcluindo(false);
    }
  }, [open]);

  const nomeOk =
    tenantNome != null && confirmacao.trim().toLowerCase() === tenantNome.trim().toLowerCase();

  const confirmar = async () => {
    if (!tenantId || !nomeOk) return;
    setExcluindo(true);
    try {
      const sb = supabase as any;
      console.log("[ExcluirTenant] Iniciando exclusão de", tenantId, tenantNome);

      // Usa .select() para que o PostgREST retorne as linhas removidas e
      // possamos detectar silent-fail por RLS (delete sem erro mas 0 linhas).
      const { data, error, status, statusText } = await sb
        .from("tenants")
        .delete()
        .eq("id", tenantId)
        .select("id, nome");

      console.log("[ExcluirTenant] Resposta:", { data, error, status, statusText });

      if (error) {
        // Erros mais comuns: FK violation (23503) ou RLS (42501)
        const code = (error as any).code;
        if (code === "23503") {
          throw new Error(
            "Não é possível excluir: existem dados vinculados (pedidos, membros, configs). " +
              "Detalhes: " + (error.message ?? ""),
          );
        }
        if (code === "42501" || /permission|rls|policy/i.test(error.message ?? "")) {
          throw new Error(
            "Permissão negada pelo banco (RLS). Verifique se o usuário é super admin. " +
              "Detalhes: " + (error.message ?? ""),
          );
        }
        throw error;
      }

      if (!data || data.length === 0) {
        // Sem erro mas nada foi removido — quase sempre RLS bloqueando silenciosamente.
        throw new Error(
          "Nenhuma linha foi removida. Provavelmente RLS está bloqueando o DELETE para este usuário. " +
            "Confirme se está logado como super admin.",
        );
      }

      toast.success(`${tenantNome} foi excluído permanentemente`);
      onOpenChange(false);
      onExcluido?.();
    } catch (e: any) {
      console.error("[ExcluirTenant] Erro:", e);
      toast.error("Erro ao excluir: " + (e?.message ?? e));
    } finally {
      setExcluindo(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={(o) => !excluindo && onOpenChange(o)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <AlertDialogTitle>Excluir empresa</AlertDialogTitle>
          <AlertDialogDescription>
            Tem certeza que deseja excluir{" "}
            <strong className="text-foreground">{tenantNome}</strong>? Esta ação não pode ser
            desfeita. Todos os dados do tenant serão removidos permanentemente.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-2 py-2">
          <Label htmlFor="confirmar-nome">
            Para confirmar, digite o nome da empresa:{" "}
            <span className="font-mono text-foreground">{tenantNome}</span>
          </Label>
          <Input
            id="confirmar-nome"
            value={confirmacao}
            onChange={(e) => setConfirmacao(e.target.value)}
            placeholder={tenantNome ?? ""}
            autoComplete="off"
            disabled={excluindo}
          />
          {confirmacao && !nomeOk && (
            <p className="text-xs text-destructive">O nome digitado não confere.</p>
          )}
        </div>

        <AlertDialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={excluindo}
          >
            Cancelar
          </Button>
          <Button
            onClick={confirmar}
            disabled={!nomeOk || excluindo}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {excluindo && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
            Excluir permanentemente
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
