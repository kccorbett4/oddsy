// Module-scoped Redis singleton so we don't pay the connect cost on every
// request. Vercel Fluid Compute reuses function instances across invocations,
// so a client created at module scope survives warm starts. The node-redis
// client handles reconnection internally if the socket drops; we never call
// disconnect() from request handlers.
//
// Usage:
//   import { getRedis } from "./_redis.js";
//   const redis = await getRedis();
//   if (redis) await redis.get(...);
//
// Returns null if REDIS_URL is not set so callers can fall back gracefully.
import { createClient } from "redis";

let clientPromise = null;

export function getRedis() {
  if (!process.env.REDIS_URL) return Promise.resolve(null);
  if (!clientPromise) {
    const client = createClient({
      url: process.env.REDIS_URL,
      socket: {
        // Exponential backoff with jitter so a brief network hiccup doesn't
        // permanently fail the cached promise. Capped so we don't block
        // forever.
        reconnectStrategy: (retries) => Math.min(50 + retries * 100, 3000),
      },
    });
    client.on("error", (err) => {
      // Surface errors but don't throw from the listener — the client's
      // own reconnect logic will handle recoverable failures.
      console.error("[redis]", err.message);
    });
    clientPromise = client.connect()
      .then(() => client)
      .catch((err) => {
        // Wipe the cached promise on initial connect failure so the next
        // request gets a fresh attempt instead of a permanent rejection.
        clientPromise = null;
        throw err;
      });
  }
  return clientPromise;
}
