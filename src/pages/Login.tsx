import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { useToast } from "../hooks/use-toast";

export default function Login() {
  const navigate = useNavigate();
  const { signIn, user } = useAuth();
  const { toast } = useToast();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [focusedField, setFocusedField] = useState<"email" | "password" | null>(null);

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
                style={{
                  ...styles.input,
                  borderColor: focusedField === "email"
                    ? "rgba(180, 155, 212, 0.5)"
                    : "rgba(180, 155, 212, 0.2)",
                  background: focusedField === "email"
                    ? "rgba(255, 255, 255, 0.8)"
                    : "rgba(255, 255, 255, 0.5)",
                  boxShadow: focusedField === "email"
                    ? "0 0 0 3px rgba(180, 155, 212, 0.1)"
                    : "none",
                }}
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
                style={{
                  ...styles.input,
                  borderColor: focusedField === "password"
                    ? "rgba(180, 155, 212, 0.5)"
                    : "rgba(180, 155, 212, 0.2)",
                  background: focusedField === "password"
                    ? "rgba(255, 255, 255, 0.8)"
                    : "rgba(255, 255, 255, 0.5)",
                  boxShadow: focusedField === "password"
                    ? "0 0 0 3px rgba(180, 155, 212, 0.1)"
                    : "none",
                }}
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
              style={{
                ...styles.button,
                opacity: loading ? 0.8 : 1,
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

      <style>{`
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
      `}</style>
    </div>
  );
}

const styles = {
  container: {
    position: "relative" as const,
    width: "100%",
    minHeight: "100vh",
    background: "linear-gradient(135deg, #FAF7F4 0%, #F5F3F8 50%, #F0F4FB 100%)",
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    padding: "20px",
  },

  orb: {
    position: "absolute" as const,
    borderRadius: "50%",
    filter: "blur(80px)",
    opacity: 0.55,
    mixBlendMode: "multiply" as const,
  },

  orbPink: {
    width: "480px",
    height: "480px",
    background: "#E8A5C4",
    top: "-10%",
    left: "-5%",
    animation: "drift1 20s ease-in-out infinite",
  },

  orbPurple: {
    width: "560px",
    height: "560px",
    background: "#B49BD4",
    top: "20%",
    right: "-5%",
    animation: "drift2 22s ease-in-out infinite",
  },

  orbBlue: {
    width: "520px",
    height: "520px",
    background: "#8FB8E8",
    bottom: "-10%",
    left: "10%",
    animation: "drift3 21s ease-in-out infinite",
  },

  grain: {
    position: "absolute" as const,
    width: "100%",
    height: "100%",
    backgroundImage: `
      radial-gradient(circle at 20% 50%, rgba(26, 31, 54, 0.04) 0%, transparent 50%),
      radial-gradient(circle at 80% 80%, rgba(26, 31, 54, 0.04) 0%, transparent 50%)
    `,
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
    gap: "32px",
  },

  logoSection: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    marginBottom: "20px",
  },

  logoIcon: {
    width: "40px",
    height: "40px",
    objectFit: "contain" as const,
  },

  logoText: {
    fontFamily: "'Plus Jakarta Sans', 'Inter', sans-serif",
    fontSize: "18px",
    fontWeight: 600,
    color: "#1A1F36",
    letterSpacing: "-0.02em",
  },

  card: {
    width: "100%",
    maxWidth: "440px",
    background: "rgba(255, 255, 255, 0.72)",
    backdropFilter: "blur(20px)",
    WebkitBackdropFilter: "blur(20px)",
    border: "1px solid rgba(255, 255, 255, 0.6)",
    borderRadius: "24px",
    padding: "40px 36px",
    boxShadow: `
      0 24px 60px -20px rgba(180, 155, 212, 0.35),
      0 8px 24px -8px rgba(143, 184, 232, 0.25)
    `,
  },

  title: {
    fontFamily: "'Plus Jakarta Sans', 'Inter', sans-serif",
    fontSize: "28px",
    fontWeight: 700,
    color: "#1A1F36",
    margin: "0 0 12px 0",
    lineHeight: 1.1,
    letterSpacing: "-0.02em",
  },

  subtitle: {
    fontFamily: "'Plus Jakarta Sans', 'Inter', sans-serif",
    fontSize: "14px",
    color: "#5B6478",
    margin: "0 0 28px 0",
    lineHeight: 1.5,
  },

  form: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "18px",
  },

  formGroup: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "8px",
  },

  label: {
    fontFamily: "'Plus Jakarta Sans', 'Inter', sans-serif",
    fontSize: "13px",
    fontWeight: 500,
    color: "#5B6478",
    textTransform: "uppercase" as const,
    letterSpacing: "0.04em",
  },

  input: {
    fontFamily: "'Plus Jakarta Sans', 'Inter', sans-serif",
    fontSize: "14px",
    color: "#1A1F36",
    padding: "12px 14px",
    border: "1px solid rgba(180, 155, 212, 0.2)",
    borderRadius: "12px",
    background: "rgba(255, 255, 255, 0.5)",
    transition: "all 0.2s ease",
    outline: "none",
  },

  forgotPasswordSection: {
    textAlign: "right" as const,
    marginTop: "4px",
  },

  forgotPasswordLink: {
    fontFamily: "'Plus Jakarta Sans', 'Inter', sans-serif",
    fontSize: "13px",
    color: "#7A6BB0",
    textDecoration: "none",
    fontWeight: 500,
    transition: "color 0.2s",
  },

  button: {
    fontFamily: "'Plus Jakarta Sans', 'Inter', sans-serif",
    fontSize: "15px",
    fontWeight: 600,
    letterSpacing: "-0.005em",
    padding: "16px",
    border: "none",
    borderRadius: "12px",
    background: "linear-gradient(135deg, #E8A5C4 0%, #B49BD4 50%, #8FB8E8 100%)",
    color: "#FFFFFF",
    cursor: "pointer",
    boxShadow: "0 8px 20px -6px rgba(180, 155, 212, 0.6)",
    transition: "all 0.3s ease",
    marginTop: "8px",
  },

  footer: {
    fontFamily: "'Plus Jakarta Sans', 'Inter', sans-serif",
    fontSize: "12.5px",
    color: "#8A92A6",
    letterSpacing: "0.01em",
    margin: 0,
    textAlign: "center" as const,
    position: "absolute" as const,
    bottom: "20px",
  },
};
