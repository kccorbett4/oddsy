// Cron: scans every user's custom strategies where notifyMode != "off",
// evaluates them against the current odds feed, dedupes new matches via
// Redis (notify_sent:<user_id>:<strategy_id>:<pickKey>, 7-day TTL), and
// emails the user via Resend. Skips cleanly if RESEND_API_KEY is missing.
import { createClient as createRedis } from "redis";
import { createClient as createSupabase } from "@supabase/supabase-js";

// Inline strategy evaluator — mirrors the one in src/StrategyBuilder.jsx.
// Kept here (rather than imported) because the client file pulls in React.
const impliedProb = (odds) => (odds > 0 ? 100 / (odds + 100) : Math.abs(odds) / (Math.abs(odds) + 100));
const calcEV = (odds, p) => {
  const payout = odds > 0 ? odds / 100 : 100 / Math.abs(odds);
  return (p * payout - (1 - p)) * 100;
};
const median = (a) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const ctxKey = (g) => {
  const d = g.commence_time ? new Date(g.commence_time).toISOString().slice(0, 10) : "";
  return `${g.sport_key}:${g.away_team}@${g.home_team}:${d}`;
};

// Mirror of normalizeGameCtxFilters in StrategyBuilder.jsx — migrates older
// strategies that stored one-way exclude flags into the new tri-state mode shape.
function normalizeCtx(s) {
  const o = { ...s };
  if (o.windMode === undefined) { o.windMode = (o.maxWindMph || 0) > 0 ? "skip" : "off"; o.windMphThreshold = o.windMphThreshold ?? (o.maxWindMph || 15); }
  if (o.tempMode === undefined) { o.tempMode = (o.minTempF || 0) > 0 ? "skip" : "off"; o.tempFThreshold = o.tempFThreshold ?? (o.minTempF || 32); }
  if (o.precipMode === undefined) o.precipMode = o.excludeWetGames ? "skip" : "off";
  if (o.restMode === undefined) { o.restMode = (o.minRestDays || 0) > 0 ? "skip" : "off"; o.restDaysThreshold = o.restDaysThreshold ?? (o.minRestDays || 2); }
  if (o.winPctMode === undefined) { o.winPctMode = (o.minTeamWinPct || 0) > 0 ? "skip" : "off"; o.teamWinPctThreshold = o.teamWinPctThreshold ?? (o.minTeamWinPct || 60); }
  if (o.fpiMode === undefined) { o.fpiMode = (o.minFpiEdge || 0) > 0 ? "skip" : "off"; o.fpiEdgeThreshold = o.fpiEdgeThreshold ?? (o.minFpiEdge || 3); }
  if (o.injuryMode === undefined) o.injuryMode = o.excludeKeyInjuries ? "skip" : "off";
  return o;
}

const gateFails = (mode, cond) => {
  if (mode === "skip") return cond;
  if (mode === "only") return !cond;
  return false;
};

