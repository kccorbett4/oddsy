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
};

export default function ReverseLineMovementPage() {
  const faqSchema = {
    "@context": "https://schema.org", "@type": "FAQPage",
    "mainEntity": [
      { "@type": "Question", "name": "What is reverse line movement in sports betting?", "acceptedAnswer": { "@type": "Answer", "text": "Reverse line movement (RLM) occurs when the betting line moves in the opposite direction of where the majority of public bets are placed. For example, if 80% of bets are on the Chiefs but the line moves toward the Broncos, sharp money on the Broncos is causing the move. This is one of the strongest indicators of professional betting activity." } },
      { "@type": "Question", "name": "How do you identify reverse line movement?", "acceptedAnswer": { "@type": "Answer", "text": "Track three inputs: public bet percentage (which side has more tickets), handle percentage (which side has more dollars), and line movement direction since opening. When the public percentage heavily favors one side but the line moves the other way, you've found RLM. The bigger the gap between bet count and money, the stronger the signal." } },
      { "@type": "Question", "name": "Does reverse line movement still work?", "acceptedAnswer": { "@type": "Answer", "text": "RLM remains a useful signal but is less reliable on major markets where sportsbooks have gotten more sophisticated. It works best on less-efficient markets like small college games, mid-week MLB, WNBA, and MLS. Professional bettors still use RLM as one input in a broader analysis, not as a standalone system." } },
    ]
  };

  return <div style={S.page}>
    <Helmet>
      <title>Reverse Line Movement (RLM) Strategy | Fade the Public | MyOddsy</title>
      <meta name="description" content="Learn how reverse line movement works in sports betting. When the public bets one way but the line moves the other, sharp money is talking. Complete RLM strategy guide with the Public Fade Index formula." />
      <link rel="canonical" href="https://www.myoddsy.com/reverse-line-movement" />
      <meta property="og:title" content="Reverse Line Movement: The Sharp Money Signal | MyOddsy" />
      <meta property="og:description" content="When 90% of bets are on the Chiefs but the line moves toward the Broncos -- sharps are on the Broncos. Learn how to read RLM." />
      <meta property="og:url" content="https://www.myoddsy.com/reverse-line-movement" />
      <script type="application/ld+json">{JSON.stringify(faqSchema)}</script>
    </Helmet>

    <div style={S.hero}>
      <h1 style={S.h1}>Reverse Line Movement & the Public Fade Index</h1>
      <p style={S.sub}>When the public hammers one side but the line moves the other way, sharp money is talking. Learn how to listen.</p>
    </div>

    <div style={S.content}>
      <h2 style={S.h2}>What is Reverse Line Movement?</h2>
      <p style={S.p}>Reverse line movement (RLM) is the single most talked-about sharp betting signal -- and for good reason. It occurs when the betting line moves in the <strong>opposite direction</strong> of where the majority of public bets are placed.</p>
      <p style={S.p}>Here's the classic scenario: 85% of bets are on the Chiefs -3, but the line moves to Chiefs -2.5. If the public is pounding Kansas City, why would the sportsbook make it cheaper to bet them? Because sharp bettors -- the ones placing large, sophisticated wagers -- are on the Broncos. And the book is more afraid of sharp money than public money.</p>

      <h2 style={S.h2}>Why Lines Move Against the Public</h2>
      <p style={S.p}>Sportsbooks don't just balance their book based on the number of bets. They weight bets by size and by the bettor's track record. A $50,000 wager from a known sharp carries far more weight than 500 casual $100 bets. When sharp money comes in heavy on one side, books move the line to limit their exposure -- even if it means the line moves against 85% of their tickets.</p>
      <p style={S.p}>This creates a divergence between <strong>bet percentage</strong> (ticket count) and <strong>handle percentage</strong> (actual dollars wagered). That divergence is the core of the RLM signal.</p>

      <h2 style={S.h2}>The Public Fade Index Formula</h2>
      <p style={S.p}>The RLM-PF (Reverse Line Movement + Public Fade) Index combines three inputs into a single score:</p>

      <div style={S.formula}>
        RLM-PF Score = (Handle% on B - Bets% on B) x Line_Movement_Toward_B<br /><br />
        Where:<br />
        &nbsp;&nbsp;Handle% on B = percentage of money on the unpopular side<br />
        &nbsp;&nbsp;Bets% on B = percentage of tickets on the unpopular side<br />
        &nbsp;&nbsp;Line_Movement = magnitude of line shift toward B since open
      </div>

      <p style={S.p}>The bigger the gap between "how many people bet Side B" vs "how much money is on Side B," combined with the line actually moving toward B, the stronger the RLM signal.</p>

      <div style={S.card}>
        <h3 style={S.h3}>Example: Chiefs vs. Broncos</h3>
        <ul style={S.ul}>
          <li><strong>Opening line:</strong> Chiefs -3.5</li>
          <li><strong>Current line:</strong> Chiefs -2.5 (moved 1 point toward Broncos)</li>
          <li><strong>Public bets:</strong> 88% on Chiefs (12% on Broncos)</li>
          <li><strong>Handle:</strong> 55% on Broncos (sharp money)</li>
          <li><strong>RLM-PF Score:</strong> (55% - 12%) x 1.0 = <strong>43</strong> -- strong signal</li>
        </ul>
        <p style={S.p}>Translation: Only 12% of bettors like the Broncos, but 55% of the money is on them, and the line has moved a full point in their direction. Classic sharp action.</p>
      </div>

      <h2 style={S.h2}>Where RLM Works Best</h2>
      <p style={S.p}>Not all markets are created equal. RLM is most reliable in:</p>
      <ul style={S.ul}>
        <li><strong>Small college games</strong> -- Less efficient lines, fewer sharp bettors, bigger edges when sharps do act</li>
        <li><strong>Mid-week MLB</strong> -- Lower liquidity games where sharp action stands out more clearly</li>
        <li><strong>WNBA and MLS</strong> -- Niche markets where public perception is often wrong</li>
        <li><strong>Non-primetime NFL</strong> -- Sunday early slate games get less public attention than primetime</li>
      </ul>

      <h2 style={S.h2}>When RLM Fails</h2>
      <p style={S.p}>RLM isn't the mystical sharp indicator it once was. Sportsbooks have gotten smarter:</p>
      <ul style={S.ul}>
        <li><strong>Books shade lines preemptively</strong> -- They know which side the public will favor and set the opener accordingly</li>
        <li><strong>Major markets are too efficient</strong> -- On primetime NFL or NBA games, lines are sharp from the open. RLM signals are weaker</li>
        <li><strong>Bet % data isn't always accurate</strong> -- Sources like Action Network provide estimates, not exact figures</li>
        <li><strong>It's one signal, not a system</strong> -- Blindly fading the public without other analysis will lose long-term</li>
      </ul>

      <h2 style={S.h2}>How to Use RLM with MyOddsy</h2>
      <p style={S.p}>MyOddsy's Sharp Plays feature incorporates market divergence and odds discrepancy signals -- the same underlying mechanics that drive RLM. Our composite scoring system weighs how much sportsbooks disagree on a line and where the smart money appears to be flowing, giving you a data-driven view of sharp action without needing to manually track public percentages.</p>

      <Link to="/" style={S.cta}>See Today's Sharp Signals</Link>

      <h2 style={S.h2}>Frequently Asked Questions</h2>
      <div style={S.card}>
        <h3 style={S.h3}>What is reverse line movement in sports betting?</h3>
        <p style={S.p}>RLM occurs when the betting line moves opposite to where the majority of public bets are placed. If 80% of bets are on the Chiefs but the line moves toward the Broncos, sharp money on the Broncos is causing the move.</p>
      </div>
      <div style={S.card}>
        <h3 style={S.h3}>How do you identify reverse line movement?</h3>
        <p style={S.p}>Track public bet percentage, handle percentage (dollars), and line movement direction. When the public heavily favors one side but the line moves the other way, that's RLM. The bigger the gap between ticket count and money, the stronger the signal.</p>
      </div>
      <div style={S.card}>
        <h3 style={S.h3}>Does reverse line movement still work?</h3>
        <p style={S.p}>RLM remains useful but works best on less-efficient markets like small college games, mid-week MLB, WNBA, and MLS. On major markets, books have gotten more sophisticated and RLM signals are weaker. Use it as one input in a broader analysis, not a standalone system.</p>
      </div>
    </div>
  </div>;
}
