import { useState } from "react";
import { supabase, isAuthConfigured } from "./supabase";
import { useAuth } from "./AuthContext";

export default function AuthModal() {
  const { showAuthModal, setShowAuthModal } = useAuth();
  const [mode, setMode] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  if (!showAuthModal) return null;

  const close = () => {
    setShowAuthModal(false);
    setError(null);
    setSent(false);
    setPassword("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!isAuthConfigured()) {
      setError("Auth isn't configured yet. Add Supabase env vars.");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${location.origin}/` },
        });
        if (error) setError(error.message);
        else setSent(true);
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) setError(error.message);
        else close();
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      onClick={close}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 1000, padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff", borderRadius: 14, padding: 24,
          width: "100%", maxWidth: 380,
          fontFamily: "'DM Sans', sans-serif",
          boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 900, color: "#1a1d23" }}>
            {mode === "signin" ? "Sign in" : "Create account"}
          </h2>
          <button onClick={close} style={{
            background: "none", border: "none", fontSize: 22,
            color: "#8b919a", cursor: "pointer", lineHeight: 1,
          }}>×</button>
        </div>

        {sent ? (
          <div style={{ fontSize: 14, color: "#1a1d23", lineHeight: 1.5 }}>
            Check your email to confirm your account. Once confirmed, come back and sign in.
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#6b7280", marginBottom: 4 }}>
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              style={{
                width: "100%", padding: "10px 12px", fontSize: 14,
                border: "1px solid #e2e5ea", borderRadius: 8,
                marginBottom: 12, boxSizing: "border-box",
                fontFamily: "inherit",
              }}
            />
            <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#6b7280", marginBottom: 4 }}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              style={{
                width: "100%", padding: "10px 12px", fontSize: 14,
                border: "1px solid #e2e5ea", borderRadius: 8,
                marginBottom: 12, boxSizing: "border-box",
                fontFamily: "inherit",
              }}
            />
            {error && (
              <div style={{ fontSize: 12, color: "#dc2626", marginBottom: 12 }}>{error}</div>
            )}
            <button
              type="submit"
              disabled={loading}
              style={{
                width: "100%", padding: "11px 16px", borderRadius: 8,
                background: "#1a73e8", color: "#fff", border: "none",
                fontSize: 14, fontWeight: 800, cursor: loading ? "default" : "pointer",
                opacity: loading ? 0.6 : 1,
                fontFamily: "inherit",
              }}
            >
              {loading ? "..." : mode === "signin" ? "Sign in" : "Create account"}
            </button>
            <button
              type="button"
              onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setError(null); }}
              style={{
                width: "100%", marginTop: 10, background: "none", border: "none",
                color: "#1a73e8", fontSize: 13, fontWeight: 700, cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              {mode === "signin" ? "Need an account? Sign up" : "Already have an account? Sign in"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
