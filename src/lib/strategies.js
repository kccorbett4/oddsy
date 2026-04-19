import { supabase, isAuthConfigured } from "./supabase";

// Strategies are stored in Supabase when the user is signed in. The `config`
// JSONB column holds the whole strategy object; the row's `id` is the
// canonical strategy id used as `custom_<id>` in Redis stats keys.

export async function fetchStrategies() {
  if (!isAuthConfigured()) return [];
  const { data, error } = await supabase
    .from("strategies")
    .select("id, name, config, created_at")
    .order("created_at", { ascending: true });
  if (error) {
    console.error("fetchStrategies", error);
    return [];
  }
  return (data || []).map(row => ({
    ...(row.config || {}),
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
  }));
}

export async function saveStrategy(strategy) {
  if (!isAuthConfigured()) throw new Error("Auth not configured");
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) throw new Error("Not signed in");

  const { id, name, createdAt, ...config } = strategy;
  const payload = {
    user_id: user.id,
    name: name || "My Strategy",
    config,
  };

  // If strategy has an id that looks like a UUID, update; otherwise insert.
  const isUuid = typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id);
  if (isUuid) {
    const { data, error } = await supabase
      .from("strategies")
      .update(payload)
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return { ...(data.config || {}), id: data.id, name: data.name, createdAt: data.created_at };
  }
  const { data, error } = await supabase
    .from("strategies")
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return { ...(data.config || {}), id: data.id, name: data.name, createdAt: data.created_at };
}

export async function deleteStrategy(id) {
  if (!isAuthConfigured()) throw new Error("Auth not configured");
  const { error } = await supabase.from("strategies").delete().eq("id", id);
  if (error) throw error;
}
