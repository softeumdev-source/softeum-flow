import { useState } from "react";
import { Copy, Check, Mail, KeyRound, Eye, EyeOff } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  email: string;
  senha: string;
  empresaNome?: string;
}

export function CredenciaisDialog({ open, onOpenChange, email, senha, empresaNome }: Props) {
  const [copied, setCopied] = useState<"email" | "senha" | "tudo" | null>(null);
  const [mostrarSenha, setMostrarSenha] = useState(false);

  const textoCompleto =
    `Credenciais de acesso${empresaNome ? ` — ${empresaNome}` : ""}\n` +
    `Email: ${email}\n` +
    `Senha provisória: ${senha}\n` +
    `\nRecomendamos alterar a senha no primeiro acesso.`;

  const copy = async (valor: string, tipo: "email" | "senha" | "tudo") => {
    try {
      await navigator.clipboard.writeText(valor);
      setCopied(tipo);
      toast.success("Copiado para a área de transferência");
      setTimeout(() => setCopied(null), 1500);
    } catch {
      toast.error("Falha ao copiar");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Cliente cadastrado com sucesso!</DialogTitle>
          <DialogDescription>
            Envie as credenciais abaixo para o cliente realizar o primeiro acesso.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 py-2">
          <div className="rounded-lg border border-border bg-muted/40 p-3">
            <div className="mb-1 flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <Mail className="h-3.5 w-3.5" /> E-mail
            </div>
            <div className="flex items-center justify-between gap-2">
              <code className="flex-1 break-all font-mono text-sm text-foreground">{email}</code>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => copy(email, "email")}
                className="h-7 shrink-0 px-2"
              >
                {copied === "email" ? (
                  <Check className="h-3.5 w-3.5 text-success" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </Button>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-muted/40 p-3">
            <div className="mb-1 flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <KeyRound className="h-3.5 w-3.5" /> Senha provisória
            </div>
            <div className="flex items-center justify-between gap-2">
              <code className="flex-1 break-all font-mono text-sm text-foreground">
                {mostrarSenha ? senha : "•".repeat(senha.length)}
              </code>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setMostrarSenha((v) => !v)}
                className="h-7 shrink-0 px-2"
                aria-label={mostrarSenha ? "Ocultar senha" : "Mostrar senha"}
              >
                {mostrarSenha ? (
                  <EyeOff className="h-3.5 w-3.5" />
                ) : (
                  <Eye className="h-3.5 w-3.5" />
                )}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => copy(senha, "senha")}
                className="h-7 shrink-0 px-2"
                aria-label="Copiar senha"
              >
                {copied === "senha" ? (
                  <Check className="h-3.5 w-3.5 text-success" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </Button>
            </div>
          </div>

          <p className="rounded-md border border-warning/30 bg-warning/10 p-2.5 text-xs text-warning">
            Esta senha não será exibida novamente. Copie e envie ao cliente agora.
          </p>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => copy(textoCompleto, "tudo")}>
            {copied === "tudo" ? (
              <Check className="mr-1 h-4 w-4 text-success" />
            ) : (
              <Copy className="mr-1 h-4 w-4" />
            )}
            Copiar tudo
          </Button>
          <Button onClick={() => onOpenChange(false)}>Concluir</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
