// Supplementary DK/FanDuel HR-props scraper. Their published sportsbook
// pages both read data from unauthenticated JSON endpoints that we hit
// directly here, parse, and normalize into the same shape the Odds API
// returns so the main handler can merge seamlessly.
//
// Endpoints shift periodically. Every call is wrapped so a failure on
// one provider never blocks the other or the main Odds API response —
// the scraper returns `{ book, ok, error?, events: [...] }` and the
// odds handler surfaces status in its diagnostic payload.

const TIMEOUT_MS = 8000;

// Uniform fetch with a hard timeout so a hanging sportsbook can't
// stall a serverless invocation.
async function jfetch(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      ...opts,
      signal: ctrl.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; OddsyHRFetch/1.0)",
        "accept": "application/json, text/plain, */*",
        ...(opts.headers || {}),
      },
    });
    if (!r.ok) throw new Error(`${url} → ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

const americanToDecimal = (a) => {
  if (!Number.isFinite(a)) return null;
  return a >= 0 ? 1 + a / 100 : 1 + 100 / Math.abs(a);
};

// Convert "Aaron Judge" -> "aaron judge" with punctuation stripped. Used
// for cross-source player matching inside the scraper. The main odds
// handler already has its own matcher for final reconciliation.
const normName = (s) => (s || "").trim();

// ────────────────────────────────────────────────────────────────────
// DraftKings
// ────────────────────────────────────────────────────────────────────
// DK exposes MLB content through its Nash API. Eventgroup 84240 = MLB.
// Categories/subcategories identify specific markets; 743 is their
// "Player Props" category, and "Home Runs" lives as a subcategory
// beneath it. The shape we want:
//   leagues/84240/categories/743/subcategories?format=json  -> subcat list
//   leagues/84240/categories/743/subcategories/{id}?format=json -> offers
// In practice the subcategory ID has been stable (~17000-range) but we
// look it up dynamically to tolerate renumbering.
//
// DK upgraded the Nash API from v1 → v2 in April 2026. We try v2 first
// and fall back to v1 in case they maintain both for backwards compat.
async function scrapeDraftKings() {
  const v2 = "https://sportsbook-nash.draftkings.com/api/v2/dkusnj";
  const v1 = "https://sportsbook-nash.draftkings.com/api/sportscontent/dkusnj/v1";
  let base = v2;
  let cats = await jfetch(`${base}/leagues/84240/categories`).catch(() => null);
  if (!cats || !Array.isArray(cats?.categories)) {
    base = v1;
    cats = await jfetch(`${base}/leagues/84240/categories`);
  }

  const propsCat = (cats?.categories || []).find(c =>
    (c.name || "").toLowerCase().includes("player") ||
    (c.name || "").toLowerCase().includes("prop")
  ) || (cats?.categories || []).find(c => c.id === 743);
  if (!propsCat) throw new Error("no player-props category on DK MLB");

  const subUrl = `${base}/leagues/84240/categories/${propsCat.id}/subcategories`;
  const subs = await jfetch(subUrl);
  const hrSub = (subs?.subcategories || []).find(s =>
    /home\s*runs?$/i.test(s.name || "") || /anytime\s*hr/i.test(s.name || "")
  );
  if (!hrSub) throw new Error("no home-runs subcategory on DK MLB props");

  const offersUrl = `${base}/leagues/84240/categories/${propsCat.id}/subcategories/${hrSub.id}`;
  const offers = await jfetch(offersUrl);

  // offers.events = [{ eventId, name: "Yankees @ Royals", startEventDate, ... }]
  // offers.offerCategories[].offerSubcategoryDescriptors[].offerSubcategory.offers
  //   is an array of arrays, each inner array = one player's lines
  const events = (offers?.events || []).map(e => ({
    eventId: e.eventId,
    home: e.teams?.find(t => t.isHome)?.displayName || e.homeTeam || null,
    away: e.teams?.find(t => !t.isHome)?.displayName || e.awayTeam || null,
    commence: e.startEventDate,
    name: e.name,
  }));

  const offerGroups = [];
  for (const oc of (offers?.offerCategories || [])) {
    for (const osd of (oc.offerSubcategoryDescriptors || [])) {
      const subOffers = osd?.offerSubcategory?.offers || [];
      for (const playerOffers of subOffers) offerGroups.push(...playerOffers);
    }
  }

  // Build players keyed by eventId. DK returns each offer with an
  // eventId and a "label" like "Aaron Judge" (name only for HR props).
  // Outcomes include { label: "Yes"/"No", oddsAmerican, line? }.
  const byEvent = {};
  for (const off of offerGroups) {
    if (!off?.eventId) continue;
    const playerName = normName(off.label || off.playerName);
    if (!playerName) continue;
    const yes = (off.outcomes || []).find(o => /yes|over/i.test(o.label || ""));
    if (!yes) continue;
    const american = Number(yes.oddsAmerican);
    if (!Number.isFinite(american)) continue;
    if (!byEvent[off.eventId]) byEvent[off.eventId] = {};
    byEvent[off.eventId][playerName] = {
      book: "DraftKings",
      point: 0.5,
      overAmerican: american,
      overDecimal: +americanToDecimal(american).toFixed(3),
    };
  }

  return events
    .map(e => ({
      ...e,
      players: Object.entries(byEvent[e.eventId] || {}).map(([name, price]) => ({
        name, books: [price],
      })),
    }))
    .filter(e => e.players.length > 0);
}

// ────────────────────────────────────────────────────────────────────
// FanDuel
// ────────────────────────────────────────────────────────────────────
// FanDuel's public sportsbook reads from the same sbapi the mobile app
// uses. The content-managed-page endpoint returns MLB events with their
// event IDs; per-event we hit event-page which includes all markets
// (we filter to "To Hit A Home Run"). FanDuel uses sub-domains per
// state — "nj" is used here as a read-only odds source.
async function scrapeFanDuel() {
  const base = "https://sbapi.nj.sportsbook.fanduel.com/api";
  const mlbPage = await jfetch(
    `${base}/content-managed-page?page=CUSTOM&customPageId=mlb&pbHsa=false&pbHorizontal=false&_ak=FhMFpcPWXMeyZxOx`
  );

  const events = Object.values(mlbPage?.attachments?.events || {}).map(e => ({
    eventId: e.eventId,
    home: e.name?.split(" @ ")?.[1] || null,
    away: e.name?.split(" @ ")?.[0] || null,
    commence: e.openDate,
    name: e.name,
  })).filter(e => e.eventId);

  const out = [];
  // Limit concurrent event-page calls so we don't blow through the
  // function's CPU budget; 4 at a time is enough for ~15 events.
  const chunk = 4;
  for (let i = 0; i < events.length; i += chunk) {
    const batch = events.slice(i, i + chunk);
    const results = await Promise.allSettled(batch.map(async ev => {
      const page = await jfetch(
        `${base}/event-page?eventId=${ev.eventId}&tab=popular&useCombinedTouchdownsVirtualMarket=true&useCombinedPointsVirtualMarket=true&_ak=FhMFpcPWXMeyZxOx`
      );
      const markets = page?.attachments?.markets || {};
      const byPlayer = {};
      for (const m of Object.values(markets)) {
        if (!/home.?run/i.test(m.marketName || "")) continue;
        // "To Hit A Home Run" has one market per player (or one market
        // with many runners). Handle both shapes.
        for (const r of (m.runners || [])) {
          const yes = r.winRunnerOdds?.americanDisplayOdds?.americanOdds
            ?? r.winRunnerOdds?.americanOdds
            ?? null;
          const playerName = normName(r.runnerName);
          const isYes = /yes|over/i.test(r.handicap || r.runnerName || "");
          const marketTargetsPlayer = /^to\s*hit/i.test(m.marketName || "");
          if (!playerName) continue;
          if (!marketTargetsPlayer && !isYes) continue;
          const american = Number(yes);
          if (!Number.isFinite(american)) continue;
          byPlayer[playerName] = {
            book: "FanDuel",
            point: 0.5,
            overAmerican: american,
            overDecimal: +americanToDecimal(american).toFixed(3),
          };
        }
      }
      return {
        ...ev,
        players: Object.entries(byPlayer).map(([name, price]) => ({
          name, books: [price],
        })),
      };
    }));
    for (const r of results) {
      if (r.status === "fulfilled" && r.value.players.length > 0) out.push(r.value);
    }
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────
// Public entrypoint
// ────────────────────────────────────────────────────────────────────
// DK was dropped from the scraper on 2026-04-19 — their Nash API is
// Akamai-blocked from Vercel's serverless IP range, and The Odds API
// already returns DraftKings HR lines under `batter_home_runs`, so the
// scraper was redundant when it worked and an alert source when it
// didn't. FanDuel stays: Odds API coverage for FD HR props is spottier.
// If DK HR coverage regresses, re-introduce via a proxy (Cloudflare
// Worker on a residential/non-cloud ASN).
export async function fetchScrapedHr() {
  const [fd] = await Promise.allSettled([scrapeFanDuel()]);
  return {
    draftkings: { ok: true, events: [], eventCount: 0, skipped: "covered by Odds API" },
    fanduel: fd.status === "fulfilled"
      ? { ok: true, events: fd.value, eventCount: fd.value.length }
      : { ok: false, error: fd.reason?.message || String(fd.reason), events: [] },
  };
}

// Merge a scraper's event list into an existing players-by-event map.
// We match scraped events to the main feed by normalized team names
// (home/away either order). When a player already has entries from
// other books, we append — when they don't, we add them as a new player.
//
// Collision guard: if the main event already has ≥2 players sharing the
// same normalized name (two "Luis Garcia"s on opposite sides of the same
// game), the scraped prop is ambiguous since the scraper doesn't emit
// team info per player. We skip those rather than risk crediting the
// wrong person's HR line.
export function mergeScrapedIntoEvents(events, scraped, bookName) {
  const normTeam = (s) => (s || "")
    .toLowerCase().replace(/\./g, "")
    .replace(/\s+/g, " ").trim();
  const playerKey = (s) => (s || "")
    .toLowerCase().replace(/[.'`]/g, "")
    .replace(/\s+/g, " ").trim();

  let attached = 0, skippedAmbiguous = 0;
  for (const scEv of (scraped.events || [])) {
    const h = normTeam(scEv.home);
    const a = normTeam(scEv.away);
    if (!h || !a) continue;
    const target = events.find(e =>
      (normTeam(e.home) === h && normTeam(e.away) === a) ||
      (normTeam(e.home) === a && normTeam(e.away) === h)
    );
    if (!target) continue;

    // Precompute name→candidate-count on the target so we can detect
    // ambiguities without rescanning the whole players array per merge.
    const nameCounts = {};
    for (const p of target.players) {
      const k = playerKey(p.name);
      nameCounts[k] = (nameCounts[k] || 0) + 1;
    }

    for (const scP of scEv.players) {
      const priceRow = scP.books[0];
      if (!priceRow) continue;
      const k = playerKey(scP.name);
      if (nameCounts[k] > 1) {
        // Two players with the same normalized name already present in
        // this event's player list. We can't disambiguate without team
        // info on the scraped side.
        skippedAmbiguous++;
        continue;
      }
      const existing = target.players.find(p => playerKey(p.name) === k);
      if (existing) {
        if (!existing.books.some(b => b.book === bookName)) {
          existing.books.push(priceRow);
          attached++;
        }
      } else {
        target.players.push({ name: scP.name, books: [priceRow] });
        nameCounts[k] = (nameCounts[k] || 0) + 1;
        attached++;
      }
    }
  }
  return { attached, skippedAmbiguous };
}
