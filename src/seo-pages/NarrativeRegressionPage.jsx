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
  caution: { background: "#fff8f0", border: "1px solid #feebc8", borderRadius: 12, padding: "20px 24px", margin: "20px 0" },
};

export default function NarrativeRegressionPage() {
  const faqSchema = {
    "@context": "https://schema.org", "@type": "FAQPage",
    "mainEntity": [
      { "@type": "Question", "name": "What is narrative regression in sports betting?", "acceptedAnswer": { "@type": "Answer", "text": "Narrative regression is a betting strategy that identifies when a team's line has been distorted by a recent narrative -- a blowout loss, viral moment, coaching change, or star player drama -- that doesn't actually reflect the team's true quality. The strategy bets on the line correcting back toward the team's underlying performance metrics." } },
      { "@type": "Question", "name": "Does fading public overreaction work?", "acceptedAnswer": { "@type": "Answer", "text": "Research suggests it works in specific situations. NFL teams coming off a primetime blowout loss are historically undervalued the following week. The public anchors to the dramatic loss and overadjusts. However, it's not a universal edge -- you need to verify that the team's underlying metrics (EPA/play, DVOA, net rating) haven't actually changed to justify the line movement." } },
      { "@type": "Question", "name": "How do you measure narrative distortion in a betting line?", "acceptedAnswer": { "@type": "Answer", "text": "Compare the team's line movement (how much the spread has shifted) against their actual performance change (using metrics like EPA/play, DVOA, or net rating over a rolling window). If the line moved 4 points but the underlying metrics barely changed, the line is being driven by narrative, not substance. The Narrative Regression Score quantifies this gap." } },
    ]
  };

  return <div style={S.page}>
    <Helmet>
      <title>Narrative Regression Score | Bet Against the Overreaction | MyOddsy</title>
      <meta name="description" content="When the market overreacts to a primetime blowout or viral moment, the line gets distorted. The Narrative Regression Score identifies overreaction lines and bets the correction. A contrarian edge for disciplined bettors." />
      <link rel="canonical" href="https://www.myoddsy.com/narrative-regression" />
      <meta property="og:title" content="Narrative Regression: Betting Against the Market's Emotional Overreaction | MyOddsy" />
      <meta property="og:description" content="The market overreacted to the Monday Night blowout. Here's why the line is wrong -- and how to profit from it." />
      <meta property="og:url" content="https://www.myoddsy.com/narrative-regression" />
      <script type="application/ld+json">{JSON.stringify(faqSchema)}</script>
    </Helmet>

    <div style={S.hero}>
      <h1 style={S.h1}>The Narrative Regression Score</h1>
      <p style={S.sub}>The market overreacted to the Monday Night blowout. The underlying metrics barely moved. Here's how to bet the correction.</p>
    </div>

    <div style={S.content}>
      <h2 style={S.h2}>A Different Kind of Edge</h2>
      <p style={S.p}>Every betting tool on the market is forward-looking: who will win, what's the true line, where's the value. The Narrative Regression Score takes a different angle entirely. It's <strong>behavioral</strong> -- it bets against the betting public's emotional overreaction to recent events.</p>
      <p style={S.p}>When the Broncos get destroyed 42-10 on Monday Night Football, two things happen: the public panics and overadjusts their perception of the Broncos, and sportsbooks shade the line to exploit that public overreaction. The result is a line that's moved further than the team's actual quality warrants.</p>

      <h2 style={S.h2}>How Narratives Distort Lines</h2>
      <p style={S.p}>The betting market is efficient over time, but it systematically overreacts to specific types of events:</p>
      <ul style={S.ul}>
        <li><strong>Primetime blowouts</strong> -- A loss on Monday Night Football moves the line more than the same loss on Sunday at 1pm. Same result, different narrative weight</li>
        <li><strong>Viral moments</strong> -- A quarterback throwing 4 interceptions in a nationally televised game shifts public perception far more than the same stat line in an unaired game</li>
        <li><strong>Coaching changes</strong> -- The market initially overvalues "new coach energy" and later overcorrects when early results are mixed</li>
        <li><strong>Star player drama</strong> -- Trade rumors, holdouts, and locker room stories move lines before any on-field impact exists</li>
        <li><strong>Win/loss streaks</strong> -- A team on a 5-game win streak gets more public money than their metrics justify. A team on a 5-game losing streak gets less</li>
      </ul>

      <h2 style={S.h2}>The Narrative Regression Score Formula</h2>
      <p style={S.p}>The NRS quantifies the gap between how much a team's line has moved vs. how much their actual performance has changed:</p>

      <div style={S.formula}>
        NRS = (Line_Movement_Z_Score - Performance_Z_Score) x Confidence<br /><br />
        Where:<br />
        &nbsp;&nbsp;Line_Movement_Z_Score = how far the spread moved<br />
        &nbsp;&nbsp;&nbsp;&nbsp;vs. the team's season average (in std devs)<br />
        &nbsp;&nbsp;Performance_Z_Score = how far the team's underlying<br />
        &nbsp;&nbsp;&nbsp;&nbsp;metrics shifted (EPA/play, DVOA, net rating)<br />
        &nbsp;&nbsp;Confidence = f(sample_size, recency_of_event)<br /><br />
        NRS {'>'} 0: line moved MORE than performance justifies (fade the narrative)<br />
        NRS {'<'} 0: line moved LESS than performance justifies (ride the narrative)
      </div>

      <div style={S.card}>
        <h3 style={S.h3}>Example: Post-Blowout Overreaction</h3>
        <ul style={S.ul}>
          <li><strong>Week 8:</strong> Broncos lose 42-10 on Monday Night Football</li>
          <li><strong>Week 9 line:</strong> Broncos open as +7.5 underdogs (were +3 the prior week)</li>
          <li><strong>Line movement Z-score:</strong> +2.1 (the line moved 4.5 points more than expected)</li>
          <li><strong>Performance metrics:</strong> EPA/play dropped slightly but within normal variance</li>
          <li><strong>Performance Z-score:</strong> +0.4 (barely moved)</li>
          <li><strong>NRS:</strong> (2.1 - 0.4) x 0.85 = <strong>+1.45</strong> -- strong narrative distortion</li>
        </ul>
        <p style={S.p}>The market moved the line 4.5 points based on one bad game, but the Broncos' underlying quality barely changed. The NRS flags this as an overreaction -- take the Broncos +7.5.</p>
      </div>

      <h2 style={S.h2}>The Academic Evidence</h2>
      <p style={S.p}>Several studies support the core thesis behind narrative regression:</p>
      <ul style={S.ul}>
        <li><strong>NFL post-primetime losses:</strong> Research from Sports Insights and Bet Labs shows that teams coming off a Monday Night Football loss cover the spread at approximately 55% the following week -- significantly above the 50% breakeven rate</li>
        <li><strong>Recency bias in markets:</strong> Behavioral finance research (Kahneman & Tversky) demonstrates that humans systematically overweight recent, vivid events. This applies directly to sports betting markets</li>
        <li><strong>Mean reversion in performance:</strong> NFL EPA/play and NBA net rating both show strong mean reversion tendencies. A team that performs far above or below their season average in one game is likely to regress the next</li>
      </ul>

      <div style={S.caution}>
        <h3 style={{ ...S.h3, color: "#7b341e" }}>Honest Assessment</h3>
        <p style={S.p}>The Narrative Regression Score is the most speculative strategy on this site. Whether "narrative regression" is a persistent, exploitable edge or just historical noise is genuinely debatable. The academic support exists but isn't bulletproof. Some important caveats:</p>
        <ul style={S.ul}>
          <li>The edge is small -- 54-56% ATS, not 60%+. You need volume and discipline</li>
          <li>Sometimes the blowout IS the signal. If a team's QB got injured in the blowout, the line movement is justified</li>
          <li>You must verify with metrics. If EPA/play and DVOA both tanked, the narrative might be right</li>
          <li>This works best as one input alongside other signals, not as a standalone system</li>
        </ul>
        <p style={S.p}><strong>Use with discipline, not as a guarantee.</strong></p>
      </div>

      <h2 style={S.h2}>Contrarian Betting with MyOddsy</h2>
      <p style={S.p}>MyOddsy's Sharp Plays feature includes underdog value scoring that captures some of the same dynamics -- identifying underdogs where the public is likely overvaluing the favorite. Combined with market divergence analysis, our composite score helps surface games where the market consensus may be distorted by recency bias and narrative effects.</p>

      <Link to="/" style={S.cta}>Find Overreaction Lines</Link>

      <h2 style={S.h2}>Frequently Asked Questions</h2>
      <div style={S.card}>
        <h3 style={S.h3}>What is narrative regression in sports betting?</h3>
        <p style={S.p}>Narrative regression identifies when a team's line has been distorted by a recent narrative -- a blowout loss, viral moment, or coaching change -- that doesn't reflect the team's true quality. The strategy bets on the line correcting back toward underlying performance metrics.</p>
      </div>
      <div style={S.card}>
        <h3 style={S.h3}>Does fading public overreaction work?</h3>
        <p style={S.p}>Research suggests it works in specific situations, particularly NFL teams after primetime blowout losses. But it's not universal -- you need to verify that underlying metrics haven't actually changed. Use it as one input alongside other analysis, not as a standalone system.</p>
      </div>
      <div style={S.card}>
        <h3 style={S.h3}>How do you measure narrative distortion?</h3>
        <p style={S.p}>Compare line movement (how much the spread shifted) against actual performance change (EPA/play, DVOA, net rating over a rolling window). If the line moved significantly but metrics barely changed, the line is being driven by narrative rather than substance.</p>
      </div>
    </div>
  </div>;
}