function evaluateStrategy(strategy, games, contextMap = null) {
  if (!games?.length) return [];
  strategy = normalizeCtx(strategy);
  const out = [];
  const now = Date.now();
  const cutoff = now + (strategy.hoursWindow || 48) * 3600 * 1000;
  const minTipMs = now + (strategy.minHoursUntilTip || 0) * 3600 * 1000;
  const bookFilter = (strategy.books || []).length > 0 ? new Set(strategy.books) : null;
  const daysFilter = (strategy.daysOfWeek && strategy.daysOfWeek.length > 0) ? new Set(strategy.daysOfWeek) : null;
  const maxVig = typeof strategy.maxVigPct === "number" ? strategy.maxVigPct / 100 : 0.25;

  for (const game of games) {
    if (!strategy.sports.includes(game.sport_key)) continue;
    const commenceMs = new Date(game.commence_time).getTime();
    if (!Number.isFinite(commenceMs) || commenceMs < now || commenceMs < minTipMs || commenceMs > cutoff) continue;
    const d = new Date(commenceMs);
    const dow = d.getDay(); const hour = d.getHours();
    if (daysFilter && !daysFilter.has(dow)) continue;
    const isDaytime = hour >= 6 && hour < 17;
    const isPrimetime = hour >= 17 && hour < 23;
    const isLateNight = hour >= 23 || hour < 6;
    if (strategy.timeOfDay === "daytime" && !isDaytime) continue;
    if (strategy.timeOfDay === "primetime" && !isPrimetime) continue;
    if (strategy.timeOfDay === "latenight" && !isLateNight) continue;
    if (strategy.excludePrimetime && isPrimetime) continue;

    const ctx = contextMap ? contextMap[ctxKey(game)] : null;
    const needsCtx = strategy.windMode !== "off" || strategy.tempMode !== "off"
      || strategy.precipMode !== "off" || strategy.restMode !== "off"
      || strategy.injuryMode !== "off";
    if (needsCtx && !ctx) continue;
    if (ctx) {
      const w = ctx.weather;
      const outdoorCheckable = w && ctx.outdoor;
      if (strategy.windMode !== "off") {
        if (!outdoorCheckable) continue;
        const cond = typeof w.windMph === "number" && w.windMph >= strategy.windMphThreshold;
        if (gateFails(strategy.windMode, cond)) continue;
      }
      if (strategy.tempMode !== "off") {
        if (!outdoorCheckable) continue;
        const cond = typeof w.tempF === "number" && w.tempF < strategy.tempFThreshold;
        if (gateFails(strategy.tempMode, cond)) continue;
      }
      if (strategy.precipMode !== "off") {
        if (!outdoorCheckable) continue;
        const cond = typeof w.precipProb === "number" && w.precipProb >= 50;
        if (gateFails(strategy.precipMode, cond)) continue;
      }
      if (strategy.restMode !== "off") {
        const hr = ctx.homeRestDays, ar = ctx.awayRestDays;
        if (hr == null || ar == null) continue;
        const cond = hr >= strategy.restDaysThreshold && ar >= strategy.restDaysThreshold;
        if (gateFails(strategy.restMode, cond)) continue;
      }
      if (strategy.injuryMode !== "off") {
        const anyOut = (list) => Array.isArray(list) && list.some(p => p.status === "Out" || p.status === "Injured Reserve");
        const cond = anyOut(ctx.homeInjuries) || anyOut(ctx.awayInjuries);
        if (gateFails(strategy.injuryMode, cond)) continue;
      }
    }

    for (const marketType of strategy.markets) {
      const perOutcomeFair = {};
      const perOutcomeOffers = {};
      for (const book of (game.bookmakers || [])) {
        const market = (book.markets || []).find(m => m.key === marketType);
        if (!market || !market.outcomes || market.outcomes.length !== 2) continue;
        const [o1, o2] = market.outcomes;
        const p1 = impliedProb(o1.price), p2 = impliedProb(o2.price);
        const sum = p1 + p2;
        if (!(sum > 1.0 && sum < 1.25)) continue;
        const bookVig = sum - 1;
        for (const [o, fair] of [[o1, p1 / sum], [o2, p2 / sum]]) {
          const key = `${o.name}_${o.point || ""}`;
          (perOutcomeFair[key] ||= []).push(fair);
          (perOutcomeOffers[key] ||= []).push({ ...o, book: book.title, bookVig });
        }
      }
      for (const [key, outcomes] of Object.entries(perOutcomeOffers)) {
        if (outcomes.length < strategy.minBooks) continue;
        const fairProbs = perOutcomeFair[key];
        if (!fairProbs || fairProbs.length < strategy.minBooks) continue;
        const vigFreeProb = median(fairProbs);
        let disagreement = 0;
        if (marketType === "spreads" || marketType === "totals") {
          const pts = outcomes.map(o => typeof o.point === "number" ? o.point : null).filter(p => p !== null);
          if (pts.length >= 2) disagreement = Math.max(...pts) - Math.min(...pts);
        } else {
          const probs = outcomes.map(o => impliedProb(o.price));
          if (probs.length >= 2) disagreement = (Math.max(...probs) - Math.min(...probs)) * 100;
        }
        if (disagreement < (strategy.minBookDisagreement || 0)) continue;

        for (const outcome of outcomes) {
          if (bookFilter && !bookFilter.has(outcome.book)) continue;
          if (outcome.price < strategy.minOdds || outcome.price > strategy.maxOdds) continue;
          if (outcome.bookVig > maxVig) continue;
          if (strategy.side === "fav" && outcome.price >= 0) continue;
          if (strategy.side === "dog" && outcome.price <= 0) continue;
          if (marketType === "h2h" || marketType === "spreads") {
            const isHome = outcome.name === game.home_team;
            if (strategy.location === "home" && !isHome) continue;
            if (strategy.location === "away" && isHome) continue;

            if (strategy.winPctMode !== "off") {
              if (!ctx) continue;
              const teamRec = isHome ? ctx.homeRecord : ctx.awayRecord;
              if (!teamRec || typeof teamRec.winPct !== "number") continue;
              const cond = teamRec.winPct * 100 >= strategy.teamWinPctThreshold;
              if (gateFails(strategy.winPctMode, cond)) continue;
            }
            if (strategy.fpiMode !== "off") {
              if (!ctx) continue;
              const teamFPI = isHome ? ctx.homeFPI : ctx.awayFPI;
              const oppFPI = isHome ? ctx.awayFPI : ctx.homeFPI;
              if (typeof teamFPI !== "number" || typeof oppFPI !== "number") continue;
              const cond = teamFPI - oppFPI >= strategy.fpiEdgeThreshold;
              if (gateFails(strategy.fpiMode, cond)) continue;
            }
          } else if (strategy.winPctMode !== "off" || strategy.fpiMode !== "off") {
            continue;
          }
          if (marketType === "totals" && typeof outcome.point === "number") {
            if (outcome.point < (strategy.totalMin ?? 0) || outcome.point > (strategy.totalMax ?? 9999)) continue;
          }
          if (marketType === "spreads" && typeof outcome.point === "number") {
            const abs = Math.abs(outcome.point);
            if (abs < (strategy.spreadMin ?? 0) || abs > (strategy.spreadMax ?? 9999)) continue;
          }
          const ev = calcEV(outcome.price, vigFreeProb);
          if (ev < strategy.minEv) continue;
          out.push({
            gameId: game.id,
            home: game.home_team, away: game.away_team,
            sportKey: game.sport_key, commence: game.commence_time,
            marketType, outcome: outcome.name, point: outcome.point,
            odds: outcome.price, book: outcome.book, ev: ev.toFixed(1),
          });
        }
      }
    }
  }
  out.sort((a, b) => parseFloat(b.ev) - parseFloat(a.ev));
  const seen = new Set(), dedup = [];
  for (const p of out) {
    const k = `${p.gameId}_${p.marketType}_${p.outcome}_${p.point || ""}`;
    if (seen.has(k)) continue;
    seen.add(k); dedup.push(p);
  }
  return dedup.slice(0, strategy.maxPicksPerDay || 10);
}

