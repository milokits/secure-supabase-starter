// Offline tests for the starter's guards (npm test). The live RLS test is `npm run test:rls`.
import test from "node:test";
import assert from "node:assert";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { scanText, checkDir } from "./check-bundle.mjs";
import { keyRole } from "./rls-two-account-test.mjs";

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (role) => `${b64({ alg: "HS256" })}.${b64({ iss: "supabase", role })}.${"s".repeat(43)}`;

test("bundle check flags service_role but not anon", () => {
  assert.strictEqual(scanText(`a="${jwt("anon")}"`).length, 0);
  assert.strictEqual(scanText(`a="${jwt("service" + "_role")}"`).length, 1);
  assert.strictEqual(scanText("k='" + "sb_" + "secret_" + "x".repeat(30) + "'").length, 1);
});

test("bundle check flags public source maps", () => {
  const d = mkdtempSync(join(tmpdir(), "starter-"));
  mkdirSync(join(d, "assets"));
  writeFileSync(join(d, "assets", "index.js"), "console.log(1)");
  assert.deepStrictEqual(checkDir(d), []);
  writeFileSync(join(d, "assets", "index.js.map"), "{}");
  assert.strictEqual(checkDir(d).length, 1);
});

test("RLS test refuses secret keys", () => {
  assert.strictEqual(keyRole(jwt("service" + "_role")), "service_role");
  assert.strictEqual(keyRole("sb_" + "secret_abc"), "secret");
  assert.strictEqual(keyRole(jwt("anon")), "anon");
  assert.strictEqual(keyRole("sb_publishable_abc"), "publishable");
});

test("vite build refuses a service_role key in a VITE_ variable", () => {
  const env = { ...process.env, VITE_SUPABASE_URL: "https://x.supabase.co", VITE_SUPABASE_ANON_KEY: jwt("service" + "_role") };
  const out = join(mkdtempSync(join(tmpdir(), "starter-build-")), "dist");
  let stderr = "";
  try { execFileSync(process.execPath, ["node_modules/vite/bin/vite.js", "build", "--outDir", out], { env, stdio: "pipe" }); }
  catch (e) { stderr = String(e.stderr) + String(e.stdout); }
  assert.match(stderr, /Refusing to build/);
  assert.match(stderr, /service_role/);
});
