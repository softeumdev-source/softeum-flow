import { useState, FormEvent, useEffect } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { SofteumLogo } from "@/components/SofteumLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { signIn, user, isSuperAdmin, loading, sessaoInvalidada, acessoDesativado } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!loading && user) {
      const from = (location.state as any)?.from?.pathname;
      navigate(from || (isSuperAdmin ? "/admin" : "/dashboard"), { replace: true });
    }
  }, [user, isSuperAdmin, loading, navigate, location.state]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    setSubmitting(true);
    const { error } = await signIn(email.trim(), password);
    setSubmitting(false);
    if (error) {
      toast.error("Falha no login", { description: "E-mail ou senha incorretos." });
    } else {
      toast.success("Bem-vindo");
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md animate-fade-in">
        <div className="mb-10 flex justify-center">
          <SofteumLogo />
        </div>

        <div className="rounded-xl border border-border bg-card p-8 shadow-softeum">
          <div className="mb-6 text-center">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Entrar na sua conta
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Acesse o painel de pedidos da sua empresa
            </p>
          </div>

          {acessoDesativado && (
            <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
              Seu acesso foi desativado. Entre em contato com o administrador.
            </div>
          )}

          {sessaoInvalidada && (
            <div className="mb-4 rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
              Sua sessão foi encerrada porque outro dispositivo entrou na sua conta. Faça login novamente para continuar.
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                placeholder="voce@empresa.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={submitting}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password">Senha</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={submitting}
              />
            </div>

            <Button type="submit" className="w-full" size="lg" disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Entrando...
                </>
              ) : (
                "Entrar"
              )}
            </Button>
          </form>

          <div className="mt-4 text-center">
            <Link
              to="/recuperar-senha"
              className="text-xs text-muted-foreground hover:text-primary"
            >
              Esqueci minha senha
            </Link>
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          © {new Date().getFullYear()} Softeum · Processamento inteligente de pedidos
        </p>
      </div>
    </div>
  );
}
