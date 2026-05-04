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
  const [focused, setFocused] = useState<"email" | "password" | null>(null);
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

  const inputStyle = (field: "email" | "password"): React.CSSProperties => ({
    fontFamily: FONT,
    fontSize: 14.5,
    color: "#1A1F36",
    padding: "14px 16px",
    border: `1px solid ${focused === field ? "rgba(180,155,212,0.55)" : "rgba(180,155,212,0.22)"}`,
    borderRadius: 14,
    background: focused === field ? "rgba(255,255,255,0.92)" : "rgba(255,255,255,0.62)",
    boxShadow: focused === field ? "0 0 0 4px rgba(180,155,212,0.14)" : "none",
    transition: "all 220ms ease",
    outline: "none",
    width: "100%",
    boxSizing: "border-box",
  });

  return (
    <div style={styles.container}>
      <div style={{ ...styles.orb, ...styles.orbPink }} />
      <div style={{ ...styles.orb, ...styles.orbPurple }} />
      <div style={{ ...styles.orb, ...styles.orbBlue }} />
      <div style={styles.grain} />

      <div style={styles.content}>
        <div style={styles.logoSection}>
          <img src="/assets/softeum-logo.svg" alt="Softeum" style={styles.logoIcon} />
          <span style={styles.logoText}>Softeum</span>
        </div>

        <div style={styles.card}>
          <h1 style={styles.title}>Entrar na sua conta</h1>
          <p style={styles.subtitle}>Acesse o painel de pedidos da sua empresa</p>

          <form onSubmit={handleSubmit} style={styles.form}>
            <div style={styles.formGroup}>
              <label style={styles.label}>E-mail</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onFocus={() => setFocused("email")}
                onBlur={() => setFocused(null)}
                placeholder="seu@empresa.com"
                style={inputStyle("email")}
                required
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Senha</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onFocus={() => setFocused("password")}
                onBlur={() => setFocused(null)}
                placeholder="••••••••"
                style={inputStyle("password")}
                required
              />
            </div>

            <div style={styles.forgotPasswordSection}>
              <a href="/recuperar-senha" style={styles.forgotPasswordLink}>
                Esqueci minha senha
              </a>
            </div>

            <button
              type="submit"
              disabled={loading}
              onMouseEnter={() => setHovered(true)}
              onMouseLeave={() => setHovered(false)}
              style={{
                ...styles.button,
                opacity: loading ? 0.85 : 1,
                transform: hovered && !loading ? "translateY(-2px)" : "translateY(0)",
                boxShadow:
                  hovered && !loading
                    ? "0 16px 32px -10px rgba(180,155,212,0.75), 0 0 0 1px rgba(255,255,255,0.4) inset"
                    : "0 10px 24px -8px rgba(180,155,212,0.65), 0 0 0 1px rgba(255,255,255,0.4) inset",
              }}
            >
              {loading ? "Entrando..." : "Entrar"}
            </button>
          </form>
        </div>

        <p style={styles.footer}>
          © 2026 Softeum · Processamento inteligente de pedidos
        </p>
      </div>

      <style>{`
        @keyframes drift1 {
          0%, 100% { transform: translate(0, 0) scale(0.9); }
          50% { transform: translate(40px, 30px) scale(1.1); }
        }
        @keyframes drift2 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(-50px, 40px) scale(0.95); }
        }
        @keyframes drift3 {
          0%, 100% { transform: translate(0, 0) scale(0.95); }
          50% { transform: translate(60px, -30px) scale(1.05); }
        }
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        input::placeholder { color: #A0A6B8; }
        a:hover { opacity: 0.85; }
      `}</style>
    </div>
  );
}

