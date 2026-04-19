// Shared helper: extract and verify a Supabase JWT from the Authorization
// header. Returns the user id, or null if no token / invalid.
import { createClient } from "@supabase/supabase-js";

let cachedClient = null;
function getSupabase() {
  if (cachedClient) return cachedClient;
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  cachedClient = createClient(url, key);
  return cachedClient;
}

export async function getUserIdFromRequest(req) {
  try {
    const auth = req.headers?.authorization || req.headers?.Authorization;
    if (!auth || !auth.startsWith("Bearer ")) return null;
    const token = auth.slice(7);
    const supabase = getSupabase();
    if (!supabase) return null;
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) return null;
    return data.user.id;
  } catch {
    return null;
  }
}

// Redis-key helper. Custom strategy stats are per-user when a userId is
// present; built-in strategies (and anonymous custom fallback) stay global.
export function statsKey(strategy, userId) {
  if (userId && typeof strategy === "string" && strategy.startsWith("custom_")) {
    return `user:${userId}:stats:${strategy}`;
  }
  return `stats:${strategy}`;
}
