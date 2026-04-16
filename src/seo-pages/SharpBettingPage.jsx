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

export default function SharpBettingPage() {
  const articleSchema = {
    "@context": "https://schema.org", "@type": "Article",
    "headline": "Sharp Betting: What It Is and How Sharps Find Value",
    "description": "Learn what sharp betting means, how professional bettors find value, and how to identify sharp money movements in sports betting markets.",
    "url": "https://www.myoddsy.com/sharp-betting",
    "author": { "@type": "Organization", "name": "MyOddsy", "url": "https://www.myoddsy.com" },
    "publisher": { "@type": "Organization", "name": "MyOddsy", "url": "https://www.myoddsy.com" },
  };

  return <div style={S.page}>
    <Helmet>
      <title>Sharp Betting Guide: How Professional Bettors Find Value | MyOddsy</title>
      <meta name="description" content="Learn what sharp betting means, how pros identify value, and how to spot sharp money movements. Use data-driven tools to bet like a sharp." />
      <link rel="canonical" href="https://www.myoddsy.com/sharp-betting" />
      <meta property="og:title" content="Sharp Betting: How Professional Sports Bettors Find Value" />
      <meta property="og:description" content="Learn how sharp bettors find value using odds analysis, CLV, and market divergence." />
      <meta property="og:url" content="https://www.myoddsy.com/sharp-betting" />
      <script type="application/ld+json">{JSON.stringify(articleSchema)}</script>
    </Helmet>

    <div style={S.hero}>
      <h1 style={S.h1}>Sharp Betting: How Pros Find Value</h1>
      <p style={S.sub}>The strategies, tools, and mindset that separate professional bettors from the public.</p>
    </div>

    <div style={S.content}>
      <h2 style={S.h2}>What is a Sharp Bettor?</h2>
      <p style={S.p}>A "sharp" is a professional or highly skilled bettor who consistently profits from sports betting using mathematical analysis, statistical models, and disciplined bankroll management. Sharps don't bet on hunches -- they bet on numbers.</p>
      <p style={S.p}>Sportsbooks categorize their customers into two groups: sharps and squares (recreational bettors). When sharp money hits a line, books move it quickly. When square money hits, they often let it ride -- because square money is usually wrong.</p>

      <h2 style={S.h2}>How Sharps Find Value</h2>
      <p style={S.p}>Professional bettors use several key strategies to identify profitable opportunities:</p>

      <div style={S.card}>
        <h3 style={S.h3}>1. Closing Line Value (CLV)</h3>
        <p style={S.p}>The single best predictor of long-term betting success. If you consistently bet a line that's better than the closing line (the final odds before game time), you're likely a winning bettor. Research by Pinnacle and academic studies confirm this.</p>
      </div>

      <div style={S.card}>
        <h3 style={S.h3}>2. Market Divergence</h3>
        <p style={S.p}>When sportsbooks disagree on a line, it signals uncertainty. If DraftKings has a team at -3 and FanDuel has them at -1.5, the market hasn't settled. Sharps exploit these gaps before they close.</p>
      </div>

      <div style={S.card}>
        <h3 style={S.h3}>3. Odds Discrepancy Analysis</h3>
        <p style={S.p}>Comparing the best available odds against the market average reveals mispriced lines. A significant gap between one book's line and the consensus often represents genuine value.</p>
      </div>

      <div style={S.card}>
        <h3 style={S.h3}>4. Underdog Bias Exploitation</h3>
        <p style={S.p}>The public systematically overvalues favorites. Research from Sports Insights shows that home underdogs have covered the spread at a 57.1% rate historically. Sharps exploit this public bias.</p>
      </div>

      <h2 style={S.h2}>Sharp vs. Square Betting</h2>
      <ul style={S.ul}>
        <li><strong>Sharps</strong> bet early to get the best lines, or wait for value caused by public money</li>
        <li><strong>Squares</strong> bet based on team names, TV coverage, and gut feelings</li>
        <li><strong>Sharps</strong> track their results, calculate ROI, and adjust strategy</li>
        <li><strong>Squares</strong> remember wins, forget losses, and chase parlays</li>
        <li><strong>Sharps</strong> bet 1-3% of bankroll per play with discipline</li>
        <li><strong>Squares</strong> bet emotional amounts and increase stakes after losses</li>
      </ul>

      <h2 style={S.h2}>MyOddsy's Sharp Plays Feature</h2>
      <p style={S.p}>Our Sharp Plays tab uses a composite scoring system (0-100) that combines the same signals professional bettors use:</p>
      <ul style={S.ul}>
        <li><strong>Odds Discrepancy (0-30 pts)</strong> -- Gap between the best line and market average</li>
        <li><strong>Underdog Value (0-25 pts)</strong> -- Home underdog bonuses based on historical ATS data</li>
        <li><strong>Market Divergence (0-25 pts)</strong> -- How much books disagree on the line</li>
        <li><strong>EV Strength (0-20 pts)</strong> -- Raw positive expected value percentage</li>
      </ul>
      <p style={S.p}>Higher scores indicate plays where multiple sharp indicators align -- the kind of bets professionals look for.</p>

      <Link to="/" style={S.cta}>See Today's Sharp Plays</Link>
    </div>
  </div>;
}
