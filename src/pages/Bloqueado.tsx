import { useNavigate } from "react-router-dom";
import { Lock, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SofteumLogo } from "@/components/SofteumLogo";
import { useAuth } from "@/contexts/AuthContext";

export default function Bloqueado() {
  const { signOut, motivoBloqueio, nomeTenant } = useAuth();
  const navigate = useNavigate();

  const handleSair = async () => {
    await signOut();
    navigate("/login", { replace: true });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md animate-fade-in">
        <div className="mb-10 flex justify-center">
          <SofteumLogo />
        </div>

        <div className="rounded-xl border border-destructive/30 bg-card p-8 shadow-softeum">
          <div className="mb-5 flex justify-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <Lock className="h-6 w-6" />
            </span>
          </div>

          <div className="text-center">
            <h1 className="text-xl font-bold tracking-tight text-foreground">
              Conta suspensa
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Sua conta está temporariamente suspensa. Entre em contato com o suporte.
            </p>
            {nomeTenant && (
              <p className="mt-3 text-xs text-muted-foreground">
                Empresa: <span className="font-medium text-foreground">{nomeTenant}</span>
              </p>
            )}
          </div>

          {motivoBloqueio && (
            <div className="mt-5 rounded-lg border border-destructive/20 bg-destructive/5 p-3.5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-destructive">
                Motivo
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">
                {motivoBloqueio}
              </p>
            </div>
          )}

          <Button onClick={handleSair} variant="outline" className="mt-6 w-full">
            <LogOut className="mr-2 h-4 w-4" /> Sair
          </Button>
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          © {new Date().getFullYear()} Softeum
        </p>
      </div>
    </div>
  );
}
