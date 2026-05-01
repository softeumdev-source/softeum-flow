import { useEffect, useState } from "react";
import { Loader2, AlertTriangle } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const KEY_SEV_MIN = "severidade_minima_email";

const SEVERIDADES: Array<{ value: string; label: string }> = [
  { value: "baixa", label: "Baixa (todos os erros)" },
  { value: "media", label: "Média (padrão)" },
  { value: "alta", label: "Alta" },
  { value: "critica", label: "Crítica (apenas críticos)" },
];

export default function AdminConfiguracoes() {
  const [loading, setLoading] = useState(true);
  const [sevMin, setSevMin] = useState<string>("media");
  const [savingSev, setSavingSev] = useState(false);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const sb = supabase as any;
        const { data, error } = await sb
          .from("configuracoes_globais")
          .select("chave, valor")
          .eq("chave", KEY_SEV_MIN);
        if (error) throw error;
        (data ?? []).forEach((r: any) => {
          if (r.chave === KEY_SEV_MIN) setSevMin(r.valor ?? "media");
        });
      } catch (err: any) {
        toast.error("Erro ao carregar configurações", { description: err.message });
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const salvarSev = async (novoValor: string) => {
    setSevMin(novoValor);
    setSavingSev(true);
    try {
      const sb = supabase as any;
      const { error } = await sb
        .from("configuracoes_globais")
        .upsert({ chave: KEY_SEV_MIN, valor: novoValor }, { onConflict: "chave" });
      if (error) throw error;
      toast.success("Severidade mínima salva");
    } catch (err: any) {
      toast.error("Não foi possível salvar", { description: err.message });
    } finally {
      setSavingSev(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-[900px] px-8 py-8">
        <div className="flex items-center justify-center rounded-xl border border-border bg-card py-20 text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Carregando configurações...
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[900px] px-8 py-8">
      <div className="mb-7">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Configurações admin</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Configurações globais visíveis apenas para o Super Admin.
        </p>
      </div>

      <div className="space-y-6">
        <Section icone={AlertTriangle} titulo="Filtro de severidade" descricao="Quais erros viram notificação no sino do Super Admin.">
          <div className="rounded-lg border border-border bg-muted/20 px-4 py-4">
            <Label className="text-sm text-foreground">Severidade mínima para notificar</Label>
            <p className="mt-1 text-xs text-muted-foreground">
              Erros abaixo dessa severidade ainda são gravados em <code>system_errors</code> e aparecem em /admin/erros, mas não disparam notificação no sino.
            </p>
            <div className="mt-3 flex items-center gap-2">
              <Select value={sevMin} onValueChange={salvarSev} disabled={savingSev}>
                <SelectTrigger className="max-w-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SEVERIDADES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
              {savingSev && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}

function Section({
  icone: Icone,
  titulo,
  descricao,
  children,
}: {
  icone: typeof AlertTriangle;
  titulo: string;
  descricao: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-6 shadow-softeum-sm">
      <div className="mb-5 flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icone className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <h2 className="text-base font-semibold text-foreground">{titulo}</h2>
          <p className="text-xs text-muted-foreground">{descricao}</p>
        </div>
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}
