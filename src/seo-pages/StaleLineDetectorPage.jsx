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
  formula: { background: "#1a1d23", color: "#a0f0a0", borderRadius: 10, padding: "20px 24px", fontFamily: "'Space Mono', monospace", fontSize: 14, lineHeight: 1.8, margin: "20px 0", overflowX: "auto" },
  alert: { background: "#fffff0", border: "1px solid #fefcbf", borderRadius: 12, padding: "20px 24px", margin: "20px 0" },
};

export default function StaleLineDetectorPage() {
  const faqSchema = {
    "@context": "https://schema.org", "@type": "FAQPage",
    "mainEntity": [
      { "@type": "Question", "name": "What is a stale line in sports betting?", "acceptedAnswer": { "@type": "Answer", "text": "A stale line occurs when one sportsbook hasn't updated its odds to match the rest of the market. If DraftKings has the Lakers at -4 but FanDuel, BetMGM, and Caesars all moved to -5.5, DraftKings' line is stale. Betting the stale line gives you odds that the broader market has already determined are mispriced -- it's arbitrage-adjacent and genuinely +EV." } },
      { "@type": "Question", "name": "How long do stale lines last?", "acceptedAnswer": { "@type": "Answer", "text": "On major markets (NFL primetime, NBA nationally televised), stale lines typically last under 2 minutes. On obscure markets (mid-week MLS, WNBA, small college games), they can persist for 10-30 minutes or longer. The less liquid the market, the slower books are to correct." } },
      { "@type": "Question", "name": "Can you get limited for betting stale lines?", "acceptedAnswer": { "@type": "Answer", "text": "Yes. Sportsbooks track which accounts consistently hit stale lines and will reduce your bet limits or close your account. This is one of the most common reasons sharp accounts get limited. To mitigate this, vary your bet sizing, don't exclusively bet stale lines, and spread action across multiple books." } },
    ]
  };

  return <div style={S.page}>
    <Helmet>
      <title>Stale Line Detector | Find Mispriced Odds Before They Move | MyOddsy</title>
      <meta name="description" content="Find stale lines where one sportsbook hasn't caught up to the market. When 5 books move and 1 doesn't, you have a genuine +EV opportunity. Learn the stale line detection formula." />
      <link rel="canonical" href="https://www.myoddsy.com/stale-line-detector" />
      <meta property="og:title" content="Stale Line Detector: Bet the Slow Book | MyOddsy" />
      <meta property="og:description" content="When 5 sportsbooks move a line and 1 doesn't, bet the slow one. Stale line detection is the closest thing to guaranteed +EV in sports betting." />
      <meta property="og:url" content="https://www.myoddsy.com/stale-line-detector" />
      <script type="application/ld+json">{JSON.stringify(faqSchema)}</script>
    </Helmet>

    <div style={S.hero}>
      <h1 style={S.h1}>The Stale Line Detector</h1>
      <p style={S.sub}>When 5 sportsbooks move a line and 1 doesn't, you have a genuine +EV opportunity. Bet the slow book.</p>
    </div>

    <div style={S.content}>
      <h2 style={S.h2}>What is a Stale Line?</h2>
      <p style={S.p}>A stale line occurs when one sportsbook hasn't updated its odds to match the rest of the market. This happens constantly -- sportsbooks use different data feeds, different risk models, and different update frequencies. When news breaks, injury reports drop, or sharp money hits one book, the others adjust at different speeds.</p>
      <p style={S.p}>The result: for a brief window, one book is offering odds that the broader market has already determined are wrong. That's not speculation -- it's closer to arbitrage. If 5 out of 6 books agree a line should be -5.5 and one still has -4, the -4 is almost certainly mispriced.</p>

      <h2 style={S.h2}>How the Stale Line Detector Works</h2>
      <p style={S.p}>The detection algorithm runs continuously across all tracked sportsbooks:</p>

      <div style={S.formula}>
        Stale_Score = |Book_Line - Market_Median| x Volume_Weight<br /><br />
        Where:<br />
        &nbsp;&nbsp;Book_Line = the individual sportsbook's current odds<br />
        &nbsp;&nbsp;Market_Median = median line across all other books<br />
        &nbsp;&nbsp;Volume_Weight = number of books that have moved / total books<br /><br />
        Alert when Stale_Score {'>'} threshold (varies by market type)
      </div>

      <div style={S.card}>
        <h3 style={S.h3}>Example: Lakers vs. Celtics Spread</h3>
        <ul style={S.ul}>
          <li><strong>FanDuel:</strong> Lakers -5.5</li>
          <li><strong>BetMGM:</strong> Lakers -5.5</li>
          <li><strong>Caesars:</strong> Lakers -5</li>
          <li><strong>Fanatics:</strong> Lakers -5.5</li>
          <li><strong>BetRivers:</strong> Lakers -5.5</li>
          <li><strong>DraftKings:</strong> Lakers -4 <span style={{ color: "#e53e3e", fontWeight: 700 }}>(STALE)</span></li>
        </ul>
        <p style={S.p}><strong>Market median:</strong> -5.5. DraftKings is 1.5 points off the consensus. 4 out of 5 other books have moved. Stale Score = |(-4) - (-5.5)| x (4/5) = 1.5 x 0.8 = <strong>1.2</strong>. That's a strong stale line signal.</p>
        <p style={S.p}><strong>The bet:</strong> Take Lakers -4 on DraftKings. You're getting a line that the market says should be -5.5. That's 1.5 points of free value.</p>
      </div>

      <h2 style={S.h2}>Why Stale Lines are Genuinely +EV</h2>
      <p style={S.p}>Unlike most betting strategies that rely on models and predictions, stale line betting is closer to pure math. The market consensus -- represented by the median line across multiple sharp books -- is the best available estimate of the true line. A book that deviates significantly from that consensus is offering you better odds than the information warrants.</p>
      <p style={S.p}>Research on closing line value (CLV) consistently shows that betting lines that are better than the closing consensus produces long-term profit. Stale lines are, by definition, better than the current consensus. The edge is real.</p>

      <h2 style={S.h2}>How Long Do Stale Lines Last?</h2>
      <div style={S.card}>
        <ul style={S.ul}>
          <li><strong>NFL primetime / NBA nationally televised:</strong> Under 2 minutes. These markets are hyper-efficient</li>
          <li><strong>NFL Sunday early slate:</strong> 2-5 minutes. High volume but less scrutiny than primetime</li>
          <li><strong>MLB regular season:</strong> 5-15 minutes. Lower liquidity, slower corrections</li>
          <li><strong>WNBA, MLS, small college:</strong> 10-30+ minutes. Sometimes hours on obscure props</li>
          <li><strong>Overnight / early morning:</strong> Stale lines can persist for hours when trading desks are understaffed</li>
        </ul>
      </div>

      <h2 style={S.h2}>The Account Limitation Risk</h2>
      <div style={S.alert}>
        <h3 style={{ ...S.h3, color: "#744210" }}>Warning: Betting Limits</h3>
        <p style={S.p}>Sportsbooks track accounts that consistently hit stale lines. This is one of the fastest ways to get your account limited or closed. Books view stale-line bettors as a direct cost center. To manage this risk:</p>
        <ul style={S.ul}>
          <li><strong>Don't bet exclusively on stale lines</strong> -- Mix in recreational bets to look like a normal customer</li>
          <li><strong>Vary your bet sizing</strong> -- Consistent max bets on stale lines are a red flag</li>
          <li><strong>Spread across books</strong> -- Don't hammer a single book's stale lines repeatedly</li>
          <li><strong>Start small</strong> -- Build a betting history before increasing stakes on stale lines</li>
        </ul>
      </div>

      <h2 style={S.h2}>Stale Lines on MyOddsy</h2>
      <p style={S.p}>MyOddsy's Odds Comparison tab shows you live odds across 6 sportsbooks. When one book's line significantly deviates from the others, it's immediately visible in the comparison grid. Our Value Bets tab also flags opportunities where one book's odds create positive expected value versus the market consensus -- which is the same underlying signal as a stale line.</p>

      <Link to="/" style={S.cta}>Compare Odds Now</Link>

      <h2 style={S.h2}>Frequently Asked Questions</h2>
      <div style={S.card}>
        <h3 style={S.h3}>What is a stale line in sports betting?</h3>
        <p style={S.p}>A stale line occurs when one sportsbook hasn't updated its odds to match the market. If most books have moved to -5.5 and one still has -4, that -4 is stale. Betting it gives you odds the market considers mispriced -- it's genuinely +EV.</p>
      </div>
      <div style={S.card}>
        <h3 style={S.h3}>How long do stale lines last?</h3>
        <p style={S.p}>On major markets, under 2 minutes. On less liquid markets (WNBA, small college, mid-week MLB), they can persist 10-30 minutes or longer. The less attention a market gets, the slower books correct.</p>
      </div>
      <div style={S.card}>
        <h3 style={S.h3}>Can you get limited for betting stale lines?</h3>
        <p style={S.p}>Yes. Sportsbooks track which accounts hit stale lines and will reduce limits or close accounts. To mitigate, vary bet sizing, don't exclusively bet stale lines, and spread action across multiple books.</p>
      </div>
    </div>
  </div>;
}
