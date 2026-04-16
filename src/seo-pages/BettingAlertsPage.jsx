import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";

const S = {
  page: { minHeight: "100vh", background: "#f8f9fb", fontFamily: "'DM Sans', system-ui, sans-serif", color: "#1a1d23" },
  hero: { background: "linear-gradient(135deg, #1a1d23 0%, #2d3748 100%)", color: "#fff", padding: "60px 20px 50px", textAlign: "center" },
  h1: { fontSize: "clamp(28px, 5vw, 42px)", fontWeight: 800, margin: "0 0 16px", lineHeight: 1.2 },
  sub: { fontSize: 17, color: "#a0aec0", maxWidth: 620, margin: "0 auto", lineHeight: 1.6 },
  content: { maxWidth: 780, margin: "0 auto", padding: "40px 20px 60px" },
  h2: { fontSize: 24, fontWeight: 700, margin: "36px 0 14px", color: "#1a1d23" },
  h3: { fontSize: 18, fontWeight: 700, margin: "24px 0 10px", color: "#2d3748" },
  p: { fontSize: 15, lineHeight: 1.8, color: "#4a5568", margin: "0 0 16px" },
  ul: { fontSize: 15, lineHeight: 1.8, color: "#4a5568", margin: "0 0 16px", paddingLeft: 24 },
  cta: { display: "inline-block", padding: "14px 32px", background: "#1a73e8", color: "#fff", borderRadius: 10, fontWeight: 700, fontSize: 15, textDecoration: "none", margin: "20px 0" },
  card: { background: "#fff", borderRadius: 12, padding: "24px", border: "1px solid #e2e8f0", margin: "20px 0" },
};

export default function BettingAlertsPage() {
  return <div style={S.page}>
    <Helmet>
      <title>Sports Betting Alerts | Line Movement & +EV Notifications | MyOddsy</title>
      <meta name="description" content="Set custom sports betting alerts for +EV bets, line movements, big underdogs, and total shifts. Get notified when betting opportunities match your criteria." />
      <link rel="canonical" href="https://www.myoddsy.com/betting-alerts" />
      <meta property="og:title" content="Custom Sports Betting Alerts & Notifications | MyOddsy" />
      <meta property="og:description" content="Get notified when +EV bets, line movements, or underdog opportunities match your criteria." />
      <meta property="og:url" content="https://www.myoddsy.com/betting-alerts" />
    </Helmet>

    <div style={S.hero}>
      <h1 style={S.h1}>Sports Betting Alerts</h1>
      <p style={S.sub}>Never miss a +EV opportunity. Set custom alerts for line movements, value bets, and big underdogs.</p>
    </div>

    <div style={S.content}>
      <h2 style={S.h2}>Why Betting Alerts Matter</h2>
      <p style={S.p}>The best betting opportunities are time-sensitive. A +EV line might exist for only minutes before other bettors or the sportsbook itself corrects it. Line movements happen fast. By the time you manually check odds, the value may be gone.</p>
      <p style={S.p}>Betting alerts solve this by monitoring the market for you and notifying you when specific conditions are met -- so you can act on opportunities the moment they appear.</p>

      <h2 style={S.h2}>Alert Types Available</h2>

      <div style={S.card}>
        <h3 style={S.h3}>+EV Bet Found</h3>
        <p style={S.p}>Get alerted when a bet with positive expected value above your threshold appears. Set a minimum EV% (e.g., 2%, 5%) and get notified only for high-value opportunities. Great for bettors who want to focus on the highest-edge plays.</p>
      </div>

      <div style={S.card}>
        <h3 style={S.h3}>Line Movement</h3>
        <p style={S.p}>Track when odds shift significantly. Sharp money often causes sudden line movements -- a spread moving from -3 to -1.5 can signal professional action. Set your minimum point threshold and catch these moves in real time.</p>
      </div>

      <div style={S.card}>
        <h3 style={S.h3}>Big Underdog Alert</h3>
        <p style={S.p}>Get notified when underdog odds reach a specific threshold (e.g., +300 or higher). Underdogs at extreme odds can represent outsized value -- especially when multiple books disagree on the line. Historical data shows the public systematically undervalues underdogs.</p>
      </div>

      <div style={S.card}>
        <h3 style={S.h3}>Total Shift</h3>
        <p style={S.p}>Monitor over/under totals for significant movement. When a total drops from 220 to 215 or jumps from 45 to 48, it often reflects injury news, weather changes, or sharp action. These shifts can create value on the side the market is moving away from.</p>
      </div>

      <h2 style={S.h2}>How to Set Up Alerts</h2>
      <ul style={S.ul}>
        <li>Open the <strong>Alerts</strong> tab on MyOddsy</li>
        <li>Choose your sport (or "Any" for all sports)</li>
        <li>Select your alert trigger type</li>
        <li>Set your threshold (minimum EV%, points moved, etc.)</li>
        <li>Optionally filter by sportsbook</li>
        <li>Save your alert and get notified when conditions are met</li>
      </ul>

      <h2 style={S.h2}>Tips for Effective Alerts</h2>
      <p style={S.p}>Don't set thresholds too low or you'll be overwhelmed with notifications. Start with +EV alerts at 3%+ and line movement alerts at 1.5+ points. You can always lower thresholds once you're comfortable with the volume.</p>
      <p style={S.p}>Combine alert types for maximum effectiveness. A +EV bet that also shows significant line movement is a stronger signal than either indicator alone.</p>

      <Link to="/" style={S.cta}>Set Up Alerts -- Free</Link>
    </div>
  </div>;
}
