import { useState, useEffect, useRef } from "react";
import { useAuth } from "./AuthContext";

export default function UserMenu() {
  const { user, loading, setShowAuthModal, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    const onClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setOpen(false);
    };
    if (open) document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  if (loading) return null;

  if (!user) {
    return (
      <button
        onClick={() => setShowAuthModal(true)}
        style={{
          padding: "6px 14px", borderRadius: 8,
          border: "1px solid #e2e5ea", background: "#fff",
          color: "#1a1d23", fontSize: 13, fontWeight: 700, cursor: "pointer",
          fontFamily: "'DM Sans', sans-serif",
        }}
      >
        Sign in
      </button>
    );
  }

  const initial = (user.email || "?").charAt(0).toUpperCase();

  return (
    <div ref={menuRef} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(!open)}
        aria-label="Account menu"
        style={{
          width: 32, height: 32, borderRadius: "50%",
          border: "1px solid #e2e5ea", background: "#1a73e8",
          color: "#fff", fontSize: 14, fontWeight: 800, cursor: "pointer",
          fontFamily: "'DM Sans', sans-serif",
        }}
      >
        {initial}
      </button>
      {open && (
        <div style={{
          position: "absolute", top: 38, right: 0, minWidth: 220,
          background: "#fff", border: "1px solid #e2e5ea", borderRadius: 10,
          boxShadow: "0 8px 24px rgba(0,0,0,0.1)", padding: 8, zIndex: 100,
          fontFamily: "'DM Sans', sans-serif",
        }}>
          <div style={{
            padding: "8px 10px", fontSize: 12, color: "#6b7280",
            borderBottom: "1px solid #f1f3f5", marginBottom: 4,
            wordBreak: "break-all",
          }}>
            {user.email}
          </div>
          <button
            onClick={async () => { setOpen(false); await signOut(); }}
            style={{
              width: "100%", textAlign: "left", padding: "8px 10px",
              background: "none", border: "none", borderRadius: 6,
              fontSize: 13, fontWeight: 600, color: "#1a1d23", cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
