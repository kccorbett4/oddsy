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
  // Route through a Cloudflare Worker proxy (workers/dk-proxy/) since DK's
  // Nash API is Akamai-blocked from Vercel serverless IPs. The worker
  // forwards /proxy/<path> → https://sportsbook-nash.draftkings.com/<path>.
  const proxy = process.env.DK_PROXY_URL;
  if (!proxy) throw new Error("DK_PROXY_URL not configured");
  const p = proxy.replace(/\/$/, "");
  const v2 = `${p}/proxy/api/v2/dkusnj`;
  const v1 = `${p}/proxy/api/sportscontent/dkusnj/v1`;
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

  // FanDuel event names include the probable pitcher in parens, e.g.
  // "Atlanta Braves (G Holmes) @ Philadelphia Phillies (A Painter)".
  // We strip the trailing "(...)" so the team name matches the Odds API
  // shape ("Atlanta Braves") in mergeScrapedIntoEvents.
  const stripPitcher = (s) => (s || "").replace(/\s*\([^)]*\)\s*$/, "").trim();
  const events = Object.values(mlbPage?.attachments?.events || {}).map(e => {
    const parts = (e.name || "").split(" @ ");
    return {
      eventId: e.eventId,
      away: stripPitcher(parts[0]) || null,
      home: stripPitcher(parts[1]) || null,
      commence: e.openDate,
      name: e.name,
    };
  }).filter(e => e.eventId);

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
// Bovada
// ────────────────────────────────────────────────────────────────────
// Bovada IS carried by The Odds API for main markets (moneyline, spread,
// total) — that's why it already shows up on the Shop/Arbitrage/Picks
// feeds. But The Odds API doesn't return Bovada's `batter_home_runs`
// market on our plan tier, so HR props were the one gap. This scraper
// hits Bovada's public coupon endpoint to fill just that gap. Flow:
//   1. GET /services/sports/event/coupon/events/A/description/baseball/mlb
//      → array of events, each with a { link, description } slug.
//   2. GET /services/sports/event/coupon/events/A/description{link}
//      → the full event with displayGroups[].markets[], where
//      description === "Player to hit a Home Run" is the anytime-HR market
//      ("Player to hit 2+ Home Runs" and "the first Home Run" are
//      separate markets we skip).
// Outcome descriptions are "Player Name (TEAM)" — we strip the team tag
// so name matching against Odds-API events works.
async function scrapeBovada() {
  const base = "https://www.bovada.lv/services/sports/event/coupon/events/A/description";
  // KNOWN BUG (2026-04-19): per-event detail calls to
  //   ${base}/baseball/mlb/<slug>?lang=en
  // now return an empty array `[]` even with full browser headers. The listing
  // still returns all 8 MLB games with game-lines markets, but HR props only
  // appear in the per-event detail response — which upstream has either moved
  // or been geofenced. Until we identify the new detail endpoint (inspect
  // DevTools on bovada.lv while loading a game page), HR props from Bovada
  // will be missing. The scraper still runs so it picks up any events whose
  // detail does resolve, and degrades gracefully when none do.
  const listUrl = `${base}/baseball/mlb?eventsLimit=50&lang=en`;
  const list = await jfetch(listUrl);

  // Bovada wraps responses in an array of groups; walk everything and
  // collect anything with an `events` array into `target`.
  const collectEvents = (node, target) => {
    if (!node) return;
    if (Array.isArray(node)) { node.forEach(n => collectEvents(n, target)); return; }
    if (Array.isArray(node.events)) target.push(...node.events);
    if (Array.isArray(node.path)) node.path.forEach(n => collectEvents(n, target));
  };
  const rawEvents = [];
  collectEvents(list, rawEvents);

  const seen = new Set();
  const uniqEvents = rawEvents.filter(e => {
    if (!e?.link || !e?.description) return false;
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });

  const out = [];
  const chunk = 4;
  for (let i = 0; i < uniqEvents.length; i += chunk) {
    const batch = uniqEvents.slice(i, i + chunk);
    const results = await Promise.allSettled(batch.map(async ev => {
      const detail = await jfetch(`${base}${ev.link}?lang=en`);
      const detailEvents = [];
      collectEvents(detail, detailEvents);

      const byPlayer = {};
      // Walk the returned event(s); typically one, but handle multi.
      for (const det of detailEvents) {
        for (const dg of (det.displayGroups || [])) {
          for (const m of (dg.markets || [])) {
            const desc = (m.description || "").trim().toLowerCase();
            if (desc !== "player to hit a home run") continue;
            for (const o of (m.outcomes || [])) {
              const priceStr = (o.price?.american || "").toString().toUpperCase();
              const americanRaw = priceStr === "EVEN" ? 100 : parseInt(priceStr, 10);
              if (!Number.isFinite(americanRaw)) continue;
              // Strip " (TEAM)" suffix — e.g. "Aaron Judge (NYY)" → "Aaron Judge"
              const name = (o.description || "").replace(/\s*\([A-Z0-9]{2,4}\)\s*$/, "").trim();
              if (!name) continue;
              byPlayer[name] = {
                book: "Bovada",
                point: 0.5,
                overAmerican: americanRaw,
                overDecimal: +americanToDecimal(americanRaw).toFixed(3),
              };
            }
          }
        }
      }

      // Bovada event descriptions are "Away @ Home".
      const [away, home] = (ev.description || "").split(" @ ").map(s => (s || "").trim());
      return {
        eventId: ev.id,
        home, away,
        commence: ev.startTime,
        name: ev.description,
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
// DK Nash API is Akamai-blocked from Vercel serverless IPs, and our Odds
// API plan doesn't include DK for `batter_home_runs`. Re-enabled via a
// Cloudflare Worker proxy (workers/dk-proxy/) — scraper runs only when
// DK_PROXY_URL is set. Without the env var, DK is marked "skipped" and
// the rest of the stack continues. FanDuel and Bovada scrape direct
// because neither is IP-blocked from Vercel.
export async function fetchScrapedHr() {
  const dkEnabled = !!process.env.DK_PROXY_URL;
  const [dk, fd, bv] = await Promise.allSettled([
    dkEnabled ? scrapeDraftKings() : Promise.resolve(null),
    scrapeFanDuel(),
    scrapeBovada(),
  ]);
  return {
    draftkings: dkEnabled
      ? (dk.status === "fulfilled"
          ? { ok: true, events: dk.value || [], eventCount: (dk.value || []).length }
          : { ok: false, error: dk.reason?.message || String(dk.reason), events: [] })
      : { ok: true, events: [], eventCount: 0, skipped: "DK_PROXY_URL not set — deploy workers/dk-proxy and set env var to enable" },
    fanduel: fd.status === "fulfilled"
      ? { ok: true, events: fd.value, eventCount: fd.value.length }
      : { ok: false, error: fd.reason?.message || String(fd.reason), events: [] },
    bovada: bv.status === "fulfilled"
      ? { ok: true, events: bv.value, eventCount: bv.value.length }
      : { ok: false, error: bv.reason?.message || String(bv.reason), events: [] },
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
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
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
