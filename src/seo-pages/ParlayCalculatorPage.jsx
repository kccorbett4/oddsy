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

export default function ParlayCalculatorPage() {
  const faqSchema = {
    "@context": "https://schema.org", "@type": "FAQPage",
    "mainEntity": [
      { "@type": "Question", "name": "What is a parlay bet?", "acceptedAnswer": { "@type": "Answer", "text": "A parlay combines multiple individual bets (legs) into one wager. All legs must win for the parlay to pay out. The odds multiply together, creating larger potential payouts but lower probability of winning." } },
      { "@type": "Question", "name": "How are parlay odds calculated?", "acceptedAnswer": { "@type": "Answer", "text": "Parlay odds are calculated by converting each leg to decimal odds and multiplying them together. For example, three legs at -110 each: 1.909 x 1.909 x 1.909 = 6.96 decimal odds, or roughly +596 in American odds." } },
      { "@type": "Question", "name": "Are parlays a good bet?", "acceptedAnswer": { "@type": "Answer", "text": "Standard parlays have a higher house edge than straight bets. However, building parlays with +EV legs can create positive expected value parlays. The key is selecting legs where each individual bet has a mathematical edge, not just picking favorites." } },
    ]
  };

  return <div style={S.page}>
    <Helmet>
      <title>Parlay Calculator & Builder | Build +EV Parlays | MyOddsy</title>
      <meta name="description" content="Build smarter parlays with our free parlay calculator. See combined odds, implied probability, and estimated payouts. Build value parlays using +EV legs from 6 sportsbooks." />
      <link rel="canonical" href="https://www.myoddsy.com/parlay-calculator" />
      <meta property="og:title" content="Free Parlay Calculator & Smart Parlay Builder | MyOddsy" />
      <meta property="og:description" content="Build parlays with +EV legs. Calculate combined odds, implied probability, and payouts instantly." />
      <meta property="og:url" content="https://www.myoddsy.com/parlay-calculator" />
      <script type="application/ld+json">{JSON.stringify(faqSchema)}</script>
    </Helmet>

    <div style={S.hero}>
      <h1 style={S.h1}>Parlay Calculator & Smart Builder</h1>
      <p style={S.sub}>Build parlays using positive EV legs. See combined odds, win probability, and payouts for any parlay combination.</p>
    </div>

    <div style={S.content}>
      <h2 style={S.h2}>What is a Parlay Bet?</h2>
      <p style={S.p}>A parlay combines two or more individual bets into a single wager. Every leg of the parlay must win for the bet to pay out. In exchange for this added difficulty, the odds multiply together, producing much larger payouts than placing each bet individually.</p>
      <p style={S.p}>A 3-leg parlay with each leg at -110 pays roughly +596 (about 6:1), compared to winning three separate bets at -110 which would yield much less total profit for the same risk.</p>

      <h2 style={S.h2}>The Problem with Most Parlays</h2>
      <p style={S.p}>Sportsbooks love parlays because the house edge compounds with each leg. A standard 2-leg parlay at -110/-110 has a theoretical house edge of about 10%, compared to 4.5% on a single bet. Add more legs and it gets worse.</p>
      <p style={S.p}>This is why most betting advice says to avoid parlays. But that advice assumes you're betting at standard juice. If each leg is a <strong>+EV bet</strong>, the math changes entirely.</p>

      <h2 style={S.h2}>Building +EV Parlays with MyOddsy</h2>
      <p style={S.p}>MyOddsy's parlay builder takes a different approach. Instead of letting you blindly combine favorites, it builds parlays from legs that individually have positive expected value:</p>

      <div style={S.card}>
        <h3 style={S.h3}>4 Parlay Strategies</h3>
        <ul style={S.ul}>
          <li><strong>Cross-Sport Value</strong> -- Top +EV picks from 3 different sports, reducing correlation risk</li>
          <li><strong>Chalk Crusher</strong> -- 3 undervalued underdogs with positive EV for high risk/reward</li>
          <li><strong>Sharp Consensus</strong> -- The 3 highest EV bets on the board combined</li>
          <li><strong>Safe + Sprinkle</strong> -- 2 solid favorite values + 1 big underdog for balanced exposure</li>
        </ul>
      </div>

      <h2 style={S.h2}>How Parlay Odds Are Calculated</h2>
      <p style={S.p}>Parlay odds are calculated by converting each leg to decimal odds and multiplying:</p>
      <div style={S.card}>
        <p style={S.p}><strong>Step 1:</strong> Convert American odds to decimal</p>
        <ul style={S.ul}>
          <li>Positive odds: (odds / 100) + 1 -- Example: +150 = 2.50</li>
          <li>Negative odds: (100 / |odds|) + 1 -- Example: -150 = 1.667</li>
        </ul>
        <p style={S.p}><strong>Step 2:</strong> Multiply decimal odds together</p>
        <p style={S.p}>Example: 2.50 x 1.667 x 1.909 = 7.95 combined decimal odds</p>
        <p style={S.p}><strong>Step 3:</strong> Calculate payout -- $100 x 7.95 = $795 total return ($695 profit)</p>
      </div>

      <h2 style={S.h2}>Frequently Asked Questions</h2>
      <div style={S.card}>
        <h3 style={S.h3}>What is a parlay bet?</h3>
        <p style={S.p}>A parlay combines multiple individual bets into one wager. All legs must win for the parlay to pay out. The odds multiply together, creating larger potential payouts but lower win probability.</p>
      </div>
      <div style={S.card}>
        <h3 style={S.h3}>How are parlay odds calculated?</h3>
        <p style={S.p}>Convert each leg to decimal odds and multiply them together. Three legs at -110 each: 1.909 x 1.909 x 1.909 = 6.96 decimal odds, or roughly +596 in American odds.</p>
      </div>
      <div style={S.card}>
        <h3 style={S.h3}>Are parlays a good bet?</h3>
        <p style={S.p}>Standard parlays have a higher house edge than straight bets. However, building parlays with +EV legs can create positive expected value. The key is selecting legs where each individual bet has a mathematical edge.</p>
      </div>

      <Link to="/" style={S.cta}>Build a Smart Parlay Now</Link>
    </div>
  </div>;
}
