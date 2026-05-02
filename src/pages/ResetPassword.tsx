import { useEffect, useState, FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Loader2, AlertTriangle } from "lucide-react";
import { SofteumLogo } from "@/components/SofteumLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type EstadoSessao = "carregando" | "valida" | "invalida";

export default function ResetPassword() {
  const navigate = useNavigate();
  const [estadoSessao, setEstadoSessao] = useState<EstadoSessao>("carregando");
  const [senha, setSenha] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelado = false;

    // O Supabase JS detecta automaticamente o token no hash da URL e
    // estabelece sessão de recovery. Pode chegar via getSession() inicial
    // ou via onAuthStateChange ('PASSWORD_RECOVERY' / 'SIGNED_IN').
    supabase.auth.getSession().then(({ data }) => {
      if (cancelado) return;
      if (data.session) setEstadoSessao("valida");
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelado) return;
      if (event === "PASSWORD_RECOVERY" || (session && event === "SIGNED_IN")) {
        setEstadoSessao("valida");
      }
    });

    // Se em 3s não houve sessão, considera link inválido/expirado.
    const timeout = setTimeout(() => {
      if (cancelado) return;
      setEstadoSessao((curr) => (curr === "carregando" ? "invalida" : curr));
    }, 3000);

    return () => {
      cancelado = true;
      clearTimeout(timeout);
      sub.subscription.unsubscribe();
    };
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (senha.length < 8) {
      toast.error("A senha deve ter pelo menos 8 caracteres");
      return;
    }
    if (senha !== confirmacao) {
      toast.error("As senhas não coincidem");
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.auth.updateUser({ password: senha });
    setSubmitting(false);
    if (error) {
      toast.error("Não foi possível redefinir a senha", { description: error.message });
      return;
    }
    toast.success("Senha redefinida com sucesso");
    navigate("/dashboard", { replace: true });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md animate-fade-in">
        <div className="mb-10 flex justify-center">
          <SofteumLogo />
        </div>

        <div className="rounded-xl border border-border bg-card p-8 shadow-softeum">
          {estadoSessao === "carregando" && (
            <div className="flex flex-col items-center py-6">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <p className="mt-3 text-sm text-muted-foreground">Validando link...</p>
            </div>
          )}

          {estadoSessao === "invalida" && (
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                <AlertTriangle className="h-6 w-6" />
              </div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                Link inválido ou expirado
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Este link de recuperação não é mais válido. Solicite um novo para continuar.
              </p>
              <Button asChild className="mt-6 w-full">
                <Link to="/recuperar-senha">Solicitar novo link</Link>
              </Button>
              <Button asChild variant="outline" className="mt-2 w-full">
                <Link to="/login">Voltar ao login</Link>
              </Button>
            </div>
          )}

          {estadoSessao === "valida" && (
            <>
              <div className="mb-6 text-center">
                <h1 className="text-2xl font-bold tracking-tight text-foreground">
                  Definir nova senha
                </h1>
                <p className="mt-1.5 text-sm text-muted-foreground">
                  Escolha uma senha de pelo menos 8 caracteres.
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="senha">Nova senha</Label>
                  <Input
                    id="senha"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={8}
                    placeholder="••••••••"
                    value={senha}
                    onChange={(e) => setSenha(e.target.value)}
                    disabled={submitting}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="confirmacao">Confirmar senha</Label>
                  <Input
                    id="confirmacao"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={8}
                    placeholder="••••••••"
                    value={confirmacao}
                    onChange={(e) => setConfirmacao(e.target.value)}
                    disabled={submitting}
                  />
                </div>

                <Button type="submit" className="w-full" size="lg" disabled={submitting}>
                  {submitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Salvando...
                    </>
                  ) : (
                    "Definir nova senha"
                  )}
                </Button>
              </form>
            </>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          © {new Date().getFullYear()} Softeum · Processamento inteligente de pedidos
        </p>
      </div>
    </div>
  );
}
