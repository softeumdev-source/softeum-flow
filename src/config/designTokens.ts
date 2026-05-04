/**
 * 🎨 DESIGN TOKENS - Softeum Flow
 * Arquivo centralizado com todas as cores, tipografia e espaçamentos
 * Usar em TODAS as páginas para consistência visual
 */

// ============================================================
// 🎨 CORES
// ============================================================

export const colors = {
  // Fundos & Superfícies
  background: {
    primary: "#FAF7F4", // fundo off-white principal
    card: "rgba(255, 255, 255, 0.72)", // card com glassmorphism
    cardBorder: "rgba(255, 255, 255, 0.6)", // borda sutil do card
  },

  // Orbs Animadas
  orbs: {
    pink: "#E8A5C4", // rosa (superior-esquerda)
    purple: "#B49BD4", // lilás (direita-meio)
    blue: "#8FB8E8", // azul (inferior-esquerda)
  },

  // Textos
  text: {
    primary: "#1A1F36", // tinta principal (títulos)
    secondary: "#5B6478", // cinza médio (subtítulos/labels)
    tertiary: "#8A92A6", // cinza sutil (footnote)
    accent: "#7A6BB0", // lilás escuro (links)
  },

  // Botões & Interações
  button: {
    gradient: "linear-gradient(135deg, #E8A5C4 0%, #B49BD4 50%, #8FB8E8 100%)",
    text: "#FFFFFF",
  },

  // Status
  status: {
    success: "#10B981",
    error: "#EF4444",
    warning: "#F59E0B",
    info: "#3B82F6",
  },
};

// ============================================================
// 🔤 TIPOGRAFIA
// ============================================================

export const typography = {
  fontFamily: {
    primary: "'Plus Jakarta Sans', 'Inter', system-ui, sans-serif",
    mono: "'Geist Mono', 'Courier New', monospace",
  },

  fontSize: {
    wordmark: "20px",
    h1: "32px",
    h2: "24px",
    h3: "20px",
    body: "14px",
    label: "13px",
    button: "15px",
    small: "12.5px",
  },

  fontWeight: {
    regular: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },

  letterSpacing: {
    tight: "-0.02em",
    normal: "normal",
    wide: "0.01em",
    veryWide: "0.04em",
  },

  lineHeight: {
    tight: 1.1,
    normal: 1.5,
  },
};

// ============================================================
// 📦 ESPAÇAMENTO
// ============================================================

export const spacing = {
  xs: "4px",
  sm: "8px",
  md: "12px",
  lg: "16px",
  xl: "20px",
  "2xl": "24px",
  "3xl": "28px",
  "4xl": "32px",
  "5xl": "36px",
  "6xl": "40px",
};

// ============================================================
// 🎭 EFEITOS VISUAIS
// ============================================================

export const effects = {
  shadowCard: {
    purple: "0 24px 60px -20px rgba(180, 155, 212, 0.35)",
    blue: "0 8px 24px -8px rgba(143, 184, 232, 0.25)",
    combined: "0 24px 60px -20px rgba(180, 155, 212, 0.35), 0 8px 24px -8px rgba(143, 184, 232, 0.25)",
  },

  shadowButton: "0 8px 20px -6px rgba(180, 155, 212, 0.6)",

  grainPattern: "radial-gradient(circle at 20% 50%, rgba(26, 31, 54, 0.04) 0%, transparent 50%), radial-gradient(circle at 80% 80%, rgba(26, 31, 54, 0.04) 0%, transparent 50%)",

  backdropBlur: "blur(20px)",

  orbsBlur: "blur(80px)",
};

// ============================================================
// 🎬 ANIMAÇÕES
// ============================================================

export const animations = {
  driftKeyframes: `
    @keyframes drift1 {
      0%, 100% { transform: translate(0, 0) scale(0.9); }
      50% { transform: translate(30px, 20px) scale(1.1); }
    }
    @keyframes drift2 {
      0%, 100% { transform: translate(0, 0) scale(1); }
      50% { transform: translate(-40px, 30px) scale(0.95); }
    }
    @keyframes drift3 {
      0%, 100% { transform: translate(0, 0) scale(0.95); }
      50% { transform: translate(50px, -20px) scale(1.05); }
    }
  `,

  duration: {
    short: "200ms",
    normal: "300ms",
    long: "500ms",
  },

  easing: {
    linear: "linear",
    ease: "ease",
    easeIn: "ease-in",
    easeOut: "ease-out",
    easeInOut: "ease-in-out",
  },
};

// ============================================================
// 🎚️ BORDER RADIUS
// ============================================================

export const borderRadius = {
  sm: "8px",
  md: "12px",
  lg: "16px",
  xl: "20px",
  full: "24px",
  circle: "50%",
};

// ============================================================
// 💾 EXPORT PADRÃO
// ============================================================

export const designTokens = {
  colors,
  typography,
  spacing,
  effects,
  animations,
  borderRadius,
};

export default designTokens;
