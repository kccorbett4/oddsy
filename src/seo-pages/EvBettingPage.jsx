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

export default function EvBettingPage() {
  const faqSchema = {
    "@context": "https://schema.org", "@type": "FAQPage",
    "mainEntity": [
      { "@type": "Question", "name": "What is +EV betting?", "acceptedAnswer": { "@type": "Answer", "text": "Positive expected value (+EV) betting means placing wagers where the true probability of winning is higher than the odds imply. Over time, +EV bets produce profit regardless of individual outcomes. It's the mathematical edge that professional bettors and sharp bettors rely on." } },
      { "@type": "Question", "name": "How do you find +EV bets?", "acceptedAnswer": { "@type": "Answer", "text": "You find +EV bets by comparing odds across multiple sportsbooks, calculating implied probabilities, and identifying lines where one book offers significantly better odds than the market consensus. Tools like MyOddsy automate this by scanning 6+ sportsbooks in real time." } },
      { "@type": "Question", "name": "Is +EV betting profitable long term?", "acceptedAnswer": { "@type": "Answer", "text": "Yes. By definition, consistently betting at positive expected value will produce profit over a large enough sample size. Professional bettors and syndicates have used EV-based strategies for decades. Individual bets can still lose, but the edge compounds over hundreds of wagers." } },
    ]
  };

  return <div style={S.page}>
    <Helmet>
      <title>What is +EV Betting? How to Find Positive Expected Value Bets | MyOddsy</title>
      <meta name="description" content="Learn what positive expected value (+EV) betting is, how it works, and how to find +EV bets across sportsbooks. The complete guide to profitable sports betting strategy." />
      <link rel="canonical" href="https://www.myoddsy.com/ev-betting" />
      <meta property="og:title" content="What is +EV Betting? Complete Guide to Positive EV Sports Betting" />
      <meta property="og:description" content="Learn how +EV betting works and how to find profitable betting opportunities across sportsbooks." />
      <meta property="og:url" content="https://www.myoddsy.com/ev-betting" />
      <script type="application/ld+json">{JSON.stringify(faqSchema)}</script>
    </Helmet>

    <div style={S.hero}>
      <h1 style={S.h1}>What is +EV Betting?</h1>
      <p style={S.sub}>The complete guide to positive expected value betting -- the strategy used by professional bettors to build long-term profit.</p>
    </div>

    <div style={S.content}>
      <h2 style={S.h2}>Understanding Expected Value in Sports Betting</h2>
      <p style={S.p}>Expected value (EV) is the average amount you can expect to win or lose per bet if you placed the same wager thousands of times. A <strong>positive expected value (+EV)</strong> bet is one where the math is in your favor -- the true probability of winning is higher than the odds suggest.</p>
      <p style={S.p}>Think of it this way: if a coin flip paid +110 on heads, that's a +EV bet. Heads wins 50% of the time, but the payout implies only a 47.6% chance. Over 1,000 flips, you'd profit roughly $50 per $100 wagered.</p>

      <h2 style={S.h2}>How +EV Betting Works</h2>
      <p style={S.p}>Sportsbooks set odds based on their models, public betting action, and risk management. Because different books use different models and see different action, their odds diverge -- sometimes significantly. These divergences create +EV opportunities.</p>

      <div style={S.card}>
        <h3 style={S.h3}>The +EV Formula</h3>
        <p style={S.p}><strong>EV = (Win Probability x Payout) - (Loss Probability x Stake)</strong></p>
        <p style={S.p}>Example: A moneyline at +150 with a true win probability of 45%</p>
        <ul style={S.ul}>
          <li>Win: 45% x $150 = $67.50</li>
          <li>Loss: 55% x $100 = $55.00</li>
          <li>EV = $67.50 - $55.00 = <strong>+$12.50 per $100 wagered</strong></li>
        </ul>
      </div>

      <h2 style={S.h2}>How to Find +EV Bets</h2>
      <p style={S.p}>There are several methods professional bettors use to identify +EV opportunities:</p>
      <ul style={S.ul}>
        <li><strong>Odds comparison across sportsbooks</strong> -- When one book's line is significantly better than the market average, it often represents +EV.</li>
        <li><strong>Pinnacle as a benchmark</strong> -- Pinnacle's closing line is widely regarded as the sharpest in the market. Bets that beat the Pinnacle close are historically profitable.</li>
        <li><strong>Market divergence analysis</strong> -- When books disagree on a line, it signals uncertainty and potential value.</li>
        <li><strong>Closing line value (CLV)</strong> -- Research by Levitt (2004) and others shows that consistently beating closing lines is the strongest predictor of long-term profitability.</li>
      </ul>

      <h2 style={S.h2}>Why Most Bettors Don't Use +EV</h2>
      <p style={S.p}>Most recreational bettors bet based on gut feelings, team loyalty, or narratives. They don't compare odds across books or calculate implied probabilities. This is why sportsbooks are profitable -- the majority of bets placed are -EV.</p>
      <p style={S.p}>The bettors who do use +EV strategies -- often called "sharps" -- are the ones books try to limit. Their edge comes not from predicting games perfectly, but from identifying when the odds are mispriced.</p>

      <h2 style={S.h2}>+EV Betting with MyOddsy</h2>
      <p style={S.p}>MyOddsy scans odds across 6 major sportsbooks in real time, calculates implied probabilities, and surfaces bets where the expected value is positive. Our Sharp Plays feature adds a composite scoring system that weighs odds discrepancy, market divergence, underdog value, and raw EV strength.</p>

      <Link to="/" style={S.cta}>Find +EV Bets Now</Link>

      <h2 style={S.h2}>Frequently Asked Questions</h2>
      <div style={S.card}>
        <h3 style={S.h3}>What is +EV betting?</h3>
        <p style={S.p}>Positive expected value (+EV) betting means placing wagers where the true probability of winning is higher than the odds imply. Over time, +EV bets produce profit regardless of individual outcomes.</p>
      </div>
      <div style={S.card}>
        <h3 style={S.h3}>How do you find +EV bets?</h3>
        <p style={S.p}>You find +EV bets by comparing odds across multiple sportsbooks, calculating implied probabilities, and identifying lines where one book offers significantly better odds than the market consensus. Tools like MyOddsy automate this process.</p>
      </div>
      <div style={S.card}>
        <h3 style={S.h3}>Is +EV betting profitable long term?</h3>
        <p style={S.p}>Yes. By definition, consistently betting at positive expected value will produce profit over a large sample size. Individual bets can lose, but the edge compounds over hundreds of wagers.</p>
      </div>
    </div>
  </div>;
}
