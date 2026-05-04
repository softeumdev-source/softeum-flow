# 🎨 Design System - Softeum Flow

## 🔒 REGRAS DE OURO - NÃO MEXER EM NADA DISSO

### ❌ PROIBIDO TOCAR:
- **Textos:** títulos, labels, placeholders, mensagens, botões
- **Funcionalidades:** autenticação, validações, APIs, banco de dados
- **Lógica:** hooks (useAuth, useToast), funções, redirecionamentos
- **Estrutura HTML:** ordem de elementos, componentes críticos
- **Integrações:** Supabase, GitHub, APIs externas

### ✅ PERMITIDO ALTERAR (DESIGN APENAS):
- **Cores:** backgrounds, texts, borders, gradients
- **Espaçamento:** padding, margin, gap, heights, widths
- **Tipografia:** font-size, font-weight, letter-spacing, line-height
- **Boxes/Cards:** border-radius, shadows, outlines
- **Layouts:** flexbox, grid, positioning (visual apenas)
- **Animações:** transições, keyframes, efeitos
- **Responsividade:** breakpoints, media queries (visual)
- **Ícones/Assets:** cores de ícones, estilos

## 📋 Checklist Antes de Cada Mudança:

Antes de fazer qualquer alteração, o Lovable deve perguntar:
- [ ] Isso afeta apenas CSS/estilos visuais?
- [ ] Nenhum import/export foi removido?
- [ ] Nenhuma função foi deletada?
- [ ] Nenhuma chamada de API foi alterada?
- [ ] Os textos estão exatamente iguais?
- [ ] A lógica de negócio continua intacta?

Se a resposta for NÃO em qualquer item = **NÃO FAÇA**

## 🚨 EXEMPLOS DO QUE NÃO FAZER:

```typescript
// ❌ PROIBIDO - Remover useAuth
// const { user } = useAuth(); ← NÃO DELETE ISSO

// ❌ PROIBIDO - Mudar texto de botão
// <button>Entrar</button> → <button>Login</button> ← PROIBIDO

// ❌ PROIBIDO - Alterar chamada de API
// await signIn(email, password); ← NÃO MUDE

// ❌ PROIBIDO - Remover validações
// if (!email) return; ← NUNCA REMOVA
```

## ✅ EXEMPLOS DO QUE PODE FAZER:

```typescript
// ✅ PERMITIDO - Mudar cores
background: "#FAF7F4" → background: "#F5F3F0"

// ✅ PERMITIDO - Aumentar padding
padding: "20px" → padding: "30px"

// ✅ PERMITIDO - Mudar font-size
fontSize: "14px" → fontSize: "16px"

// ✅ PERMITIDO - Adicionar animação
// transition: "all 0.3s ease"

// ✅ PERMITIDO - Mudar border-radius
borderRadius: "8px" → borderRadius: "12px"
```

## 🎯 Padrão de Comunicação

Sempre que o Lovable vai fazer uma alteração, deve dizer:
1. **O que vai mudar:** "Vou alterar a cor do botão"
2. **Como vai mudar:** "De #E8A5C4 para #7A6BB0"
3. **Confirmação:** "Isso afeta apenas CSS, certo?"

---

## 🎨 Design Tokens — Softeum Flow (V1)

### Fundo & Superfícies

| Token | Valor | Uso |
|-------|-------|-----|
| Fundo principal | `#FAF7F4` | Background da página |
| Card glassmorphism | `rgba(255,255,255,0.72)` | Card de login (+ `backdrop-filter: blur(20px)`) |
| Borda do card | `rgba(255,255,255,0.6)` | Border sutil |

### Orbs Animadas (gradient blobs)

| Cor | Tamanho | Posição | Animação |
|-----|---------|---------|----------|
| `#E8A5C4` rosa | 480×480px | Superior-esquerda | drift1 20s |
| `#B49BD4` lilás | 560×560px | Direita-meio | drift2 22s |
| `#8FB8E8` azul | 520×520px | Inferior-esquerda | drift3 21s |

Todas com `filter: blur(80px)` + `opacity: 0.55` + `mix-blend-mode: multiply`

### Cores de Texto

| Token | Valor | Uso |
|-------|-------|-----|
| Tinta principal | `#1A1F36` | Títulos |
| Cinza médio | `#5B6478` | Subtítulos / labels |
| Cinza sutil | `#8A92A6` | Footer / footnote |
| Lilás escuro | `#7A6BB0` | Link "Esqueci senha" |

### Botão "Entrar"

```
background: linear-gradient(135deg, #E8A5C4 0%, #B49BD4 50%, #8FB8E8 100%)
color: #FFFFFF
box-shadow: 0 8px 20px -6px rgba(180,155,212,0.6)
```

### Sombra do Card

```
0 24px 60px -20px rgba(180,155,212,0.35)
0 8px 24px -8px rgba(143,184,232,0.25)
```

### Grain Pattern

```
radial-gradient(circle at 20% 50%, rgba(26,31,54,0.04) 0%, transparent 50%)
radial-gradient(circle at 80% 80%, rgba(26,31,54,0.04) 0%, transparent 50%)
```

---

## 🔤 Tipografia

**Família:** Plus Jakarta Sans (Google Fonts)
**Mono (futuro):** Geist Mono

| Uso | Tamanho | Peso | Letter-spacing |
|-----|---------|------|----------------|
| Wordmark "Softeum" | 20px | 700 | -0.02em |
| Título principal | 32px | 700 | -0.02em |
| Subtítulo | 14px | 400 | normal |
| Labels dos inputs | 13px | 500 | normal |
| Botão "Entrar" | 15px | 600 | -0.005em |
| Link "Esqueci senha" | 13px | 500 | normal |
| Footer copyright | 12.5px | 400 | 0.01em |

**Line-height:** `1.1` no título · `1.5` no parágrafo

