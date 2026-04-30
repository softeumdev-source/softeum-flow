// Dados de seed do tenant Demo (catálogo, DE-PARAs, layout ERP).
// Compartilhado entre inicializar-demo e simular-cenario-demo.

export const DEMO_TENANT_ID = "2b0389b5-e9bd-4279-8b2f-794ba132cdf5";
export const DEMO_CNPJ_COMPRADOR = "11.111.111/0001-11";
export const DEMO_NOME_COMPRADOR = "Atacadão Demo Ltda";

interface ProdutoSeed {
  codigo_erp: string;
  descricao: string;
  ean: string;
  categoria: string;
}

function gerarEan13(prefix: string, seq: number): string {
  // Pseudo-EAN para demo; não calculamos check-digit real, só preenchemos 13 dígitos
  const base = (prefix + String(seq).padStart(8, "0")).slice(0, 12);
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(base[i]) * (i % 2 === 0 ? 1 : 3);
  const check = (10 - (sum % 10)) % 10;
  return base + String(check);
}

const ALIMENTOS = [
  "Arroz Tipo 1 5kg", "Feijão Carioca 1kg", "Macarrão Espaguete 500g",
  "Açúcar Refinado 1kg", "Sal Refinado 1kg", "Óleo de Soja 900ml",
  "Farinha de Trigo 1kg", "Café Torrado e Moído 500g", "Leite em Pó Integral 400g",
  "Biscoito Recheado 130g",
];
const BEBIDAS = [
  "Água Mineral sem Gás 500ml", "Refrigerante Cola 2L", "Suco de Laranja 1L",
  "Cerveja Pilsen Lata 350ml", "Energético 250ml", "Chá Gelado Limão 1,5L",
  "Isotônico Tangerina 500ml", "Vinho Tinto Suave 750ml", "Café Solúvel 100g",
  "Achocolatado Pronto 200ml",
];
const LIMPEZA = [
  "Detergente Líquido Neutro 500ml", "Sabão em Pó 1kg", "Amaciante de Roupas 2L",
  "Desinfetante Lavanda 500ml", "Água Sanitária 1L", "Sabão em Barra 200g",
  "Lustra Móveis 200ml", "Limpa Vidros 500ml", "Esponja de Aço 60g",
  "Pano Multiuso 5un",
];
const HIGIENE = [
  "Sabonete em Barra 90g", "Shampoo Cabelos Normais 350ml", "Condicionador Hidratante 350ml",
  "Creme Dental 90g", "Escova Dental Adulto", "Desodorante Aerosol 150ml",
  "Papel Higiênico Folha Dupla 4un", "Absorvente com Abas 8un", "Hidratante Corporal 200ml",
  "Fio Dental 50m",
];
const DIVERSOS = [
  "Pilha AA 4un", "Lâmpada LED 9W", "Vela Decorativa 200g",
  "Saco de Lixo 30L 10un", "Fósforo Caixa 40 Palitos", "Fita Adesiva 12mmx30m",
  "Caneta Esferográfica Azul", "Caderno Espiral 96fls", "Cola Branca 90g",
  "Pasta com Elástico A4",
];

function blocoCategoria(prefixo: string, eanPrefix: string, categoria: string, descricoes: string[]): ProdutoSeed[] {
  return descricoes.map((descricao, idx) => ({
    codigo_erp: `${prefixo}-${String(idx + 1).padStart(3, "0")}`,
    descricao,
    ean: gerarEan13(eanPrefix, idx + 1),
    categoria,
  }));
}

export const CATALOGO_DEMO: ProdutoSeed[] = [
  ...blocoCategoria("ALIM", "789100", "Alimentos", ALIMENTOS),
  ...blocoCategoria("BEBI", "789200", "Bebidas", BEBIDAS),
  ...blocoCategoria("LIMP", "789300", "Limpeza", LIMPEZA),
  ...blocoCategoria("HIGI", "789400", "Higiene", HIGIENE),
  ...blocoCategoria("DIVE", "789500", "Diversos", DIVERSOS),
];

// DE-PARA cobre os 5 primeiros de cada categoria (25 de 50).
// Os outros 25 ficam sem DE-PARA — ideal para acionar a IA de sugestão.
export const DE_PARA_DEMO = CATALOGO_DEMO
  .filter((p) => Number(p.codigo_erp.split("-")[1]) <= 5)
  .map((p) => {
    const prefixoCliente = p.codigo_erp.startsWith("ALIM") ? "ATC-A"
      : p.codigo_erp.startsWith("BEBI") ? "ATC-B"
      : p.codigo_erp.startsWith("LIMP") ? "ATC-L"
      : p.codigo_erp.startsWith("HIGI") ? "ATC-H"
      : "ATC-D";
    // Number() remove o leading zero do codigo_erp ("001" → 1) pra casar
    // com o codigo_cliente curto que os cenários do simular-cenario-demo
    // passam (ex: "ATC-A1", não "ATC-A001").
    const idx = Number(p.codigo_erp.split("-")[1]);
    return {
      valor_origem: `${prefixoCliente}${idx}`,
      valor_destino: p.codigo_erp,
      descricao: p.descricao,
    };
  });

// Layout ERP de exemplo: planilha simples para colar e exportar.
// Mantemos só 1 (tenant_erp_config tem UNIQUE em tenant_id).
export const LAYOUT_DEMO_NOME = "layout-bling-demo.xlsx";
export const LAYOUT_DEMO_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
// Placeholder — a Edge Function gera o XLSX de verdade na hora; este é só um marker.
export const LAYOUT_DEMO_TIPO = "bling_like";
