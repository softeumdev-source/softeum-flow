import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { useToast } from "../hooks/use-toast";
import {
  colors,
  typography,
  spacing,
  effects,
  animations,
  borderRadius,
} from "../config/designTokens";

export default function Login() {
  const navigate = useNavigate();
  const { signIn, user } = useAuth();
  const { toast } = useToast();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [focusedField, setFocusedField] = useState<"email" | "password" | null>(null);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    if (user) {
      const redirectPath = (user as any).role === "admin" ? "/admin" : "/dashboard";
      navigate(redirectPath);
    }
  }, [user, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await signIn(email, password);
    } catch (error: any) {
      toast({ title: error.message || "Erro ao fazer login", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const fieldStyle = (field: "email" | "password") => ({
    ...styles.input,
    borderColor:
      focusedField === field
        ? "rgba(180, 155, 212, 0.5)"
        : "rgba(180, 155, 212, 0.2)",
    background:
      focusedField === field
        ? "rgba(255, 255, 255, 0.85)"
        : "rgba(255, 255, 255, 0.5)",
    boxShadow:
      focusedField === field ? "0 0 0 3px rgba(180, 155, 212, 0.12)" : "none",
  });

  return (
    <div style={styles.container}>
      {/* Animated gradient orbs */}
      <div style={{ ...styles.orb, ...styles.orbPink }} />
      <div style={{ ...styles.orb, ...styles.orbPurple }} />
      <div style={{ ...styles.orb, ...styles.orbBlue }} />

      {/* Grain texture */}
      <div style={styles.grain} />

      {/* Content */}
      <div style={styles.content}>
        {/* Logo */}
        <div style={styles.logoSection}>
          <img
            src="/assets/softeum-logo.png"
            alt="Softeum"
            style={styles.logoIcon}
          />
          <span style={styles.logoText}>Softeum</span>
        </div>

        {/* Card */}
        <div style={styles.card}>
          <h1 style={styles.title}>Entrar na sua conta</h1>
          <p style={styles.subtitle}>
            Acesse o painel de pedidos da sua empresa
          </p>

          <form onSubmit={handleSubmit} style={styles.form}>
            {/* Email field */}
            <div style={styles.formGroup}>
              <label style={styles.label}>E-mail</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onFocus={() => setFocusedField("email")}
                onBlur={() => setFocusedField(null)}
                placeholder="seu@empresa.com"
                style={fieldStyle("email")}
                required
              />
            </div>

            {/* Password field */}
            <div style={styles.formGroup}>
              <label style={styles.label}>Senha</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onFocus={() => setFocusedField("password")}
                onBlur={() => setFocusedField(null)}
                placeholder="••••••••"
                style={fieldStyle("password")}
                required
              />
            </div>

            {/* Forgot password link */}
            <div style={styles.forgotPasswordSection}>
              <a href="/recuperar-senha" style={styles.forgotPasswordLink}>
                Esqueci minha senha
              </a>
            </div>

            {/* Submit button */}
            <button
              type="submit"
              disabled={loading}
              onMouseEnter={() => setHovered(true)}
              onMouseLeave={() => setHovered(false)}
              style={{
                ...styles.button,
                opacity: loading ? 0.8 : 1,
                transform: hovered && !loading ? "translateY(-1px)" : "translateY(0)",
                boxShadow:
                  hovered && !loading
                    ? "0 12px 28px -8px rgba(180, 155, 212, 0.7)"
                    : effects.shadowButton,
              }}
            >
              {loading ? "Entrando..." : "Entrar"}
            </button>
          </form>
        </div>

        {/* Footer */}
        <p style={styles.footer}>
          © 2026 Softeum · Processamento inteligente de pedidos
        </p>
      </div>

      <style>{animations.driftKeyframes}</style>
    </div>
  );
}

const fontFamily = typography.fontFamily.primary;

const styles = {
  container: {
    position: "relative" as const,
    width: "100%",
    minHeight: "100vh",
    background: `linear-gradient(135deg, ${colors.background.primary} 0%, #F5F3F8 50%, #F0F4FB 100%)`,
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    padding: spacing.xl,
  },

  orb: {
    position: "absolute" as const,
    borderRadius: borderRadius.circle,
    filter: effects.orbsBlur,
    opacity: 0.55,
    mixBlendMode: "multiply" as const,
  },

  orbPink: {
    width: "480px",
    height: "480px",
    background: colors.orbs.pink,
    top: "-10%",
    left: "-5%",
    animation: "drift1 20s ease-in-out infinite",
  },

  orbPurple: {
    width: "560px",
    height: "560px",
    background: colors.orbs.purple,
    top: "20%",
    right: "-5%",
    animation: "drift2 22s ease-in-out infinite",
  },

  orbBlue: {
    width: "520px",
    height: "520px",
    background: colors.orbs.blue,
    bottom: "-10%",
    left: "10%",
    animation: "drift3 21s ease-in-out infinite",
  },

  grain: {
    position: "absolute" as const,
    width: "100%",
    height: "100%",
    backgroundImage: effects.grainPattern,
    pointerEvents: "none" as const,
    top: 0,
    left: 0,
  },

  content: {
    position: "relative" as const,
    zIndex: 10,
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    gap: spacing["4xl"],
  },

  logoSection: {
    display: "flex",
    alignItems: "center",
    gap: spacing.md,
    marginBottom: spacing.xl,
  },

  logoIcon: {
    width: "40px",
    height: "40px",
    objectFit: "contain" as const,
  },

  logoText: {
    fontFamily,
    fontSize: typography.fontSize.wordmark,
    fontWeight: typography.fontWeight.bold,
    color: colors.text.primary,
    letterSpacing: typography.letterSpacing.tight,
  },

  card: {
    width: "100%",
    maxWidth: "440px",
    background: colors.background.card,
    backdropFilter: effects.backdropBlur,
    WebkitBackdropFilter: effects.backdropBlur,
    border: `1px solid ${colors.background.cardBorder}`,
    borderRadius: borderRadius.full,
    padding: `${spacing["6xl"]} ${spacing["5xl"]}`,
    boxShadow: effects.shadowCard.combined,
  },

  title: {
    fontFamily,
    fontSize: typography.fontSize.h1,
    fontWeight: typography.fontWeight.bold,
    color: colors.text.primary,
    margin: `0 0 ${spacing.md} 0`,
    lineHeight: typography.lineHeight.tight,
    letterSpacing: typography.letterSpacing.tight,
  },

  subtitle: {
    fontFamily,
    fontSize: typography.fontSize.body,
    color: colors.text.secondary,
    margin: `0 0 ${spacing["3xl"]} 0`,
    lineHeight: typography.lineHeight.normal,
  },

  form: {
    display: "flex",
    flexDirection: "column" as const,
    gap: spacing.lg,
  },

  formGroup: {
    display: "flex",
    flexDirection: "column" as const,
    gap: spacing.sm,
  },

  label: {
    fontFamily,
    fontSize: typography.fontSize.label,
    fontWeight: typography.fontWeight.medium,
    color: colors.text.secondary,
    textTransform: "uppercase" as const,
    letterSpacing: typography.letterSpacing.veryWide,
  },

  input: {
    fontFamily,
    fontSize: typography.fontSize.body,
    color: colors.text.primary,
    padding: `${spacing.md} ${spacing.lg}`,
    border: "1px solid rgba(180, 155, 212, 0.2)",
    borderRadius: borderRadius.md,
    background: "rgba(255, 255, 255, 0.5)",
    transition: `all ${animations.duration.short} ${animations.easing.easeOut}`,
    outline: "none",
  },

  forgotPasswordSection: {
    textAlign: "right" as const,
    marginTop: spacing.xs,
  },

  forgotPasswordLink: {
    fontFamily,
    fontSize: typography.fontSize.label,
    color: colors.text.accent,
    textDecoration: "none",
    fontWeight: typography.fontWeight.medium,
    transition: `color ${animations.duration.short}`,
  },

  button: {
    fontFamily,
    fontSize: typography.fontSize.button,
    fontWeight: typography.fontWeight.semibold,
    letterSpacing: "-0.005em",
    padding: spacing.lg,
    border: "none",
    borderRadius: borderRadius.md,
    background: colors.button.gradient,
    color: colors.button.text,
    cursor: "pointer",
    boxShadow: effects.shadowButton,
    transition: `all ${animations.duration.normal} ${animations.easing.easeOut}`,
    marginTop: spacing.sm,
  },

  footer: {
    fontFamily,
    fontSize: typography.fontSize.small,
    color: colors.text.tertiary,
    letterSpacing: typography.letterSpacing.wide,
    margin: 0,
    textAlign: "center" as const,
    position: "absolute" as const,
    bottom: spacing.xl,
  },
};