const FONT = "'Plus Jakarta Sans', 'Inter', system-ui, sans-serif";

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: "relative",
    width: "100%",
    minHeight: "100vh",
    background: "linear-gradient(135deg, #FAF7F4 0%, #F5F1F8 45%, #EEF2FB 100%)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    padding: 24,
  },
  orb: {
    position: "absolute",
    borderRadius: "50%",
    filter: "blur(90px)",
    opacity: 0.6,
    mixBlendMode: "multiply",
    pointerEvents: "none",
  },
  orbPink: {
    width: 520, height: 520, background: "#E8A5C4",
    top: "-12%", left: "-6%", animation: "drift1 20s ease-in-out infinite",
  },
  orbPurple: {
    width: 600, height: 600, background: "#B49BD4",
    top: "15%", right: "-8%", animation: "drift2 22s ease-in-out infinite",
  },
  orbBlue: {
    width: 560, height: 560, background: "#8FB8E8",
    bottom: "-15%", left: "12%", animation: "drift3 21s ease-in-out infinite",
  },
  grain: {
    position: "absolute", inset: 0, width: "100%", height: "100%",
    backgroundImage:
      "radial-gradient(circle at 20% 50%, rgba(26,31,54,0.04) 0%, transparent 50%), radial-gradient(circle at 80% 80%, rgba(26,31,54,0.04) 0%, transparent 50%)",
    pointerEvents: "none",
  },
  content: {
    position: "relative",
    zIndex: 10,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 28,
    width: "100%",
    maxWidth: 460,
    animation: "fadeUp 600ms ease-out",
  },
  logoSection: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginBottom: 4,
  },
  logoIcon: { width: 56, height: 56, objectFit: "contain" },
  logoText: {
    fontFamily: FONT,
    fontSize: 20,
    fontWeight: 700,
    color: "#1A1F36",
    letterSpacing: "-0.02em",
  },
  card: {
    width: "100%",
    background: "rgba(255,255,255,0.72)",
    backdropFilter: "blur(24px) saturate(140%)",
    WebkitBackdropFilter: "blur(24px) saturate(140%)",
    border: "1px solid rgba(255,255,255,0.7)",
    borderRadius: 24,
    padding: "44px 40px",
    boxShadow:
      "0 30px 70px -22px rgba(180,155,212,0.4), 0 10px 28px -10px rgba(143,184,232,0.3), 0 0 0 1px rgba(255,255,255,0.3) inset",
  },
  title: {
    fontFamily: FONT,
    fontSize: 30,
    fontWeight: 700,
    color: "#1A1F36",
    margin: "0 0 10px 0",
    lineHeight: 1.15,
    letterSpacing: "-0.02em",
  },
  subtitle: {
    fontFamily: FONT,
    fontSize: 14.5,
    color: "#5B6478",
    margin: "0 0 28px 0",
    lineHeight: 1.5,
  },
  form: { display: "flex", flexDirection: "column", gap: 18 },
  formGroup: { display: "flex", flexDirection: "column", gap: 8 },
  label: {
    fontFamily: FONT,
    fontSize: 12,
    fontWeight: 600,
    color: "#5B6478",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
  },
  forgotPasswordSection: { textAlign: "right", marginTop: 2 },
  forgotPasswordLink: {
    fontFamily: FONT,
    fontSize: 13,
    color: "#7A6BB0",
    textDecoration: "none",
    fontWeight: 600,
    transition: "opacity 200ms",
  },
  button: {
    fontFamily: FONT,
    fontSize: 15,
    fontWeight: 600,
    letterSpacing: "-0.005em",
    padding: "16px 18px",
    border: "none",
    borderRadius: 14,
    background: "linear-gradient(135deg, #E8A5C4 0%, #B49BD4 50%, #8FB8E8 100%)",
    color: "#FFFFFF",
    cursor: "pointer",
    transition: "all 280ms cubic-bezier(0.2, 0.7, 0.2, 1)",
    marginTop: 8,
  },
  footer: {
    fontFamily: FONT,
    fontSize: 12.5,
    color: "#8A92A6",
    letterSpacing: "0.01em",
    margin: 0,
    textAlign: "center",
  },
};
