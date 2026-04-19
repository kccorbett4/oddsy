// Custom Strategy Builder — lets the user define their own "formula" by
// adjusting 12 filters. Strategies are saved to localStorage and evaluated
// live against the same /api/odds feed the main app uses. Saved strategies
// are also auto-submitted to /api/track-save so their performance shows up
// in the Track Record tab (strategy name `custom:{id}`).

import { useState, useEffect, useMemo } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "./lib/AuthContext.jsx";
import AuthModal from "./lib/AuthModal.jsx";
import { fetchStrategies, saveStrategy, deleteStrategy } from "./lib/strategies.js";

const SPORTS = [
  { id: "americanfootball_nfl", name: "NFL", icon: "🏈" },
  { id: "basketball_nba", name: "NBA", icon: "🏀" },
  { id: "baseball_mlb", name: "MLB", icon: "⚾" },
  { id: "icehockey_nhl", name: "NHL", icon: "🏒" },
  { id: "basketball_ncaab", name: "NCAAB", icon: "🏀" },
  { id: "americanfootball_ncaaf", name: "NCAAF", icon: "🏈" },
  { id: "soccer_usa_mls", name: "MLS", icon: "⚽" },
  { id: "mma_mixed_martial_arts", name: "MMA", icon: "🥊" },
];
const MARKETS = [
  { id: "h2h", label: "Moneyline" },
  { id: "spreads", label: "Spread" },
  { id: "totals", label: "Total (O/U)" },
];
const BOOKS = ["DraftKings", "FanDuel", "BetMGM", "Caesars", "Fanatics", "BetRivers"];
const BOOK_URLS = {
  DraftKings: "https://www.draftkings.com/sportsbook",
  FanDuel: "https://www.fanduel.com/sportsbook",
  BetMGM: "https://sports.betmgm.com",
  Caesars: "https://www.caesars.com/sportsbook-and-casino",
  Fanatics: "https://www.fanatics.com/sportsbook",
  BetRivers: "https://www.betrivers.com",
};
const BookLink = ({ book, style }) => {
  const url = BOOK_URLS[book];
  if (!book) return null;
  if (!url) return <span style={style}>{book}</span>;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      style={{ color: "inherit", textDecoration: "underline", textDecorationStyle: "dotted", textUnderlineOffset: 2, ...style }}
    >{book}</a>
  );
};
const SIDES = [
  { id: "any", label: "Any" },
  { id: "fav", label: "Favorites only" },
  { id: "dog", label: "Underdogs only" },
];
const LOCATIONS = [
  { id: "any", label: "Any" },
  { id: "home", label: "Home only" },
  { id: "away", label: "Away only" },
];
const DAYS = [
  { id: 0, label: "Sun" }, { id: 1, label: "Mon" }, { id: 2, label: "Tue" },
  { id: 3, label: "Wed" }, { id: 4, label: "Thu" }, { id: 5, label: "Fri" }, { id: 6, label: "Sat" },
];
const TIMES = [
  { id: "any", label: "Any" },
  { id: "daytime", label: "Daytime (6a–5p)" },
  { id: "primetime", label: "Primetime (5p–11p)" },
  { id: "latenight", label: "Late (11p–6a)" },
];
const NOTIFY_MODES = [
  { id: "off", label: "Off" },
  { id: "immediate", label: "Immediate" },
  { id: "digest", label: "Daily digest" },
];

const DEFAULT_STRATEGY = () => ({
  id: null,
  name: "My Strategy",
  sports: ["americanfootball_nfl", "basketball_nba"],
  markets: ["spreads", "totals"],
  minEv: 2,
  minBooks: 3,
  minOdds: -250,
  maxOdds: 300,
  side: "any",
  location: "any",
  maxPicksPerDay: 5,
  hoursWindow: 48,
  books: [],
  // New filters
  totalMin: 0,
  totalMax: 300,
  spreadMin: 0,
  spreadMax: 30,
  daysOfWeek: [],        // empty = any day
  timeOfDay: "any",
  minBookDisagreement: 0, // min spread between highest/lowest line across books
  minHoursUntilTip: 0,
  excludePrimetime: false,
  maxVigPct: 15,         // reject offers where the book's vig exceeds this
  // Notifications
  notifyMode: "off",     // off | immediate | digest
  createdAt: new Date().toISOString(),
});

