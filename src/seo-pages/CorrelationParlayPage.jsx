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
  good: { background: "#f0fff4", border: "1px solid #c6f6d5", borderRadius: 12, padding: "20px 24px", margin: "16px 0" },
  bad: { background: "#fff5f5", border: "1px solid #fed7d7", borderRadius: 12, padding: "20px 24px", margin: "16px 0" },
  formula: { background: "#1a1d23", color: "#a0f0a0", borderRadius: 10, padding: "20px 24px", fontFamily: "'Space Mono', monospace", fontSize: 14, lineHeight: 1.8, margin: "20px 0", overflowX: "auto" },
};

export default function CorrelationParlayPage() {
  const faqSchema = {
    "@context": "https://schema.org", "@type": "FAQPage",
    "mainEntity": [
      { "@type": "Question", "name": "What is a correlated parlay?", "acceptedAnswer": { "@type": "Answer", "text": "A correlated parlay combines bets that are more likely to hit together than independently. For example, a QB passing yards over and his WR's receiving yards over are positively correlated -- if the QB throws a lot, his top receiver likely catches a lot. Sportsbooks price standard parlays assuming independence, so correlated parlays can have positive expected value." } },
      { "@type": "Question", "name": "Are correlated parlays allowed?", "acceptedAnswer": { "@type": "Answer", "text": "Most sportsbooks now offer same-game parlays (SGPs) that allow correlated legs, but they adjust the odds to account for the correlation. The edge lives in finding correlations the book's model underestimates or cross-game correlations that aren't adjusted at all -- like weather affecting multiple games' totals." } },
      { "@type": "Question", "name": "What's the best correlation parlay strategy?", "acceptedAnswer": { "@type": "Answer", "text": "Focus on non-obvious cross-game correlations that sportsbooks don't adjust for. Weather games correlating unders across multiple matchups, division rivals playing low-scoring games, and pace-of-play correlations between teams are examples. Avoid the obvious single-game correlations that books already price in." } },
    ]
  };

  return <div style={S.page}>
    <Helmet>
      <title>Correlated Parlays Explained | The Parlay Edge Books Don't Want You to Know | MyOddsy</title>
      <meta name="description" content="Learn how correlated parlays exploit sportsbook pricing errors. When parlay legs are more likely to hit together than independently, the math shifts in your favor. Complete correlation strategy guide." />
      <link rel="canonical" href="https://www.myoddsy.com/correlated-parlays" />
      <meta property="og:title" content="Correlated Parlays: The Smart Parlay Strategy | MyOddsy" />
      <meta property="og:description" content="Sportsbooks price parlays assuming independence. When legs are correlated, the true odds are better than the book thinks. Learn how to exploit it." />
      <meta property="og:url" content="https://www.myoddsy.com/correlated-parlays" />
      <script type="application/ld+json">{JSON.stringify(faqSchema)}</script>
    </Helmet>

    <div style={S.hero}>
      <h1 style={S.h1}>Correlated Parlays: The Edge Hiding in Plain Sight</h1>
      <p style={S.sub}>Sportsbooks price parlays assuming each leg is independent. When they're not, the math shifts in your favor.</p>
    </div>

    <div style={S.content}>
      <h2 style={S.h2}>The Correlation Edge</h2>
      <p style={S.p}>Standard parlay math multiplies the odds of each leg together, assuming each outcome is independent. But in sports, outcomes are often correlated -- if one thing happens, another related thing becomes more or less likely.</p>
      <p style={S.p}>When you combine positively correlated legs in a parlay, the true probability of both hitting is <strong>higher</strong> than the independent calculation suggests. The sportsbook is paying you as if the legs are independent, but they're actually linked. That gap is your edge.</p>

      <h2 style={S.h2}>How Correlation Works</h2>

      <div style={S.good}>
        <h3 style={{ ...S.h3, color: "#22543d" }}>Positive Correlation (Good for Parlays)</h3>
        <p style={S.p}>These legs are more likely to hit together:</p>
        <ul style={S.ul}>
          <li><strong>QB passing yards OVER + WR receiving yards OVER</strong> (same team) -- If the QB throws a lot, his top target catches a lot</li>
          <li><strong>Game total OVER + both teams to score 20+</strong> -- High-scoring games mean both teams are usually scoring</li>
          <li><strong>RB rushing yards OVER + team total OVER</strong> -- A team scoring a lot often runs the ball effectively</li>
          <li><strong>Underdog ML + OVER</strong> -- Underdogs winning often means a high-scoring, competitive game</li>
          <li><strong>Weather-affected UNDERS across multiple outdoor games</strong> -- Heavy rain/wind suppresses scoring in multiple games simultaneously</li>
        </ul>
      </div>

      <div style={S.bad}>
        <h3 style={{ ...S.h3, color: "#742a2a" }}>Negative Correlation (Bad for Parlays)</h3>
        <p style={S.p}>These legs work against each other:</p>
        <ul style={S.ul}>
          <li><strong>Heavy favorite ML + UNDER</strong> -- Blowouts by favorites often push scoring over as the game gets out of hand</li>
          <li><strong>QB passing yards OVER + team rushing yards OVER</strong> (same team) -- If a team throws a lot, they're usually not running as much</li>
          <li><strong>Both team totals OVER in a game with a low total</strong> -- If the game total is 41, both teams going over their team total is unlikely</li>
        </ul>
      </div>

      <h2 style={S.h2}>The Correlation Parlay Formula</h2>
      <div style={S.formula}>
        Parlay_EV = (Implied_Probability_Independent x Correlation_Boost) x Payout<br /><br />
        Where:<br />
        &nbsp;&nbsp;Correlation_Boost = 1 + (Correlation_Score x Adjustment_Factor)<br />
        &nbsp;&nbsp;Correlation_Score = historical co-occurrence rate vs. independent expectation<br /><br />
        If Parlay_EV {'>'} 1.0, the parlay has positive expected value.
      </div>

      <p style={S.p}>A correlation score of 0 means truly independent legs. Positive scores mean the legs hit together more often than chance predicts. The higher the correlation score, the more the book is underpricing your parlay.</p>

      <h2 style={S.h2}>Where the Real Edge Lives</h2>
      <p style={S.p}>Here's the honest truth: sportsbooks have caught on to the obvious correlations. Same-game parlays on DraftKings and FanDuel now adjust odds for known correlations like QB passing + WR receiving. The juice on SGPs is often 15-30%, eating into the correlation edge.</p>
      <p style={S.p}>The real edge lives in <strong>non-obvious cross-game correlations</strong> that books don't adjust:</p>
      <ul style={S.ul}>
        <li><strong>Weather correlations</strong> -- A storm system hitting multiple outdoor stadiums suppresses scoring across games. Parlaying 3 unders in rain games is positively correlated but priced independently</li>
        <li><strong>Division rivalry patterns</strong> -- NFC East divisional games historically trend lower-scoring. Parlaying division game unders exploits this</li>
        <li><strong>Pace-of-play contagion</strong> -- Fast-paced teams playing each other push totals higher. Slow teams meeting each other drag them down</li>
        <li><strong>Back-to-back scheduling</strong> -- NBA teams on the second night of a back-to-back play slower and score less. Multiple B2B teams on the same slate = correlated unders</li>
      </ul>

      <h2 style={S.h2}>Building Correlated Parlays with MyOddsy</h2>
      <p style={S.p}>MyOddsy's Parlay Builder uses four distinct strategies, including Cross-Sport Value parlays that reduce single-game correlation risk and Sharp Consensus parlays built from the highest-EV legs on the board. By focusing on +EV legs rather than arbitrary picks, our parlays start with a mathematical foundation that correlation analysis can enhance.</p>

      <Link to="/" style={S.cta}>Build a Smart Parlay</Link>

      <h2 style={S.h2}>Frequently Asked Questions</h2>
      <div style={S.card}>
        <h3 style={S.h3}>What is a correlated parlay?</h3>
        <p style={S.p}>A correlated parlay combines bets that are more likely to hit together than independently. Sportsbooks price parlays assuming independence, so correlated parlays can have positive expected value when the true co-occurrence rate is higher than the book's pricing implies.</p>
      </div>
      <div style={S.card}>
        <h3 style={S.h3}>Are correlated parlays allowed?</h3>
        <p style={S.p}>Most books now offer same-game parlays that allow correlated legs, but they adjust odds to account for it. The edge lives in cross-game correlations that aren't adjusted -- like weather affecting multiple games' totals.</p>
      </div>
      <div style={S.card}>
        <h3 style={S.h3}>What's the best correlation parlay strategy?</h3>
        <p style={S.p}>Focus on non-obvious cross-game correlations: weather affecting multiple outdoor games, division rivalry scoring patterns, pace-of-play contagion, and back-to-back scheduling effects. Avoid obvious single-game correlations that books already price in.</p>
      </div>
    </div>
  </div>;
}
