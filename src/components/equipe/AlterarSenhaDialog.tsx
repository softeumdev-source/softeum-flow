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

export function AlterarSenhaDialog({ open, onOpenChange }: Props) {
  const [novaSenha, setNovaSenha] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [loading, setLoading] = useState(false);

  const reset = () => {
    setNovaSenha("");
    setConfirmar("");
  };

  const handleClose = (v: boolean) => {
    if (!v) reset();
    onOpenChange(v);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (novaSenha.length < 8) {
      toast.error("A nova senha deve ter pelo menos 8 caracteres");
      return;
    }
    if (novaSenha !== confirmar) {
      toast.error("As senhas não coincidem");
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: novaSenha });
      if (error) throw error;

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
            Escolha uma nova senha de pelo menos 8 caracteres.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
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
