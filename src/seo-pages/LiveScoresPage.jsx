import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";

const S = {
  page: { minHeight: "100vh", background: "#f8f9fb", fontFamily: "'DM Sans', system-ui, sans-serif", color: "#1a1d23" },
  hero: { background: "linear-gradient(135deg, #1a1d23 0%, #2d3748 100%)", color: "#fff", padding: "60px 20px 50px", textAlign: "center" },
  h1: { fontSize: "clamp(28px, 5vw, 42px)", fontWeight: 800, margin: "0 0 16px", lineHeight: 1.2 },
  sub: { fontSize: 17, color: "#a0aec0", maxWidth: 620, margin: "0 auto", lineHeight: 1.6 },
  content: { maxWidth: 780, margin: "0 auto", padding: "40px 20px 60px" },
  h2: { fontSize: 24, fontWeight: 700, margin: "36px 0 14px", color: "#1a1d23" },
  p: { fontSize: 15, lineHeight: 1.8, color: "#4a5568", margin: "0 0 16px" },
  ul: { fontSize: 15, lineHeight: 1.8, color: "#4a5568", margin: "0 0 16px", paddingLeft: 24 },
  cta: { display: "inline-block", padding: "14px 32px", background: "#1a73e8", color: "#fff", borderRadius: 10, fontWeight: 700, fontSize: 15, textDecoration: "none", margin: "20px 0" },
};

export default function LiveScoresPage() {
  return <div style={S.page}>
    <Helmet>
      <title>Live Sports Scores | NFL, NBA, MLB, NHL Game Scores | MyOddsy</title>
      <meta name="description" content="Track live scores for NFL, NBA, MLB, and NHL games alongside betting odds. See real-time game status, scores, and how your bets are tracking." />
      <link rel="canonical" href="https://www.myoddsy.com/live-scores" />
      <meta property="og:title" content="Live Sports Scores for Bettors | MyOddsy" />
      <meta property="og:description" content="Track live NFL, NBA, MLB, and NHL scores alongside your betting odds and positions." />
      <meta property="og:url" content="https://www.myoddsy.com/live-scores" />
    </Helmet>

    <div style={S.hero}>
      <h1 style={S.h1}>Live Sports Scores</h1>
      <p style={S.sub}>Real-time scores for NFL, NBA, MLB, and NHL -- built for bettors who need to track their action.</p>
    </div>

    <div style={S.content}>
      <h2 style={S.h2}>Scores Built for Bettors</h2>
      <p style={S.p}>Most scoreboard apps are designed for fans. MyOddsy's live scores are designed for bettors. We show you the information that matters for tracking your wagers: current score, game status, quarter/period/inning, and time remaining.</p>
      <p style={S.p}>Our scores also power our betting recommendations -- we automatically filter out finished games and blowouts from our +EV and Sharp Plays feeds so you're only seeing actionable opportunities.</p>

      <h2 style={S.h2}>Sports Covered</h2>
      <ul style={S.ul}>
        <li><strong>NFL</strong> -- Live scores for every regular season, playoff, and Super Bowl game</li>
        <li><strong>NBA</strong> -- Real-time scores with quarter-by-quarter tracking</li>
        <li><strong>MLB</strong> -- Inning-by-inning scores for all games</li>
        <li><strong>NHL</strong> -- Live scores with period tracking</li>
      </ul>

      <h2 style={S.h2}>How We Use Live Scores</h2>
      <p style={S.p}>Live scores aren't just for watching -- they're integrated into our betting intelligence:</p>
      <ul style={S.ul}>
        <li><strong>Game filtering</strong> -- Finished and in-progress blowout games are automatically removed from betting recommendations</li>
        <li><strong>Status detection</strong> -- We classify games as upcoming, live, or finished to ensure odds recommendations are for pre-game and early-game opportunities only</li>
        <li><strong>Score-aware odds</strong> -- Our value bet scanner considers game status when surfacing opportunities</li>
      </ul>

      <h2 style={S.h2}>Auto-Refreshing Data</h2>
      <p style={S.p}>Scores update every 2 minutes during live games. The data comes from ESPN's live scoring API, ensuring accuracy and minimal delay. You'll always know where your bets stand without switching between apps.</p>

      <Link to="/" style={S.cta}>View Live Scores</Link>
    </div>
  </div>;
}
