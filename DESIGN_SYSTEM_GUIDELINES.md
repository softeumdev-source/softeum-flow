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

