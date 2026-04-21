import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Plano {
  id: string;
  nome: string;
  limite_pedidos_mes: number;
  preco_mensal: number | null;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated?: () => void;
}

const slugify = (v: string) =>
  v
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);

export function NovoClienteDialog({ open, onOpenChange, onCreated }: Props) {
  const [planos, setPlanos] = useState<Plano[]>([]);
  const [nome, setNome] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [planoId, setPlanoId] = useState<string>("");
  const [limite, setLimite] = useState<string>("100");
  const [limiteUsuarios, setLimiteUsuarios] = useState<string>("5");
  const [valorExcedente, setValorExcedente] = useState<string>("0,50");
  const [loading, setLoading] = useState(false);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    (supabase as any)
      .from("planos")
      .select("id, nome, limite_pedidos_mes, preco_mensal")
      .order("preco_mensal", { ascending: true, nullsFirst: true })
      .then(({ data, error }: any) => {
        if (error) {
          toast.error("Erro ao carregar planos: " + error.message);
        } else {
          setPlanos(data ?? []);
        }
        setLoading(false);
      });
  }, [open]);

  useEffect(() => {
    if (open) {
      setNome("");
      setSlug("");
      setSlugTouched(false);
      setPlanoId("");
      setLimite("100");
      setLimiteUsuarios("5");
      setValorExcedente("0,50");
    }
  }, [open]);

  const onPlanoChange = (id: string) => {
    setPlanoId(id);
    const p = planos.find((x) => x.id === id);
    if (p) setLimite(String(p.limite_pedidos_mes));
  };

  const onNomeChange = (v: string) => {
    setNome(v);
    if (!slugTouched) setSlug(slugify(v));
  };

  const handleSubmit = async () => {
    if (!nome.trim()) return toast.error("Informe o nome do cliente");
    if (!slug.trim()) return toast.error("Informe o slug");
    const limiteNum = parseInt(limite, 10);
    if (!Number.isFinite(limiteNum) || limiteNum <= 0) return toast.error("Limite de documentos inválido");
    const limiteUsuariosNum = parseInt(limiteUsuarios, 10);
    if (!Number.isFinite(limiteUsuariosNum) || limiteUsuariosNum <= 0) return toast.error("Limite de usuários inválido");
    const valorNum = parseFloat(valorExcedente.replace(",", "."));
    if (!Number.isFinite(valorNum) || valorNum < 0) return toast.error("Valor por excedente inválido");

    setSalvando(true);
    try {
      const sb = supabase as any;
      const { data: tenant, error: e1 } = await sb
        .from("tenants")
        .insert({
          nome: nome.trim(),
          slug: slug.trim(),
          plano_id: planoId || null,
          limite_pedidos_mes: limiteNum,
          limite_usuarios: limiteUsuariosNum,
          ativo: true,
        })
        .select("id")
        .single();
      if (e1) throw e1;

      const { error: e2 } = await sb.from("configuracoes").insert({
        tenant_id: tenant.id,
        chave: "valor_excedente",
        valor: String(valorNum),
        descricao: "Valor cobrado por documento excedente (R$)",
      });
      if (e2) throw e2;

      toast.success("Cliente cadastrado com sucesso");
      onOpenChange(false);
      onCreated?.();
    } catch (e: any) {
      toast.error("Erro ao cadastrar: " + (e?.message ?? e));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Novo cliente</DialogTitle>
          <DialogDescription>Cadastre um novo tenant com plano e limites de uso.</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : (
          <div className="grid gap-4 py-2">
            <div className="grid gap-1.5">
              <Label htmlFor="nome">Nome</Label>
              <Input id="nome" value={nome} onChange={(e) => onNomeChange(e.target.value)} placeholder="Acme Indústria" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="slug">Slug</Label>
              <Input id="slug" value={slug} onChange={(e) => { setSlug(slugify(e.target.value)); setSlugTouched(true); }} placeholder="acme-industria" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="plano">Plano</Label>
              <Select value={planoId} onValueChange={onPlanoChange}>
                <SelectTrigger id="plano"><SelectValue placeholder="Selecione um plano" /></SelectTrigger>
                <SelectContent>
                  {planos.length === 0 && <div className="px-2 py-1.5 text-xs text-muted-foreground">Nenhum plano cadastrado.</div>}
                  {planos.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.nome} — {p.limite_pedidos_mes.toLocaleString("pt-BR")} pedidos/mês
                      {p.preco_mensal != null ? ` · R$ ${Number(p.preco_mensal).toFixed(2).replace(".", ",")}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="limite">Documentos / mês</Label>
                <Input id="limite" type="number" min={1} value={limite} onChange={(e) => setLimite(e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="limite-usuarios">Limite de usuários</Label>
                <Input id="limite-usuarios" type="number" min={1} value={limiteUsuarios} onChange={(e) => setLimiteUsuarios(e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="excedente">Valor excedente (R$)</Label>
                <Input id="excedente" inputMode="decimal" value={valorExcedente} onChange={(e) => setValorExcedente(e.target.value)} placeholder="0,50" />
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={salvando}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={salvando || loading}>
            {salvando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Cadastrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