// ─── Odds math ──────────────────────────────────────
const impliedProb = (odds) => {
  if (odds > 0) return 100 / (odds + 100);
  return Math.abs(odds) / (Math.abs(odds) + 100);
};
const calcEV = (odds, estimatedProb) => {
  const payout = odds > 0 ? odds / 100 : 100 / Math.abs(odds);
  return (estimatedProb * payout - (1 - estimatedProb)) * 100;
};
const median = (arr) => {
  if (!arr || !arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

// ─── Strategy evaluator ─────────────────────────────
// Walks every game → market → outcome and returns the picks that match
// the strategy's filters, sorted by EV desc and capped at maxPicksPerDay.
export function evaluateStrategy(strategy, games) {
  if (!games || games.length === 0) return [];
  const out = [];
  const now = Date.now();
  const cutoff = now + (strategy.hoursWindow || 48) * 3600 * 1000;
  const minTipMs = now + (strategy.minHoursUntilTip || 0) * 3600 * 1000;
  const bookFilter = (strategy.books || []).length > 0 ? new Set(strategy.books) : null;
  const daysFilter = (strategy.daysOfWeek && strategy.daysOfWeek.length > 0) ? new Set(strategy.daysOfWeek) : null;
  const maxVig = typeof strategy.maxVigPct === "number" ? strategy.maxVigPct / 100 : 0.25;

  games.forEach(game => {
    if (!strategy.sports.includes(game.sport_key)) return;
    const commenceMs = new Date(game.commence_time).getTime();
    if (!Number.isFinite(commenceMs)) return;
    if (commenceMs < now) return; // already started
    if (commenceMs < minTipMs) return; // not yet in min-hours window
    if (commenceMs > cutoff) return;

    const commenceDate = new Date(commenceMs);
    const dow = commenceDate.getDay();
    const hour = commenceDate.getHours();
    if (daysFilter && !daysFilter.has(dow)) return;
    const isDaytime = hour >= 6 && hour < 17;
    const isPrimetime = hour >= 17 && hour < 23;
    const isLateNight = hour >= 23 || hour < 6;
    if (strategy.timeOfDay === "daytime" && !isDaytime) return;
    if (strategy.timeOfDay === "primetime" && !isPrimetime) return;
    if (strategy.timeOfDay === "latenight" && !isLateNight) return;
    if (strategy.excludePrimetime && isPrimetime) return;

    strategy.markets.forEach(marketType => {
      // Two-way vig removal per book, then median fair prob across books.
      const perOutcomeFair = {};
      const perOutcomeOffers = {};
      (game.bookmakers || []).forEach(book => {
        const market = (book.markets || []).find(m => m.key === marketType);
        if (!market || !market.outcomes || market.outcomes.length !== 2) return;
        const [o1, o2] = market.outcomes;
        const p1 = impliedProb(o1.price);
        const p2 = impliedProb(o2.price);
        const sum = p1 + p2;
        if (!(sum > 1.0 && sum < 1.25)) return;
        const bookVig = sum - 1;
        [[o1, p1 / sum], [o2, p2 / sum]].forEach(([o, fair]) => {
          const key = `${o.name}_${o.point || ""}`;
          if (!perOutcomeFair[key]) perOutcomeFair[key] = [];
          if (!perOutcomeOffers[key]) perOutcomeOffers[key] = [];
          perOutcomeFair[key].push(fair);
          perOutcomeOffers[key].push({ ...o, book: book.title, bookVig });
        });
      });

      Object.entries(perOutcomeOffers).forEach(([key, outcomes]) => {
        if (outcomes.length < strategy.minBooks) return;
        const fairProbs = perOutcomeFair[key];
        if (!fairProbs || fairProbs.length < strategy.minBooks) return;
        const vigFreeProb = median(fairProbs);

        // Book disagreement (spread of points or prices across books for this outcome)
        let disagreement = 0;
        if (marketType === "spreads" || marketType === "totals") {
          const points = outcomes.map(o => typeof o.point === "number" ? o.point : null).filter(p => p !== null);
          if (points.length >= 2) disagreement = Math.max(...points) - Math.min(...points);
        } else {
          // For moneyline, use implied-prob spread × 100 as a disagreement proxy
          const probs = outcomes.map(o => impliedProb(o.price));
          if (probs.length >= 2) disagreement = (Math.max(...probs) - Math.min(...probs)) * 100;
        }
        if (disagreement < (strategy.minBookDisagreement || 0)) return;

        outcomes.forEach(outcome => {
          if (bookFilter && !bookFilter.has(outcome.book)) return;
          if (outcome.price < strategy.minOdds) return;
          if (outcome.price > strategy.maxOdds) return;
          if (outcome.bookVig > maxVig) return;
          if (strategy.side === "fav" && outcome.price >= 0) return;
          if (strategy.side === "dog" && outcome.price <= 0) return;
          // Location filter only applies to h2h / spreads where we can
          // tell which side is home vs away by team name match.
          if (strategy.location !== "any" && (marketType === "h2h" || marketType === "spreads")) {
            const isHome = outcome.name === game.home_team;
            if (strategy.location === "home" && !isHome) return;
            if (strategy.location === "away" && isHome) return;
          }
          // Market-specific point-range filters
          if (marketType === "totals" && typeof outcome.point === "number") {
            if (outcome.point < (strategy.totalMin ?? 0)) return;
            if (outcome.point > (strategy.totalMax ?? 9999)) return;
          }
          if (marketType === "spreads" && typeof outcome.point === "number") {
            const abs = Math.abs(outcome.point);
            if (abs < (strategy.spreadMin ?? 0)) return;
            if (abs > (strategy.spreadMax ?? 9999)) return;
          }

          const ev = calcEV(outcome.price, vigFreeProb);
          if (ev < strategy.minEv) return;

          out.push({
            game,
            marketType,
            outcome: outcome.name,
            point: outcome.point,
            odds: outcome.price,
            book: outcome.book,
            ev: ev.toFixed(1),
            commence: game.commence_time,
          });
        });
      });
    });
  });

  out.sort((a, b) => parseFloat(b.ev) - parseFloat(a.ev));
  // Dedupe by game+outcome (keep best book per outcome)
  const seen = new Set();
  const deduped = [];
  for (const p of out) {
    const k = `${p.game.id}_${p.marketType}_${p.outcome}_${p.point || ""}`;
    if (seen.has(k)) continue;
    seen.add(k);
    deduped.push(p);
  }
  return deduped.slice(0, strategy.maxPicksPerDay || 10);
}

// ─── UI primitives ──────────────────────────────────
const fmtOdds = (n) => (n > 0 ? `+${n}` : `${n}`);
const inputStyle = {
  padding: "8px 10px", borderRadius: 8, border: "1px solid #e2e5ea",
  fontSize: 13, fontFamily: "inherit", width: "100%", background: "#fff",
};
const labelStyle = {
  display: "block", fontSize: 11, fontWeight: 700, color: "#5f6368",
  textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6,
};
const chipStyle = (active, color = "#1a73e8") => ({
  padding: "6px 12px", borderRadius: 16, cursor: "pointer",
  border: active ? `1.5px solid ${color}` : "1px solid #e2e5ea",
  background: active ? `${color}14` : "#fff",
  color: active ? color : "#5f6368",
  fontSize: 12, fontWeight: 700, fontFamily: "inherit",
});

function InfoTip({ text }) {
  const [open, setOpen] = useState(false);
  return (
    <span
      style={{ position: "relative", display: "inline-flex", marginLeft: 6, cursor: "help", verticalAlign: "middle" }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
    >
      <span style={{
        width: 14, height: 14, borderRadius: "50%",
        background: "#e2e5ea", color: "#5f6368",
        fontSize: 9, fontWeight: 900, lineHeight: "14px", textAlign: "center",
        display: "inline-block", fontFamily: "sans-serif",
      }}>i</span>
      {open && (
        <span style={{
          position: "absolute", bottom: "calc(100% + 6px)", left: "50%",
          transform: "translateX(-50%)", zIndex: 20,
          background: "#1a1d23", color: "#fff",
          fontSize: 11, fontWeight: 500, lineHeight: 1.4,
          padding: "8px 10px", borderRadius: 6,
          width: 220, textAlign: "left",
          textTransform: "none", letterSpacing: 0,
          whiteSpace: "normal",
          boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
        }}>
          {text}
        </span>
      )}
    </span>
  );
}

function Section({ title, info, children }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={labelStyle}>
        {title}
        {info && <InfoTip text={info} />}
      </div>
      {children}
    </div>
  );
}

// ─── Main component ─────────────────────────────────
export default function StrategyBuilder() {
  const navigate = useNavigate();
  const { id } = useParams();
  const { user, loading: authLoading, setShowAuthModal } = useAuth();

  const [strategies, setStrategies] = useState([]);
  const [strategiesLoaded, setStrategiesLoaded] = useState(false);
  const [form, setForm] = useState(null);
  const [games, setGames] = useState([]);
  const [loadingOdds, setLoadingOdds] = useState(true);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState(null);

  // Load the signed-in user's strategies from Supabase
  useEffect(() => {
    if (!user) { setStrategies([]); setStrategiesLoaded(false); return; }
    let cancelled = false;
    fetchStrategies().then(list => {
      if (!cancelled) { setStrategies(list); setStrategiesLoaded(true); }
    });
    return () => { cancelled = true; };
  }, [user]);

  // Initialize form based on URL param (wait for strategies to load first)
  useEffect(() => {
    if (!id) { setForm(null); return; }
    if (id === "new") { setForm(DEFAULT_STRATEGY()); return; }
    if (!strategiesLoaded) return;
    const existing = strategies.find(s => s.id === id);
    if (existing) setForm({ ...existing });
    else setForm(DEFAULT_STRATEGY());
  }, [id, strategiesLoaded]);

  // Fetch live odds (same cache key as main app — no duplicate request)
  useEffect(() => {
    const CACHE_KEY = "oddsy_odds_cache";
    const CACHE_DURATION = 10 * 60 * 1000;
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        const { data, timestamp } = JSON.parse(cached);
        if (Date.now() - timestamp < CACHE_DURATION && Array.isArray(data) && data.length > 0) {
          setGames(data);
          setLoadingOdds(false);
          return;
        }
      }
    } catch {}
    fetch("/api/odds")
      .then(r => (r.ok ? r.json() : null))
      .then(json => {
        if (json?.games) {
          setGames(json.games);
          try {
            localStorage.setItem(CACHE_KEY, JSON.stringify({ data: json.games, timestamp: Date.now() }));
          } catch {}
        }
      })
      .catch(() => {})
      .finally(() => setLoadingOdds(false));
  }, []);

  // Live preview — re-evaluates as the user tweaks controls
  const preview = useMemo(() => {
    if (!form) return [];
    return evaluateStrategy(form, games);
  }, [form, games]);

  const handleSave = async () => {
    if (!form || !form.name?.trim()) return;
    setSaveError(null);
    try {
      const saved = await saveStrategy(form);
      setForm({ ...saved });
      const next = await fetchStrategies();
      setStrategies(next);
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
      // Keep the URL in sync with the server-generated id
      if (!form.id || form.id !== saved.id) {
        navigate(`/strategy-builder/${saved.id}`, { replace: true });
      }
    } catch (err) {
      setSaveError(err.message || "Couldn't save");
    }
  };

  const handleDelete = async () => {
    if (!form || !form.id) { navigate("/strategy-builder"); return; }
    if (!confirm(`Delete strategy "${form.name}"?`)) return;
    try {
      await deleteStrategy(form.id);
      setStrategies(s => s.filter(x => x.id !== form.id));
      navigate("/strategy-builder");
    } catch (err) {
      setSaveError(err.message || "Couldn't delete");
    }
  };

  const updateForm = (patch) => setForm(f => ({ ...f, ...patch }));
  const toggleArrayValue = (field, value) => {
    setForm(f => {
      const arr = f[field] || [];
      return { ...f, [field]: arr.includes(value) ? arr.filter(v => v !== value) : [...arr, value] };
    });
  };

  // ─── AUTH GATE ──────────────────────────────────
  if (!authLoading && !user) {
    return (
      <Shell>
        <AuthModal />
        <div style={{ padding: "40px 8px", textAlign: "center" }}>
          <h1 style={{ margin: "0 0 8px", fontSize: 22, fontWeight: 900, color: "#1a1d23" }}>
            Sign in to build strategies
          </h1>
          <div style={{ fontSize: 13, color: "#6b7280", lineHeight: 1.5, marginBottom: 18, maxWidth: 360, margin: "0 auto 18px" }}>
            Your custom strategies are tied to your account so you can access them from any device and track their performance over time.
          </div>
          <button onClick={() => setShowAuthModal(true)} style={{
            padding: "11px 22px", borderRadius: 10, border: "none",
            background: "#1a73e8", color: "#fff", fontSize: 14, fontWeight: 800,
            cursor: "pointer", fontFamily: "inherit",
          }}>Sign in / Create account</button>
          <div style={{ marginTop: 18 }}>
            <Link to="/" style={{ fontSize: 12, color: "#8b919a", textDecoration: "none" }}>← Back to home</Link>
          </div>
        </div>
      </Shell>
    );
  }

  // ─── LIST VIEW ──────────────────────────────────
  if (!form) {
    return (
      <Shell>
        <div style={{ marginBottom: 18 }}>
          <h1 style={{ margin: "0 0 4px", fontSize: 22, fontWeight: 900, color: "#1a1d23" }}>
            Custom Strategies
          </h1>
          <div style={{ fontSize: 13, color: "#6b7280", lineHeight: 1.5 }}>
            Build your own "formula" with 12 filters. We evaluate it live against the same odds feed, save matching picks, and track performance in your Track Record.
          </div>
        </div>

        <button onClick={() => navigate("/strategy-builder/new")} style={{
          width: "100%", padding: "14px 18px", borderRadius: 12, border: "2px dashed #1a73e8",
          background: "#1a73e808", color: "#1a73e8", fontSize: 14, fontWeight: 800,
          cursor: "pointer", fontFamily: "inherit", marginBottom: 18,
        }}>+ Build a new strategy</button>

        {strategies.length === 0 ? (
          <div style={{
            background: "#f8f9fa", border: "1px dashed #cbd5e0", borderRadius: 12,
            padding: "32px 16px", textAlign: "center", color: "#6b7280", fontSize: 13,
          }}>
            No saved strategies yet. Build your first one above.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {strategies.map(s => {
              const matches = evaluateStrategy(s, games);
              return (
                <button key={s.id} onClick={() => navigate(`/strategy-builder/${s.id}`)} style={{
                  background: "#fff", border: "1px solid #e2e5ea", borderLeft: "3px solid #7c3aed",
                  borderRadius: 12, padding: "14px 16px", textAlign: "left",
                  cursor: "pointer", fontFamily: "inherit",
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 800, color: "#1a1d23", marginBottom: 4 }}>
                        ⚙️ {s.name}
                      </div>
                      <div style={{ fontSize: 11, color: "#6b7280", lineHeight: 1.5 }}>
                        {s.sports.length} sport{s.sports.length === 1 ? "" : "s"} · {s.markets.length} market{s.markets.length === 1 ? "" : "s"} · Min {s.minEv}% EV · {s.minBooks}+ books
                      </div>
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <div style={{ fontSize: 18, fontWeight: 900, color: "#7c3aed", fontFamily: "'Space Mono', monospace" }}>
                        {matches.length}
                      </div>
                      <div style={{ fontSize: 10, color: "#8b919a" }}>matches now</div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        <div style={{ marginTop: 22 }}>
          <Link to="/record" style={{ fontSize: 12, color: "#1a73e8", fontWeight: 700, textDecoration: "none" }}>
            View Track Record for your strategies →
          </Link>
        </div>
      </Shell>
    );
  }

  // ─── EDITOR VIEW ────────────────────────────────
  const isNew = id === "new" || !strategies.find(s => s.id === form.id);

  return (
    <Shell>
      <button onClick={() => navigate("/strategy-builder")} style={{
        background: "none", border: "none", color: "#1a73e8", fontSize: 13, fontWeight: 700,
        cursor: "pointer", padding: "4px 0", marginBottom: 10, fontFamily: "inherit",
      }}>← Back to strategies</button>

      <h1 style={{ margin: "0 0 6px", fontSize: 22, fontWeight: 900, color: "#1a1d23" }}>
        {isNew ? "New Strategy" : `Edit: ${form.name}`}
      </h1>
      <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 20, lineHeight: 1.5 }}>
        Tweak the filters below. The preview updates live. Save when you're happy and we'll start tracking it against real results.
      </div>

      <div style={{
        display: "grid",
        gridTemplateColumns: "1fr",
        gap: 22,
      }}>
        {/* Form */}
        <div style={{ background: "#fff", border: "1px solid #e2e5ea", borderRadius: 14, padding: "18px 18px" }}>
          <Section title="Strategy name" info="A label for yourself so you can tell your strategies apart on the Track Record and in email alerts.">
            <input
              type="text"
              value={form.name}
              onChange={e => updateForm({ name: e.target.value })}
              placeholder="My NFL dog-catcher"
              style={inputStyle}
              maxLength={40}
            />
          </Section>

          <Section title="Sports" info="Which leagues to scan. Pick one if you specialize; pick several for broader coverage.">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {SPORTS.map(s => (
                <button key={s.id} onClick={() => toggleArrayValue("sports", s.id)}
                  style={chipStyle(form.sports.includes(s.id))}>
                  {s.icon} {s.name}
                </button>
              ))}
            </div>
          </Section>

          <Section title="Markets" info="Moneyline = who wins. Spread = team covers the point handicap. Total = combined points over/under a number.">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {MARKETS.map(m => (
                <button key={m.id} onClick={() => toggleArrayValue("markets", m.id)}
                  style={chipStyle(form.markets.includes(m.id))}>
                  {m.label}
                </button>
              ))}
            </div>
          </Section>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <Section title={`Min EV %: ${form.minEv}%`} info="Expected Value. A bet with +2% EV means if you placed it 100 times, you'd profit 2 units. Higher = pickier. Most sharps use 2–5%.">
              <input type="range" min="0" max="20" step="0.5"
                value={form.minEv}
                onChange={e => updateForm({ minEv: parseFloat(e.target.value) })}
                style={{ width: "100%" }} />
            </Section>
            <Section title={`Min books offering: ${form.minBooks}`} info="How many sportsbooks must price the same line before we trust the market average. More books = more reliable consensus, fewer matches.">
              <input type="range" min="2" max="6" step="1"
                value={form.minBooks}
                onChange={e => updateForm({ minBooks: parseInt(e.target.value) })}
                style={{ width: "100%" }} />
            </Section>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <Section title={`Min odds: ${fmtOdds(form.minOdds)}`} info="Cheapest odds you'll accept. -250 means you won't bet a favorite priced steeper than -250 (too low payout).">
              <input type="range" min="-500" max="0" step="10"
                value={form.minOdds}
                onChange={e => updateForm({ minOdds: parseInt(e.target.value) })}
                style={{ width: "100%" }} />
            </Section>
            <Section title={`Max odds: ${fmtOdds(form.maxOdds)}`} info="Biggest longshot you'll consider. +300 means no underdogs priced above +300 (too unlikely to hit).">
              <input type="range" min="100" max="700" step="10"
                value={form.maxOdds}
                onChange={e => updateForm({ maxOdds: parseInt(e.target.value) })}
                style={{ width: "100%" }} />
            </Section>
          </div>

          <Section title="Side filter" info="Favorites have negative odds (more likely to win). Underdogs have positive odds (bigger payout if they win).">
            <div style={{ display: "flex", gap: 6 }}>
              {SIDES.map(s => (
                <button key={s.id} onClick={() => updateForm({ side: s.id })}
                  style={chipStyle(form.side === s.id)}>{s.label}</button>
              ))}
            </div>
          </Section>

          <Section title="Home / Away" info="Only applies to moneyline & spreads. Some bettors swear home underdogs or road favorites have an edge.">
            <div style={{ display: "flex", gap: 6 }}>
              {LOCATIONS.map(l => (
                <button key={l.id} onClick={() => updateForm({ location: l.id })}
                  style={chipStyle(form.location === l.id)}>{l.label}</button>
              ))}
            </div>
          </Section>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <Section title={`Max picks per day: ${form.maxPicksPerDay}`} info="Caps how many picks this strategy surfaces per day. Keeps your bankroll discipline in check.">
              <input type="range" min="1" max="25" step="1"
                value={form.maxPicksPerDay}
                onChange={e => updateForm({ maxPicksPerDay: parseInt(e.target.value) })}
                style={{ width: "100%" }} />
            </Section>
            <Section title={`Max hours until tip: ${form.hoursWindow}h`} info="How far in advance to look. 48h = only games in the next 2 days. Shorter = fresher lines, fewer picks.">
              <input type="range" min="2" max="168" step="2"
                value={form.hoursWindow}
                onChange={e => updateForm({ hoursWindow: parseInt(e.target.value) })}
                style={{ width: "100%" }} />
            </Section>
          </div>

          <Section title={`Preferred books (${form.books.length === 0 ? "all" : form.books.length})`} info="Only return picks at books you actually have accounts with. Leave empty to consider all books.">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {BOOKS.map(b => (
                <button key={b} onClick={() => toggleArrayValue("books", b)}
                  style={chipStyle(form.books.includes(b))}>{b}</button>
              ))}
            </div>
            <div style={{ fontSize: 10, color: "#8b919a", marginTop: 6 }}>
              Leave empty to include all books.
            </div>
          </Section>

          {/* ── Advanced filters ─────────────────────────── */}
          <div style={{ borderTop: "1px solid #e2e5ea", margin: "8px 0 18px" }} />
          <div style={{ fontSize: 12, fontWeight: 800, color: "#1a1d23", marginBottom: 12, letterSpacing: "0.04em", textTransform: "uppercase" }}>
            Advanced filters
          </div>

          {form.markets.includes("totals") && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <Section title={`Min total (O/U): ${form.totalMin}`} info="Only consider games where the sportsbook total is above this number. Use to target high-scoring games.">
                <input type="range" min="0" max="300" step="1"
                  value={form.totalMin}
                  onChange={e => updateForm({ totalMin: parseInt(e.target.value) })}
                  style={{ width: "100%" }} />
              </Section>
              <Section title={`Max total (O/U): ${form.totalMax}`} info="Skip games with totals above this number. Use to avoid unpredictable shootouts.">
                <input type="range" min="0" max="300" step="1"
                  value={form.totalMax}
                  onChange={e => updateForm({ totalMax: parseInt(e.target.value) })}
                  style={{ width: "100%" }} />
              </Section>
            </div>
          )}

          {form.markets.includes("spreads") && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <Section title={`Min spread (abs): ${form.spreadMin}`} info="Only spreads with at least this many points of handicap (absolute value). 0 = any spread.">
                <input type="range" min="0" max="30" step="0.5"
                  value={form.spreadMin}
                  onChange={e => updateForm({ spreadMin: parseFloat(e.target.value) })}
                  style={{ width: "100%" }} />
              </Section>
              <Section title={`Max spread (abs): ${form.spreadMax}`} info="Skip blowout-spread games. 14 = no spread over 14pts either way.">
                <input type="range" min="0" max="30" step="0.5"
                  value={form.spreadMax}
                  onChange={e => updateForm({ spreadMax: parseFloat(e.target.value) })}
                  style={{ width: "100%" }} />
              </Section>
            </div>
          )}

          <Section title={`Days of week (${form.daysOfWeek.length === 0 ? "any" : form.daysOfWeek.length + " selected"})`} info="Only surface picks on specific days. Handy if you only bet weekends. Leave empty to allow any day.">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {DAYS.map(d => (
                <button key={d.id} onClick={() => toggleArrayValue("daysOfWeek", d.id)}
                  style={chipStyle(form.daysOfWeek.includes(d.id))}>{d.label}</button>
              ))}
            </div>
          </Section>

          <Section title="Time of day" info="Filter by when the game kicks off in your local time. Primetime = marquee national-TV games. Late-night = West Coast tip-offs.">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {TIMES.map(t => (
                <button key={t.id} onClick={() => updateForm({ timeOfDay: t.id })}
                  style={chipStyle(form.timeOfDay === t.id)}>{t.label}</button>
              ))}
            </div>
          </Section>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <Section title={`Book disagreement: ${form.minBookDisagreement}+ pts`} info="How much the books must disagree on this line before we trust it as an edge. Higher = pickier. 0.5 = at least half a point of disagreement across books.">
              <input type="range" min="0" max="5" step="0.5"
                value={form.minBookDisagreement}
                onChange={e => updateForm({ minBookDisagreement: parseFloat(e.target.value) })}
                style={{ width: "100%" }} />
            </Section>
            <Section title={`Min hours until tip: ${form.minHoursUntilTip}h`} info="Skip games starting too soon. Useful to avoid last-minute injury news. 3h = pick must be at least 3 hours before kickoff.">
              <input type="range" min="0" max="24" step="1"
                value={form.minHoursUntilTip}
                onChange={e => updateForm({ minHoursUntilTip: parseInt(e.target.value) })}
                style={{ width: "100%" }} />
            </Section>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <Section title={`Max vig at book: ${form.maxVigPct}%`} info="Reject offers at books with high juice. 4.5% is a standard -110/-110 line. Lower = only clean prices.">
              <input type="range" min="3" max="15" step="0.5"
                value={form.maxVigPct}
                onChange={e => updateForm({ maxVigPct: parseFloat(e.target.value) })}
                style={{ width: "100%" }} />
            </Section>
            <Section title="Exclude primetime" info="Skip 5p–11p games. Primetime lines tend to be sharper (more public money = books adjust quickly).">
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => updateForm({ excludePrimetime: false })}
                  style={chipStyle(!form.excludePrimetime)}>Include</button>
                <button onClick={() => updateForm({ excludePrimetime: true })}
                  style={chipStyle(form.excludePrimetime)}>Exclude</button>
              </div>
            </Section>
          </div>

          {/* ── Notifications ─────────────────────────────── */}
          <div style={{ borderTop: "1px solid #e2e5ea", margin: "8px 0 18px" }} />
          <Section title="Email notifications" info="Off = no emails. Immediate = email when a new pick matches (deduped, so you only hear about each pick once). Daily digest = one summary email per day.">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {NOTIFY_MODES.map(m => (
                <button key={m.id} onClick={() => updateForm({ notifyMode: m.id })}
                  style={chipStyle(form.notifyMode === m.id)}>{m.label}</button>
              ))}
            </div>
            {form.notifyMode !== "off" && user?.email && (
              <div style={{ fontSize: 10, color: "#8b919a", marginTop: 8 }}>
                Notifications will be sent to <strong>{user.email}</strong>.
              </div>
            )}
          </Section>

          <div style={{ display: "flex", gap: 10, marginTop: 20, flexWrap: "wrap" }}>
            <button onClick={handleSave} disabled={!form.name?.trim()} style={{
              padding: "12px 20px", borderRadius: 10, border: "none",
              background: form.name?.trim() ? "#1a73e8" : "#cbd5e0",
              color: "#fff", fontSize: 14, fontWeight: 800,
              cursor: form.name?.trim() ? "pointer" : "not-allowed",
              fontFamily: "inherit", flex: 1, minWidth: 140,
            }}>
              {saved ? "✓ Saved" : isNew ? "Save & start tracking" : "Save changes"}
            </button>
            {!isNew && (
              <button onClick={handleDelete} style={{
                padding: "12px 18px", borderRadius: 10, border: "1px solid #fecaca",
                background: "#fff", color: "#dc2626", fontSize: 13, fontWeight: 700,
                cursor: "pointer", fontFamily: "inherit",
              }}>Delete</button>
            )}
          </div>
          {saveError && (
            <div style={{ marginTop: 10, fontSize: 12, color: "#dc2626" }}>{saveError}</div>
          )}
        </div>

        {/* Preview */}
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: "#1a1d23" }}>
              Live preview
            </h2>
            <div style={{ fontSize: 11, color: "#8b919a" }}>
              {loadingOdds ? "Loading…" : `${preview.length} match${preview.length === 1 ? "" : "es"} now`}
            </div>
          </div>

          {loadingOdds ? (
            <div style={{ background: "#f8f9fa", border: "1px dashed #cbd5e0", borderRadius: 12, padding: 20, textAlign: "center", color: "#8b919a", fontSize: 12 }}>
              Loading live odds…
            </div>
          ) : preview.length === 0 ? (
            <div style={{ background: "#fef3c7", border: "1px solid #fcd34d", borderRadius: 12, padding: 16, color: "#92400e", fontSize: 12, lineHeight: 1.6 }}>
              No picks match right now. Try loosening a filter (lower Min EV%, lower Min books, or widen the odds range). Strategies can have quiet days — that's normal.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {preview.map((p, i) => {
                const marketLabel = p.marketType === "h2h" ? "ML" : p.marketType === "spreads" ? "Spread" : "Total";
                const pointStr = p.point !== null && p.point !== undefined ? (p.point > 0 ? ` +${p.point}` : ` ${p.point}`) : "";
                const dateStr = new Date(p.commence).toLocaleDateString("en-US", { month: "short", day: "numeric" });
                return (
                  <div key={i} style={{
                    background: "#fff", border: "1px solid #e2e5ea", borderLeft: "3px solid #7c3aed",
                    borderRadius: 10, padding: "10px 12px",
                    display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10,
                  }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 2 }}>
                        <span style={{ fontSize: 9, fontWeight: 800, background: "#7c3aed14", color: "#7c3aed", padding: "2px 6px", borderRadius: 4 }}>{marketLabel}</span>
                        <span style={{ fontSize: 10, color: "#8b919a", fontWeight: 600 }}>{dateStr}</span>
                        <span style={{ fontSize: 10, color: "#0d9f4f", fontWeight: 700 }}>+{p.ev}% EV</span>
                      </div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "#1a1d23", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {p.outcome}{pointStr}
                      </div>
                      <div style={{ fontSize: 10, color: "#8b919a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {p.game.away_team} @ {p.game.home_team}
                      </div>
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 800, fontFamily: "'Space Mono', monospace", color: p.odds > 0 ? "#0d9f4f" : "#1a1d23" }}>
                        {fmtOdds(p.odds)}
                      </div>
                      <div style={{ fontSize: 10, color: "#8b919a" }}>
                        <BookLink book={p.book} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </Shell>
  );
}

// ─── Page shell (header + footer parity with main App) ───
function Shell({ children }) {
  return (
    <div style={{
      minHeight: "100vh",
      background: "#f5f6f8",
      color: "#1a1d23",
      fontFamily: "'DM Sans', sans-serif",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800;900&family=Space+Mono:wght@400;700&display=swap');
        * { box-sizing: border-box; }
        input::placeholder { color: #aab0b8; }
      `}</style>

      <header style={{
        padding: "16px 20px 0",
        background: "#fff",
        borderBottom: "1px solid #e2e5ea",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <Link to="/" style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}>
            <img src="/logo.jpeg" alt="MyOddsy — Sports Odds & Analytics" style={{ height: 80, display: "block", maxWidth: "75vw" }} />
          </Link>
          <Link to="/" style={{
            fontSize: 12, fontWeight: 700, color: "#1a73e8", textDecoration: "none",
            padding: "8px 12px", border: "1px solid #e2e5ea", borderRadius: 10, background: "#fff",
          }}>← Home</Link>
        </div>
      </header>

      <main style={{ padding: "18px 20px 60px", maxWidth: 900, margin: "0 auto" }}>
        {children}
      </main>
    </div>
  );
}
