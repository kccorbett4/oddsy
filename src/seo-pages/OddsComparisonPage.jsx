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
  table: { width: "100%", borderCollapse: "collapse", fontSize: 14, margin: "20px 0" },
  th: { background: "#f7fafc", padding: "12px 16px", textAlign: "left", fontWeight: 700, borderBottom: "2px solid #e2e8f0" },
  td: { padding: "12px 16px", borderBottom: "1px solid #f0f0f0" },
};

export default function OddsComparisonPage() {
  const schema = {
    "@context": "https://schema.org", "@type": "WebApplication",
    "name": "MyOddsy Odds Comparison Tool",
    "url": "https://www.myoddsy.com/odds-comparison",
    "description": "Compare live sports betting odds across DraftKings, FanDuel, BetMGM, Caesars, Fanatics, and BetRivers. Find the best lines instantly.",
    "applicationCategory": "UtilitiesApplication",
    "operatingSystem": "Any",
    "offers": { "@type": "Offer", "price": "0", "priceCurrency": "USD" }
  };

  return <div style={S.page}>
    <Helmet>
      <title>Compare Sports Betting Odds Across Sportsbooks | MyOddsy</title>
      <meta name="description" content="Compare live betting odds across DraftKings, FanDuel, BetMGM, Caesars, Fanatics, and BetRivers. Find the best moneylines, spreads, and totals for NFL, NBA, MLB, NHL, and more." />
      <link rel="canonical" href="https://www.myoddsy.com/odds-comparison" />
      <meta property="og:title" content="Compare Betting Odds Across 6 Sportsbooks | MyOddsy" />
      <meta property="og:description" content="Find the best sports betting lines by comparing odds across DraftKings, FanDuel, BetMGM, and more." />
      <meta property="og:url" content="https://www.myoddsy.com/odds-comparison" />
      <script type="application/ld+json">{JSON.stringify(schema)}</script>
    </Helmet>

    <div style={S.hero}>
      <h1 style={S.h1}>Compare Sports Betting Odds</h1>
      <p style={S.sub}>See live odds from 6 major sportsbooks side by side. Find the best lines for every game in seconds.</p>
    </div>

    <div style={S.content}>
      <h2 style={S.h2}>Why Comparing Odds Matters</h2>
      <p style={S.p}>Line shopping is the single most impactful thing you can do to improve your sports betting results. A study of NFL moneylines over 5 seasons found that bettors who consistently took the best available line earned <strong>3-5% more</strong> on every winning bet compared to those who used a single book.</p>
      <p style={S.p}>The difference between -110 and -105 on a spread bet might seem small, but over hundreds of bets it compounds into thousands of dollars. Professional bettors never place a wager without checking multiple books first.</p>

      <h2 style={S.h2}>Sportsbooks We Compare</h2>
      <p style={S.p}>MyOddsy pulls live odds from 6 of the largest legal US sportsbooks:</p>

      <table style={S.table}>
        <thead>
          <tr>
            <th style={S.th}>Sportsbook</th>
            <th style={S.th}>Markets</th>
            <th style={S.th}>Known For</th>
          </tr>
        </thead>
        <tbody>
          <tr><td style={S.td}><strong>DraftKings</strong></td><td style={S.td}>Moneyline, Spread, Total</td><td style={S.td}>Best prop variety, frequent promos</td></tr>
          <tr><td style={S.td}><strong>FanDuel</strong></td><td style={S.td}>Moneyline, Spread, Total</td><td style={S.td}>Sharp lines, fast payouts</td></tr>
          <tr><td style={S.td}><strong>BetMGM</strong></td><td style={S.td}>Moneyline, Spread, Total</td><td style={S.td}>Competitive NFL odds</td></tr>
          <tr><td style={S.td}><strong>Caesars</strong></td><td style={S.td}>Moneyline, Spread, Total</td><td style={S.td}>Large welcome bonuses</td></tr>
          <tr><td style={S.td}><strong>Fanatics</strong></td><td style={S.td}>Moneyline, Spread, Total</td><td style={S.td}>Loyalty rewards program</td></tr>
          <tr><td style={S.td}><strong>BetRivers</strong></td><td style={S.td}>Moneyline, Spread, Total</td><td style={S.td}>Sharp-friendly, good for underdogs</td></tr>
        </tbody>
      </table>

      <h2 style={S.h2}>Sports Covered</h2>
      <p style={S.p}>We compare odds across all major US sports markets:</p>
      <ul style={S.ul}>
        <li><strong>NFL</strong> -- Full game moneylines, point spreads, and over/under totals</li>
        <li><strong>NBA</strong> -- Moneylines, spreads, and totals for every regular season and playoff game</li>
        <li><strong>MLB</strong> -- Moneylines, run lines, and over/under totals</li>
        <li><strong>NHL</strong> -- Moneylines, puck lines, and totals</li>
        <li><strong>NCAAF & NCAAB</strong> -- College football and basketball lines</li>
        <li><strong>MMA</strong> -- Fight moneylines and totals</li>
        <li><strong>MLS</strong> -- Match moneylines and totals</li>
      </ul>

      <h2 style={S.h2}>How to Use the Odds Comparison Tool</h2>
      <div style={S.card}>
        <ol style={{ ...S.ul, listStyleType: "decimal" }}>
          <li>Open the <strong>Odds</strong> tab on MyOddsy</li>
          <li>Filter by sport using the pill buttons at the top</li>
          <li>Search for a specific team using the search bar</li>
          <li>Compare moneylines across all 6 books -- the best line is highlighted</li>
          <li>Click the sportsbook name to place your bet at the best available odds</li>
        </ol>
      </div>

      <h2 style={S.h2}>The Cost of Not Line Shopping</h2>
      <p style={S.p}>Consider this example: You want to bet on the Lakers moneyline. DraftKings has them at -150, but FanDuel has -140. On a $100 bet, you'd win $66.67 at DraftKings vs $71.43 at FanDuel. That's $4.76 left on the table on a single bet.</p>
      <p style={S.p}>Multiply that by 5 bets a week, 52 weeks a year, and you're leaving <strong>$1,200+ on the table annually</strong> by not shopping lines.</p>

      <Link to="/" style={S.cta}>Compare Odds Now -- Free</Link>
    </div>
  </div>;
}
