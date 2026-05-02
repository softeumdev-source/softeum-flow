import { useEffect, useState, FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Loader2, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { SofteumLogo } from "@/components/SofteumLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Estado =
  | { tipo: "carregando" }
  | { tipo: "sem-token" }
  | { tipo: "nao-encontrado" }
  | { tipo: "cancelado" }
  | { tipo: "aceito" }
  | { tipo: "valido"; email: string; papel: "admin" | "operador"; tenantNome: string | null };

const PAPEL_LABEL: Record<"admin" | "operador", string> = {
  admin: "Administrador",
  operador: "Membro",
};

export default function AceitarConvite() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get("token") ?? "";

  const [estado, setEstado] = useState<Estado>({ tipo: "carregando" });
  const [nome, setNome] = useState("");
  const [senha, setSenha] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) {
      setEstado({ tipo: "sem-token" });
      return;
    }

    let cancelado = false;
    (async () => {
      const { data, error } = await supabase.functions.invoke("validar-convite", {
        body: { token },
      });
      if (cancelado) return;
      if (error || !data) {
        setEstado({ tipo: "nao-encontrado" });
        return;
      }
      if (!data.encontrado) {
        setEstado({ tipo: "nao-encontrado" });
        return;
      }
      if (data.status === "cancelado") {
        setEstado({ tipo: "cancelado" });
        return;
      }
      if (data.status === "aceito") {
        setEstado({ tipo: "aceito" });
        return;
      }
      setEstado({
        tipo: "valido",
        email: data.email,
        papel: data.papel,
        tenantNome: data.tenant_nome ?? null,
      });
    })();

    return () => {
      cancelado = true;
    };
  }, [token]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (estado.tipo !== "valido") return;
    if (nome.trim().length < 2) {
      toast.error("Informe seu nome completo");
      return;
    }
    if (senha.length < 8) {
      toast.error("A senha deve ter pelo menos 8 caracteres");
      return;
    }
    if (senha !== confirmacao) {
      toast.error("As senhas não coincidem");
      return;
    }

    setSubmitting(true);
    const { data, error } = await supabase.functions.invoke("aceitar-convite", {
      body: { token, nome: nome.trim(), senha },
    });
    setSubmitting(false);

    if (error || !data?.sucesso) {
      const msg = (error as any)?.message ?? data?.error ?? "Falha ao aceitar convite";
      // Se o convite virou aceito/cancelado entre o validar e o submit
      // (ex: outro reenvio cancelou), atualiza o estado da tela.
      if (data?.status === "aceito") setEstado({ tipo: "aceito" });
      else if (data?.status === "cancelado") setEstado({ tipo: "cancelado" });
      toast.error("Não foi possível aceitar", { description: msg });
      return;
    }

    if (data.sessao?.access_token && data.sessao?.refresh_token) {
      const { error: setErr } = await supabase.auth.setSession({
        access_token: data.sessao.access_token,
        refresh_token: data.sessao.refresh_token,
      });
      if (setErr) {
        toast.success("Convite aceito! Faça login com sua nova senha.");
        navigate("/login", { replace: true });
        return;
      }
      toast.success("Bem-vindo!");
      navigate("/dashboard", { replace: true });
      return;
    }

    // Sem sessão devolvida (signin falhou no backend) — manda pro login.
    toast.success(data.aviso ?? "Convite aceito. Faça login com sua nova senha.");
    navigate("/login", { replace: true });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md animate-fade-in">
        <div className="mb-10 flex justify-center">
          <SofteumLogo />
        </div>

        <div className="rounded-xl border border-border bg-card p-8 shadow-softeum">
          {estado.tipo === "carregando" && (
            <div className="flex flex-col items-center py-6">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <p className="mt-3 text-sm text-muted-foreground">Validando convite...</p>
            </div>
          )}

          {estado.tipo === "sem-token" && (
            <ErroEstado
              titulo="Link de convite inválido"
              descricao="Este link não contém um token válido. Solicite um novo convite ao administrador."
            />
          )}

          {estado.tipo === "nao-encontrado" && (
            <ErroEstado
              titulo="Convite não encontrado"
              descricao="Este link de convite não é válido. Solicite um novo ao administrador do tenant."
            />
          )}

          {estado.tipo === "cancelado" && (
            <ErroEstado
              titulo="Convite cancelado"
              descricao="Este convite foi cancelado pelo administrador. Solicite um novo se ainda precisar de acesso."
              icone="cancelado"
            />
          )}

          {estado.tipo === "aceito" && (
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-success/10 text-success">
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                Convite já aceito
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Esse convite já foi utilizado. Faça login normalmente para acessar o sistema.
              </p>
              <Button asChild className="mt-6 w-full">
                <Link to="/login">Ir para login</Link>
              </Button>
            </div>
          )}

          {estado.tipo === "valido" && (
            <>
              <div className="mb-6 text-center">
                <h1 className="text-2xl font-bold tracking-tight text-foreground">
                  Aceitar convite
                </h1>
                <p className="mt-1.5 text-sm text-muted-foreground">
                  {estado.tenantNome ? (
                    <>
                      Você foi convidado para <strong>{estado.tenantNome}</strong> como{" "}
                      <strong>{PAPEL_LABEL[estado.papel]}</strong>.
                    </>
                  ) : (
                    <>
                      Você foi convidado como <strong>{PAPEL_LABEL[estado.papel]}</strong>.
                    </>
                  )}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  E-mail: <span className="font-mono">{estado.email}</span>
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="nome">Nome completo</Label>
                  <Input
                    id="nome"
                    type="text"
                    autoComplete="name"
                    required
                    placeholder="Seu nome"
                    value={nome}
                    onChange={(e) => setNome(e.target.value)}
                    disabled={submitting}
                    autoFocus
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="senha">Senha</Label>
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
                      Criando acesso...
                    </>
                  ) : (
                    "Aceitar e entrar"
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

function ErroEstado({
  titulo,
  descricao,
  icone = "erro",
}: {
  titulo: string;
  descricao: string;
  icone?: "erro" | "cancelado";
}) {
  return (
    <div className="text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        {icone === "cancelado" ? (
          <XCircle className="h-6 w-6" />
        ) : (
          <AlertTriangle className="h-6 w-6" />
        )}
      </div>
      <h1 className="text-2xl font-bold tracking-tight text-foreground">{titulo}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{descricao}</p>
      <Button asChild variant="outline" className="mt-6 w-full">
        <Link to="/login">Voltar ao login</Link>
      </Button>
    </div>
  );
}
