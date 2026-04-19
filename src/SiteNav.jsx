import { useState, useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

// Single source of truth for top-level routes. Used by the shared nav,
// by App.jsx's tab-state logic, and (via tabFromPath) to highlight the
// active tab on every page in the app.
export const TAB_PATHS = {
  home: "/",
  picks: "/picks",
  parlays: "/parlays",
  games: "/games",
  hr: "/homeruns",
  shop: "/shop",
  arbitrage: "/arbitrage",
  markets: "/prediction-markets",
  record: "/record",
};

export function tabFromPath(pathname) {
  if (pathname === "/" || pathname === "") return "home";
  if (pathname.startsWith("/picks")) return "picks";
  if (pathname.startsWith("/parlays")) return "parlays";
  if (pathname.startsWith("/games")) return "games";
  if (pathname.startsWith("/homeruns")) return "hr";
  if (pathname.startsWith("/shop")) return "shop";
  if (pathname.startsWith("/arbitrage")) return "arbitrage";
  if (pathname.startsWith("/prediction-markets")) return "markets";
  if (pathname.startsWith("/record")) return "record";
  if (pathname.startsWith("/strategy-builder")) return "strategy";
  return "home";
}

const DESKTOP_TABS = [
  { id: "home", path: "/", label: "Home", icon: "🏠" },
  { id: "picks", path: "/picks", label: "Picks", icon: "💰" },
  { id: "parlays", path: "/parlays", label: "Parlays", icon: "🎰" },
  { id: "games", path: "/games", label: "Games", icon: "📊" },
  { id: "hr", path: "/homeruns", label: "HR", icon: "💣" },
  { id: "shop", path: "/shop", label: "Shop", icon: "🏦" },
  { id: "arbitrage", path: "/arbitrage", label: "Arbitrage", icon: "🔄" },
  { id: "markets", path: "/prediction-markets", label: "Markets", icon: "🔮" },
  { id: "record", path: "/record", label: "Record", icon: "📈" },
];

// Five slots on mobile — the extras live inside the "More" drawer.
const MOBILE_TABS = [
  { id: "home", path: "/", label: "Home", icon: "🏠" },
  { id: "picks", path: "/picks", label: "Picks", icon: "💰" },
  { id: "parlays", path: "/parlays", label: "Parlays", icon: "🎰" },
  { id: "games", path: "/games", label: "Games", icon: "📊" },
  { id: "more", label: "More", icon: "➕" },
];

const MORE_ITEMS = [
  { path: "/homeruns", label: "HR Hunter", icon: "💣", desc: "Top home run props" },
  { path: "/shop", label: "Book Shop", icon: "🏦", desc: "Compare live odds" },
  { path: "/arbitrage", label: "Arbitrage", icon: "🔄", desc: "Guaranteed-profit bets" },
  { path: "/prediction-markets", label: "Prediction Markets", icon: "🔮", desc: "Kalshi & Polymarket" },
  { path: "/strategy-builder", label: "Build Your Own", icon: "🛠️", desc: "Custom pick filters" },
  { path: "/record", label: "Track Record", icon: "📈", desc: "Historical performance" },
];

export default function SiteNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const active = tabFromPath(location.pathname);
  const [isMobile, setIsMobile] = useState(
    typeof window !== "undefined" ? window.innerWidth < 768 : false
  );
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Highlight "More" when the current route is one of the drawer destinations.
  const mobileActive = MORE_ITEMS.some(m => location.pathname.startsWith(m.path))
    ? "more"
    : active;

  return (
    <>
      {!isMobile && (
        <nav style={{
          display: "flex",
          gap: 0,
          padding: "0 20px",
          background: "#fff",
          borderBottom: "1px solid #e2e5ea",
        }}>
          {DESKTOP_TABS.map(tab => {
            const isActive = active === tab.id;
            return (
              <Link
                key={tab.id}
                to={tab.path}
                style={{
                  flex: 1,
                  padding: "12px 0",
                  textAlign: "center",
                  borderBottom: isActive ? "2px solid #1a73e8" : "2px solid transparent",
                  color: isActive ? "#1a73e8" : "#8b919a",
                  fontSize: 13,
                  fontWeight: 700,
                  textDecoration: "none",
                  fontFamily: "'DM Sans', sans-serif",
                  transition: "color 0.15s",
                }}
              >
                {tab.icon} {tab.label}
              </Link>
            );
          })}
        </nav>
      )}

      {isMobile && (
        <nav style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          background: "#1a1d23",
          borderTop: "2px solid #2d3748",
          display: "flex",
          zIndex: 900,
          padding: "8px 4px 4px",
          paddingBottom: "calc(8px + env(safe-area-inset-bottom, 0px))",
          boxShadow: "0 -4px 24px rgba(0,0,0,0.25)",
        }}>
          {MOBILE_TABS.map(tab => {
            const isActive = mobileActive === tab.id;
            const buttonStyle = {
              flex: 1,
              padding: "8px 2px 6px",
              border: "none",
              background: isActive ? "#1a73e8" : "transparent",
              borderRadius: 12,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 3,
              cursor: "pointer",
              color: isActive ? "#fff" : "#6b7280",
              textDecoration: "none",
              transition: "all 0.2s",
              fontFamily: "'DM Sans', sans-serif",
            };
            const inner = (
              <>
                <span style={{ fontSize: 22, lineHeight: 1 }}>{tab.icon}</span>
                <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.02em" }}>{tab.label}</span>
              </>
            );
            if (tab.id === "more") {
              return (
                <button key="more" onClick={() => setDrawerOpen(true)} style={buttonStyle}>
                  {inner}
                </button>
              );
            }
            return (
              <Link key={tab.id} to={tab.path} style={buttonStyle}>
                {inner}
              </Link>
            );
          })}
        </nav>
      )}

      {isMobile && drawerOpen && (
        <div
          onClick={() => setDrawerOpen(false)}
          style={{
            position: "fixed", inset: 0,
            background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)",
            zIndex: 1000, display: "flex", alignItems: "flex-end",
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: "100%",
              background: "#fff",
              borderTopLeftRadius: 18,
              borderTopRightRadius: 18,
              padding: "18px 16px calc(24px + env(safe-area-inset-bottom, 0px))",
              boxShadow: "0 -12px 40px rgba(0,0,0,0.25)",
              fontFamily: "'DM Sans', sans-serif",
            }}
          >
            <div style={{
              width: 40, height: 4, background: "#e2e5ea", borderRadius: 2,
              margin: "0 auto 14px",
            }} />
            <div style={{
              fontSize: 11, fontWeight: 800, color: "#8b919a",
              textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 10,
            }}>More Tools</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {MORE_ITEMS.map(item => (
                <button
                  key={item.path}
                  onClick={() => { setDrawerOpen(false); navigate(item.path); }}
                  style={{
                    display: "flex", alignItems: "center", gap: 14,
                    padding: "14px 12px", borderRadius: 10,
                    border: "none", background: "transparent",
                    cursor: "pointer", textAlign: "left", fontFamily: "inherit",
                  }}
                >
                  <div style={{
                    width: 40, height: 40, borderRadius: 10,
                    background: "#f0f1f3", display: "flex",
                    alignItems: "center", justifyContent: "center",
                    fontSize: 20,
                  }}>{item.icon}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 800, color: "#1a1d23" }}>{item.label}</div>
                    <div style={{ fontSize: 12, color: "#6b7280" }}>{item.desc}</div>
                  </div>
                  <span style={{ color: "#cbd5e0", fontSize: 18 }}>›</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