const fmtOdds = (n) => (n > 0 ? `+${n}` : `${n}`);
const pickKey = (p) => `${p.gameId}:${p.marketType}:${p.outcome}:${p.point ?? ""}`;

function renderEmail(strategyName, picks, siteUrl) {
  const rows = picks.map(p => {
    const ptStr = p.point !== null && p.point !== undefined
      ? (p.point > 0 ? ` +${p.point}` : ` ${p.point}`) : "";
    const marketLabel = p.marketType === "h2h" ? "ML" : p.marketType === "spreads" ? "Spread" : "Total";
    const when = new Date(p.commence).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    return `
      <tr>
        <td style="padding:10px 12px;border-bottom:1px solid #e2e5ea;">
          <div style="font-weight:700;color:#1a1d23;">${p.outcome}${ptStr}</div>
          <div style="font-size:12px;color:#6b7280;">${p.away} @ ${p.home} · ${when}</div>
          <div style="font-size:11px;color:#8b919a;margin-top:2px;">${marketLabel} · ${p.book}</div>
        </td>
        <td style="padding:10px 12px;border-bottom:1px solid #e2e5ea;text-align:right;white-space:nowrap;">
          <div style="font-weight:800;font-family:monospace;color:${p.odds > 0 ? "#0d9f4f" : "#1a1d23"};">${fmtOdds(p.odds)}</div>
          <div style="font-size:11px;color:#0d9f4f;font-weight:700;">+${p.ev}% EV</div>
        </td>
      </tr>`;
  }).join("");
  return `<!doctype html><html><body style="margin:0;background:#f5f6f8;font-family:system-ui,'DM Sans',sans-serif;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="padding:24px 12px;">
      <tr><td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.05);">
          <tr><td style="padding:20px 24px 8px;">
            <div style="font-size:11px;font-weight:700;color:#7c3aed;letter-spacing:0.12em;text-transform:uppercase;">⚙️ Oddsy Strategy Alert</div>
            <div style="font-size:20px;font-weight:900;color:#1a1d23;margin-top:4px;">${picks.length} new pick${picks.length === 1 ? "" : "s"} for "${strategyName}"</div>
          </td></tr>
          <tr><td>
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%">${rows}</table>
          </td></tr>
          <tr><td style="padding:16px 24px 22px;text-align:center;">
            <a href="${siteUrl}" style="display:inline-block;padding:10px 18px;background:#1a73e8;color:#fff;border-radius:10px;font-weight:700;text-decoration:none;font-size:13px;">Open MyOddsy →</a>
          </td></tr>
          <tr><td style="padding:0 24px 24px;font-size:11px;color:#8b919a;line-height:1.6;text-align:center;">
            You're receiving this because email alerts are on for this strategy. Edit it in the Strategy Builder to turn alerts off.
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body></html>`;
}

