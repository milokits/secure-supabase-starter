import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
// Use the anon key or the newer publishable key (sb_publishable_...). Both are meant to be public:
// your data is protected by Row Level Security, not by hiding this key.
const key = import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  throw new Error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Copy .env.example to .env and fill them in.");
}
if (key.startsWith("sb_secret_") || roleOf(key) === "service_role") {
  // Never ship a key that bypasses RLS to the browser.
  throw new Error("The frontend was given a Supabase SECRET/service_role key. Use the anon or publishable key instead, and rotate the secret key now.");
}

function roleOf(jwt) {
  try {
    return JSON.parse(atob(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).role;
  } catch {
    return null;
  }
}

export const supabase = createClient(url, key);
