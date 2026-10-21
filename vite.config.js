import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// Anything starting with VITE_ ends up in the public JavaScript bundle.
// This guard stops the build if a server-only key was given a VITE_ name by mistake.
function assertNoSecretsInFrontend(env) {
  const problems = [];
  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith("VITE_")) continue;
    if (/SERVICE_ROLE|SECRET|PRIVATE/i.test(name)) problems.push(`${name}: the name says it's a server-only secret`);
    const v = String(value || "");
    if (v.startsWith("sb_secret_")) problems.push(`${name}: this is a Supabase secret key`);
    if (/^(sk|rk)_live_/.test(v)) problems.push(`${name}: this is a Stripe secret key`);
    if (/^sk-(proj|svcacct|admin|ant)-/.test(v)) problems.push(`${name}: this looks like an AI provider secret key`);
    const parts = v.split(".");
    if (parts.length === 3 && v.startsWith("eyJ")) {
      try {
        const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
        if (payload.role === "service_role") problems.push(`${name}: this is the Supabase service_role key (it bypasses RLS)`);
      } catch { /* not a JWT */ }
    }
  }
  if (problems.length) {
    throw new Error(
      "Refusing to build: a secret would be shipped to every visitor.\n  - " + problems.join("\n  - ") +
      "\nKeep server-only keys in Supabase Edge Function secrets or your host's server-side env vars, without the VITE_ prefix."
    );
  }
}

export default defineConfig(({ mode }) => {
  assertNoSecretsInFrontend(loadEnv(mode, process.cwd(), "VITE_"));
  return {
    plugins: [react()],
    build: { sourcemap: false }, // don't publish your original source code
  };
});
