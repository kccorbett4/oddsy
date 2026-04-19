import { useState, useEffect } from "react";
import { supabase, isAuthConfigured } from "./supabase";
import { useAuth } from "./AuthContext";

export default function AuthModal() {
  const { showAuthModal, setShowAuthModal } = useAuth();
  const [mode, setMode] = useState("signin"); // signin | signup | forgot | reset
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(false);

  // When Supabase fires PASSWORD_RECOVERY (user clicked the reset email link),
  // switch the modal into "reset" mode so they can set a new password.
  useEffect(() => {
    if (!isAuthConfigured()) return;
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setMode("reset");
        setShowAuthModal(true);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [setShowAuthModal]);

  if (!showAuthModal) return null;

  const close = () => {
    setShowAuthModal(false);
    setError(null);
    setInfo(null);
    setPassword("");
    if (mode !== "signin") setMode("signin");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!isAuthConfigured()) {
      setError("Auth isn't configured yet.");
      return;
    }
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${location.origin}/` },
        });
        if (error) setError(error.message);
        else setInfo("Check your email to confirm your account, then come back and sign in.");
      } else if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) setError(error.message);
        else close();
      } else if (mode === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${location.origin}/`,
        });
        if (error) setError(error.message);
        else setInfo("Check your email for a password reset link.");
      } else if (mode === "reset") {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) setError(error.message);
        else {
          setInfo("Password updated. You're signed in.");
          setTimeout(close, 1200);
        }
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    if (!isAuthConfigured()) return;
    setError(null);
    setLoading(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${location.origin}/` },
    });
    if (error) { setError(error.message); setLoading(false); }
  };

  const titles = {
    signin: "Sign in",
    signup: "Create account",
    forgot: "Reset password",
    reset: "Set a new password",
  };

  const inputStyle = {
    width: "100%", padding: "10px 12px", fontSize: 14,
    border: "1px solid #e2e5ea", borderRadius: 8,
    marginBottom: 12, boxSizing: "border-box",
    fontFamily: "inherit",
  };
  const labelStyle = { display: "block", fontSize: 12, fontWeight: 700, color: "#6b7280", marginBottom: 4 };

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
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 900, color: "#1a1d23" }}>{titles[mode]}</h2>
          <button onClick={close} style={{
            background: "none", border: "none", fontSize: 22,
            color: "#8b919a", cursor: "pointer", lineHeight: 1,
          }}>×</button>
        </div>

        {/* Google OAuth — only for signin/signup */}
        {(mode === "signin" || mode === "signup") && (
          <>
            <button
              type="button"
              onClick={handleGoogle}
              disabled={loading}
              style={{
                width: "100%", padding: "10px 12px", borderRadius: 8,
                border: "1px solid #e2e5ea", background: "#fff",
                color: "#1a1d23", fontSize: 14, fontWeight: 700,
                cursor: loading ? "default" : "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
                fontFamily: "inherit", marginBottom: 14,
              }}
            >
              <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
                <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.6-6 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3L37.6 9.2C34 5.9 29.2 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z"/>
                <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.9 29.2 5 24 5 16.3 5 9.7 9.2 6.3 14.7z"/>
                <path fill="#4CAF50" d="M24 44c5.1 0 9.8-2 13.3-5.2l-6.1-5.2c-2 1.5-4.5 2.4-7.2 2.4-5.2 0-9.7-3.3-11.3-8l-6.6 5.1C9.6 39.7 16.2 44 24 44z"/>
                <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.2-4.1 5.6l.1-.1 6.1 5.2c-.4.4 6.6-4.8 6.6-14.7 0-1.3-.1-2.3-.4-3.5z"/>
              </svg>
              Continue with Google
            </button>
            <div style={{
              textAlign: "center", fontSize: 11, color: "#8b919a",
              margin: "0 0 14px", position: "relative",
            }}>
              <span style={{ background: "#fff", padding: "0 10px", position: "relative", zIndex: 1 }}>or</span>
              <div style={{
                position: "absolute", top: "50%", left: 0, right: 0,
                height: 1, background: "#e2e5ea", zIndex: 0,
              }} />
            </div>
          </>
        )}

        <form onSubmit={handleSubmit}>
          {(mode === "signin" || mode === "signup" || mode === "forgot") && (
            <>
              <label style={labelStyle}>Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                style={inputStyle}
              />
            </>
          )}

          {(mode === "signin" || mode === "signup" || mode === "reset") && (
            <>
              <label style={labelStyle}>
                {mode === "reset" ? "New password" : "Password"}
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                style={inputStyle}
              />
            </>
          )}

          {mode === "signin" && (
            <button
              type="button"
              onClick={() => { setMode("forgot"); setError(null); setInfo(null); }}
              style={{
                background: "none", border: "none", color: "#1a73e8",
                fontSize: 12, fontWeight: 600, cursor: "pointer",
                padding: 0, marginBottom: 12, fontFamily: "inherit",
              }}
            >
              Forgot your password?
            </button>
          )}

          {error && <div style={{ fontSize: 12, color: "#dc2626", marginBottom: 12 }}>{error}</div>}
          {info && <div style={{ fontSize: 13, color: "#0d9f4f", marginBottom: 12, lineHeight: 1.5 }}>{info}</div>}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: "100%", padding: "11px 16px", borderRadius: 8,
              background: "#1a73e8", color: "#fff", border: "none",
              fontSize: 14, fontWeight: 800, cursor: loading ? "default" : "pointer",
              opacity: loading ? 0.6 : 1, fontFamily: "inherit",
            }}
          >
            {loading ? "..." :
              mode === "signin" ? "Sign in" :
              mode === "signup" ? "Create account" :
              mode === "forgot" ? "Send reset link" :
              "Update password"}
          </button>

          <div style={{ marginTop: 10, textAlign: "center" }}>
            {mode === "signin" && (
              <button type="button" onClick={() => { setMode("signup"); setError(null); setInfo(null); }}
                style={{ background: "none", border: "none", color: "#1a73e8", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                Need an account? Sign up
              </button>
            )}
            {mode === "signup" && (
              <button type="button" onClick={() => { setMode("signin"); setError(null); setInfo(null); }}
                style={{ background: "none", border: "none", color: "#1a73e8", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                Already have an account? Sign in
              </button>
            )}
            {mode === "forgot" && (
              <button type="button" onClick={() => { setMode("signin"); setError(null); setInfo(null); }}
                style={{ background: "none", border: "none", color: "#1a73e8", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                ← Back to sign in
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