async function fetchGames(baseUrl) {
  const r = await fetch(`${baseUrl}/api/odds`);
  if (!r.ok) throw new Error(`odds fetch ${r.status}`);
  const j = await r.json();
  return j.games || [];
}

async function fetchGameContext(baseUrl) {
  try {
    const r = await fetch(`${baseUrl}/api/game-context`);
    if (!r.ok) return null;
    const j = await r.json();
    return j?.games || null;
  } catch {
    return null;
  }
}

async function sendEmail({ to, subject, html }) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.NOTIFY_FROM || "Oddsy Alerts <onboarding@resend.dev>";
  if (!key) return { skipped: true, reason: "RESEND_API_KEY not set" };
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ from, to, subject, html }),
  });
  if (!r.ok) throw new Error(`resend ${r.status}: ${await r.text()}`);
  return { sent: true };
}

export default async function handler(req, res) {
  let redis;
  try {
    const supaUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supaUrl || !supaKey) return res.status(200).json({ skipped: true, reason: "Supabase service creds not configured" });
    if (!process.env.REDIS_URL) return res.status(200).json({ skipped: true, reason: "REDIS_URL not configured" });

    const supabase = createSupabase(supaUrl, supaKey, { auth: { persistSession: false } });

    const { data: rows, error } = await supabase
      .from("strategies")
      .select("id, user_id, name, config");
    if (error) throw error;
    const active = (rows || []).filter(r => r.config && r.config.notifyMode && r.config.notifyMode !== "off");
    if (active.length === 0) return res.status(200).json({ ok: true, strategies: 0 });

    const siteUrl = process.env.SITE_URL || "https://myoddsy.com";
    const [games, contextMap] = await Promise.all([
      fetchGames(siteUrl),
      fetchGameContext(siteUrl),
    ]);

    redis = createRedis({ url: process.env.REDIS_URL });
    await redis.connect();

    const emailed = [];
    for (const row of active) {
      const strategy = { id: row.id, name: row.name, ...(row.config || {}) };
      const picks = evaluateStrategy(strategy, games, contextMap);
      if (picks.length === 0) continue;

      // Dedupe per strategy — don't re-email picks we've already sent
      const newPicks = [];
      for (const p of picks) {
        const k = `notify_sent:${row.user_id}:${row.id}:${pickKey(p)}`;
        const seen = await redis.get(k);
        if (seen) continue;
        await redis.set(k, "1", { EX: 7 * 86400 });
        newPicks.push(p);
      }
      if (newPicks.length === 0) continue;

      // Resolve user email via Supabase admin
      const { data: userData } = await supabase.auth.admin.getUserById(row.user_id);
      const to = userData?.user?.email;
      if (!to) continue;

      const subject = `[Oddsy] ${newPicks.length} new pick${newPicks.length === 1 ? "" : "s"}: ${strategy.name}`;
      const html = renderEmail(strategy.name, newPicks, siteUrl);
      const result = await sendEmail({ to, subject, html });
      emailed.push({ strategy: strategy.name, to, picks: newPicks.length, ...result });
    }

    return res.status(200).json({ ok: true, strategies: active.length, emailed });
  } catch (err) {
    console.error("notify-picks error", err);
    return res.status(500).json({ error: err.message });
  } finally {
    if (redis) await redis.disconnect().catch(() => {});
  }
}
