import { useState } from "react";
import { Loader2, KeyRound } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  email?: string;
}

export function AlterarSenhaDialog({ open, onOpenChange, email }: Props) {
  const [senhaAtual, setSenhaAtual] = useState("");
  const [novaSenha, setNovaSenha] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [loading, setLoading] = useState(false);

  const reset = () => {
    setSenhaAtual("");
    setNovaSenha("");
    setConfirmar("");
  };

  const handleClose = (v: boolean) => {
    if (!loading) {
      if (!v) reset();
      onOpenChange(v);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email) {
      toast.error("Não foi possível identificar seu e-mail. Faça login novamente.");
      return;
    }
    if (!senhaAtual) {
      toast.error("Informe sua senha atual");
      return;
    }
    if (novaSenha.length < 8) {
      toast.error("A nova senha deve ter pelo menos 8 caracteres");
      return;
    }
    if (novaSenha !== confirmar) {
      toast.error("As senhas não coincidem");
      return;
    }
    if (novaSenha === senhaAtual) {
      toast.error("A nova senha deve ser diferente da atual");
      return;
    }

    setLoading(true);
    try {
      // Re-autentica com a senha atual antes de permitir trocar.
      // signInWithPassword renova a sessão do mesmo usuário (não causa
      // problema funcional — é o próprio user já logado).
      const { error: authErr } = await supabase.auth.signInWithPassword({
        email,
        password: senhaAtual,
      });
      if (authErr) {
        toast.error("Senha atual incorreta");
        return;
      }

      const { error: updErr } = await supabase.auth.updateUser({ password: novaSenha });
      if (updErr) throw updErr;

      toast.success("Senha alterada com sucesso");
      reset();
      onOpenChange(false);
    } catch (err: any) {
      toast.error("Não foi possível alterar a senha", { description: err.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4" />
            Alterar senha
          </DialogTitle>
          <DialogDescription>
            Confirme sua senha atual e escolha uma nova com pelo menos 8 caracteres.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="senha-atual">Senha atual</Label>
            <Input
              id="senha-atual"
              type="password"
              autoComplete="current-password"
              value={senhaAtual}
              onChange={(e) => setSenhaAtual(e.target.value)}
              required
              disabled={loading}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="nova-senha">Nova senha</Label>
            <Input
              id="nova-senha"
              type="password"
              autoComplete="new-password"
              value={novaSenha}
              onChange={(e) => setNovaSenha(e.target.value)}
              minLength={8}
              required
              disabled={loading}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirmar-senha">Confirmar nova senha</Label>
            <Input
              id="confirmar-senha"
              type="password"
              autoComplete="new-password"
              value={confirmar}
              onChange={(e) => setConfirmar(e.target.value)}
              minLength={8}
              required
              disabled={loading}
            />
          </div>

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => handleClose(false)} disabled={loading}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Alterar senha
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
