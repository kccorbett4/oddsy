// Cloudflare Worker: proxies DraftKings Nash API requests so Vercel's
// serverless IP range (Akamai-blocked) can reach DK.
//
// Deploy:
//   cd workers/dk-proxy
//   npx wrangler deploy
// Then set DK_PROXY_URL in Vercel env to the deployed URL
// (e.g. https://oddsy-dk-proxy.<your-subdomain>.workers.dev).
//
// Request shape:
//   <worker>/proxy/api/v2/dkusnj/leagues/84240/categories
//     → https://sportsbook-nash.draftkings.com/api/v2/dkusnj/leagues/84240/categories
//
// Tightly scoped: only DK Nash paths under MLB (leagues/84240) are allowed,
// so this isn't a general-purpose open proxy.

const ALLOWED_PATH_RE = /^\/api\/(v2\/dkusnj|sportscontent\/dkusnj\/v1)\/leagues\/84240\b/;

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/" || url.pathname === "/health") {
      return new Response("oddsy-dk-proxy OK\n", { status: 200 });
    }
    if (!url.pathname.startsWith("/proxy/")) {
      return new Response("Not found", { status: 404 });
    }
    const dkPath = url.pathname.slice("/proxy".length);
    if (!ALLOWED_PATH_RE.test(dkPath)) {
      return new Response("Path not allowed", { status: 403 });
    }
    const dkUrl = `https://sportsbook-nash.draftkings.com${dkPath}${url.search}`;
    const upstream = await fetch(dkUrl, {
      headers: {
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
        "accept": "application/json, text/plain, */*",
        "accept-language": "en-US,en;q=0.9",
      },
      cf: { cacheTtl: 60, cacheEverything: true },
    });
    const body = await upstream.arrayBuffer();
    return new Response(body, {
      status: upstream.status,
      headers: {
        "content-type": upstream.headers.get("content-type") || "application/json",
        "cache-control": "public, max-age=60",
      },
    });
  },
};
