import { useState, FormEvent } from "react";
import { Link } from "react-router-dom";
import { Loader2, MailCheck } from "lucide-react";
import { SofteumLogo } from "@/components/SofteumLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";

export default function RecuperarSenha() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [enviado, setEnviado] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setSubmitting(true);
    // Resposta uniforme (sucesso ou email-inexistente) pra não permitir
    // enumeração de emails cadastrados.
    await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setSubmitting(false);
    setEnviado(true);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md animate-fade-in">
        <div className="mb-10 flex justify-center">
          <SofteumLogo />
        </div>

        <div className="rounded-xl border border-border bg-card p-8 shadow-softeum">
          {enviado ? (
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-success/10 text-success">
                <MailCheck className="h-6 w-6" />
              </div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                Verifique seu e-mail
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Se o e-mail estiver cadastrado, você receberá um link para redefinir sua
                senha em instantes. O link expira em 1 hora.
              </p>
              <Button asChild variant="outline" className="mt-6 w-full">
                <Link to="/login">Voltar ao login</Link>
              </Button>
            </div>
          ) : (
            <>
              <div className="mb-6 text-center">
                <h1 className="text-2xl font-bold tracking-tight text-foreground">
                  Recuperar senha
                </h1>
                <p className="mt-1.5 text-sm text-muted-foreground">
                  Informe seu e-mail e enviaremos um link para redefinir a senha.
                </p>
              </div>

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

                <Button type="submit" className="w-full" size="lg" disabled={submitting}>
                  {submitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Enviando...
                    </>
                  ) : (
                    "Enviar link de recuperação"
                  )}
                </Button>
              </form>

              <div className="mt-4 text-center">
                <Link
                  to="/login"
                  className="text-xs text-muted-foreground hover:text-primary"
                >
                  Voltar ao login
                </Link>
              </div>
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
