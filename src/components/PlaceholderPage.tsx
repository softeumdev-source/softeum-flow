import { ReactNode } from "react";

interface PlaceholderProps {
  titulo: string;
  descricao: string;
  children?: ReactNode;
}

export function PlaceholderPage({ titulo, descricao, children }: PlaceholderProps) {
  return (
    <div className="mx-auto w-full max-w-[1400px] px-8 py-8">
      <div className="mb-7">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{titulo}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{descricao}</p>
      </div>
      <div className="rounded-xl border border-dashed border-border bg-card p-12 text-center shadow-softeum-sm">
        <p className="text-sm font-medium text-foreground">Em construção</p>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Esta tela será implementada na próxima fase, após a conexão ao Supabase.
        </p>
        {children}
      </div>
    </div>
  );
}
