import { useState, FormEvent } from "react";
import { Link } from "react-router-dom";
import { MailCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export default function RecuperarSenha() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setSubmitting(true);
    // Resposta uniforme (sucesso ou email-inexistente) pra não permitir
    // enumeração de emails cadastrados.
    await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setSubmitting(false);
    setEnviado(true);
  };

  const inputStyle: React.CSSProperties = {
    fontFamily: FONT,
    fontSize: 14.5,
    color: "#1A1F36",
    padding: "14px 16px",
    border: `1px solid ${focused ? "rgba(180,155,212,0.55)" : "rgba(180,155,212,0.22)"}`,
    borderRadius: 14,
    background: focused ? "rgba(255,255,255,0.92)" : "rgba(255,255,255,0.62)",
    boxShadow: focused ? "0 0 0 4px rgba(180,155,212,0.14)" : "none",
    transition: "all 220ms ease",
    outline: "none",
    width: "100%",
    boxSizing: "border-box",
  };

  return (
    <div style={styles.container}>
      <div style={{ ...styles.orb, ...styles.orbPink }} />
      <div style={{ ...styles.orb, ...styles.orbPurple }} />
      <div style={{ ...styles.orb, ...styles.orbBlue }} />
      <div style={styles.grain} />

      <div style={styles.content}>
        <div style={styles.logoSection}>
          <img src="/assets/softeum-logo.png" alt="Softeum" style={styles.logoIcon} />
          <span style={styles.logoText}>Softeum</span>
        </div>

        <div style={styles.card}>
          {enviado ? (
            <div style={{ textAlign: "center" }}>
              <div style={styles.successIcon}>
                <MailCheck size={26} />
              </div>
              <h1 style={styles.title}>Verifique seu e-mail</h1>
              <p style={styles.subtitle}>
                Se o e-mail estiver cadastrado, você receberá um link para redefinir sua
                senha em instantes. O link expira em 1 hora.
              </p>
              <Link to="/login" style={{ ...styles.secondaryButton, marginTop: 24, display: "block", textDecoration: "none" }}>
                Voltar ao login
              </Link>
            </div>
          ) : (
            <>
              <h1 style={styles.title}>Recuperar senha</h1>
              <p style={styles.subtitle}>
                Informe seu e-mail e enviaremos um link para redefinir a senha.
              </p>

              <form onSubmit={handleSubmit} style={styles.form}>
                <div style={styles.formGroup}>
                  <label style={styles.label}>E-mail</label>
                  <input
                    type="email"
                    autoComplete="email"
                    required
                    placeholder="voce@empresa.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                    disabled={submitting}
                    style={inputStyle}
                  />
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  onMouseEnter={() => setHovered(true)}
                  onMouseLeave={() => setHovered(false)}
                  style={{
                    ...styles.button,
                    opacity: submitting ? 0.85 : 1,
                    transform: hovered && !submitting ? "translateY(-2px)" : "translateY(0)",
                    boxShadow:
                      hovered && !submitting
                        ? "0 16px 32px -10px rgba(180,155,212,0.75), 0 0 0 1px rgba(255,255,255,0.4) inset"
                        : "0 10px 24px -8px rgba(180,155,212,0.65), 0 0 0 1px rgba(255,255,255,0.4) inset",
                  }}
                >
                  {submitting ? "Enviando..." : "Enviar link de recuperação"}
                </button>
              </form>

              <div style={styles.backSection}>
                <Link to="/login" style={styles.backLink}>
                  Voltar ao login
                </Link>
              </div>
            </>
          )}
        </div>

        <p style={styles.footer}>
          © {new Date().getFullYear()} Softeum · Processamento inteligente de pedidos
        </p>
      </div>

      <style>{`
        @keyframes drift1 { 0%,100% { transform: translate(0,0) scale(0.9);} 50% { transform: translate(40px,30px) scale(1.1);} }
        @keyframes drift2 { 0%,100% { transform: translate(0,0) scale(1);} 50% { transform: translate(-50px,40px) scale(0.95);} }
        @keyframes drift3 { 0%,100% { transform: translate(0,0) scale(0.95);} 50% { transform: translate(60px,-30px) scale(1.05);} }
        @keyframes fadeUp { from { opacity:0; transform: translateY(12px);} to { opacity:1; transform: translateY(0);} }
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
  orbPink: { width: 520, height: 520, background: "#E8A5C4", top: "-12%", left: "-6%", animation: "drift1 20s ease-in-out infinite" },
  orbPurple: { width: 600, height: 600, background: "#B49BD4", top: "15%", right: "-8%", animation: "drift2 22s ease-in-out infinite" },
  orbBlue: { width: 560, height: 560, background: "#8FB8E8", bottom: "-15%", left: "12%", animation: "drift3 21s ease-in-out infinite" },
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
  logoSection: { display: "flex", alignItems: "center", gap: 12, marginBottom: 4 },
  logoIcon: { width: 40, height: 40, objectFit: "contain" },
  logoText: { fontFamily: FONT, fontSize: 20, fontWeight: 700, color: "#1A1F36", letterSpacing: "-0.02em" },
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
  successIcon: {
    width: 56, height: 56, borderRadius: "50%",
    background: "linear-gradient(135deg, rgba(232,165,196,0.25), rgba(143,184,232,0.25))",
    color: "#7A6BB0",
    display: "flex", alignItems: "center", justifyContent: "center",
    margin: "0 auto 16px",
  },
  title: {
    fontFamily: FONT, fontSize: 28, fontWeight: 700, color: "#1A1F36",
    margin: "0 0 10px 0", lineHeight: 1.15, letterSpacing: "-0.02em",
  },
  subtitle: {
    fontFamily: FONT, fontSize: 14.5, color: "#5B6478",
    margin: "0 0 24px 0", lineHeight: 1.55,
  },
  form: { display: "flex", flexDirection: "column", gap: 18 },
  formGroup: { display: "flex", flexDirection: "column", gap: 8 },
  label: {
    fontFamily: FONT, fontSize: 12, fontWeight: 600, color: "#5B6478",
    textTransform: "uppercase", letterSpacing: "0.06em",
  },
  button: {
    fontFamily: FONT, fontSize: 15, fontWeight: 600, letterSpacing: "-0.005em",
    padding: "16px 18px", border: "none", borderRadius: 14,
    background: "linear-gradient(135deg, #E8A5C4 0%, #B49BD4 50%, #8FB8E8 100%)",
    color: "#FFFFFF", cursor: "pointer",
    transition: "all 280ms cubic-bezier(0.2, 0.7, 0.2, 1)",
    marginTop: 4,
  },
  secondaryButton: {
    fontFamily: FONT, fontSize: 14.5, fontWeight: 600,
    padding: "14px 18px", borderRadius: 14,
    border: "1px solid rgba(180,155,212,0.35)",
    background: "rgba(255,255,255,0.6)",
    color: "#1A1F36",
    textAlign: "center",
    cursor: "pointer",
    transition: "all 220ms ease",
  },
  backSection: { textAlign: "center", marginTop: 18 },
  backLink: {
    fontFamily: FONT, fontSize: 13, color: "#7A6BB0",
    textDecoration: "none", fontWeight: 600,
  },
  footer: {
    fontFamily: FONT, fontSize: 12.5, color: "#8A92A6",
    letterSpacing: "0.01em", margin: 0, textAlign: "center",
  },
};
