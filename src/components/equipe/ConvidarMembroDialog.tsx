import { useState } from "react";
import { Loader2, UserPlus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { z } from "zod";

type Papel = "admin" | "operador";

const schema = z.object({
  nome: z.string().trim().min(2, "Informe o nome").max(120, "Nome muito longo"),
  email: z.string().trim().email("E-mail inválido").max(255),
  papel: z.enum(["admin", "operador"]),
});

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSubmit: (dados: { nome: string; email: string; papel: Papel }) => Promise<void>;
}

export function ConvidarMembroDialog({ open, onOpenChange, onSubmit }: Props) {
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [papel, setPapel] = useState<Papel>("operador");
  const [salvando, setSalvando] = useState(false);

  const reset = () => {
    setNome("");
    setEmail("");
    setPapel("operador");
    setSalvando(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse({ nome, email, papel });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setSalvando(true);
    try {
      await onSubmit(parsed.data);
      reset();
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!salvando) {
          if (!v) reset();
          onOpenChange(v);
        }
      }}
    >
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-4 w-4 text-primary" /> Convidar membro
          </DialogTitle>
          <DialogDescription>
            Será criado um acesso com senha provisória que você poderá enviar ao novo membro.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label htmlFor="convite-nome">Nome</Label>
            <Input
              id="convite-nome"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Nome completo"
              autoFocus
              disabled={salvando}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="convite-email">E-mail</Label>
            <Input
              id="convite-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="email@empresa.com"
              disabled={salvando}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="convite-papel">Papel</Label>
            <Select value={papel} onValueChange={(v) => setPapel(v as Papel)} disabled={salvando}>
              <SelectTrigger id="convite-papel">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">Administrador</SelectItem>
                <SelectItem value="operador">Operador</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Administradores podem gerenciar membros e configurações. Operadores apenas usam o
              sistema.
            </p>
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={salvando}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={salvando}>
              {salvando ? (
                <>
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" /> Criando...
                </>
              ) : (
                "Criar acesso"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
