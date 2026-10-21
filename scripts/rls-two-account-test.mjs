#!/usr/bin/env node
// Two-account RLS test, the scripted version of
// https://milokits.com/guides/test-supabase-rls-two-accounts
//
// It signs in as test user A and test user B with the PUBLIC anon/publishable key (exactly what a
// visitor's browser has), creates data as A, then tries to read, change and plant data as B and as a
// logged-out visitor. Every step prints PASS or FAIL. Exit code 1 if anything fails.
//
// Only run this against your own project, with test accounts you created. It cleans up after itself.
import { createClient } from "@supabase/supabase-js";

try { process.loadEnvFile?.(".env"); } catch { /* no .env file: use the real environment */ }

const URL_ = process.env.VITE_SUPABASE_URL;
const KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const A = { email: process.env.TEST_USER_A_EMAIL, password: process.env.TEST_USER_A_PASSWORD };
const B = { email: process.env.TEST_USER_B_EMAIL, password: process.env.TEST_USER_B_PASSWORD };

export function keyRole(key) {
  if (!key) return null;
  if (key.startsWith("sb_secret_")) return "secret";
  if (key.startsWith("sb_publishable_")) return "publishable";
  try { return JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString("utf8")).role || null; } catch { return null; }
}

const results = [];
function record(step, ok, detail) {
  results.push({ step, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${step}${detail ? `  (${detail})` : ""}`);
}
const client = () => createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
async function signIn(user, label) {
  const c = client();
  const { data, error } = await c.auth.signInWithPassword(user);
  if (error) throw new Error(`Couldn't sign in as test user ${label}: ${error.message}. Create it in Authentication > Users (Auto confirm).`);
  return { c, id: data.user.id };
}
const deniedOrEmpty = (r) => !!r.error || (Array.isArray(r.data) && r.data.length === 0);

export async function main() {
  if (!URL_ || !KEY) { console.error("Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (in .env or the environment)."); return 2; }
  const role = keyRole(KEY);
  if (role === "service_role" || role === "secret") {
    console.error("This is a secret/service_role key. It bypasses RLS, so the test would prove nothing. Use the anon or publishable key.");
    return 2;
  }
  if (!A.email || !A.password || !B.email || !B.password) { console.error("Set TEST_USER_A_EMAIL/PASSWORD and TEST_USER_B_EMAIL/PASSWORD."); return 2; }
  if (A.email === B.email) { console.error("Users A and B must be two different accounts."); return 2; }

  const a = await signIn(A, "A");
  const b = await signIn(B, "B");
  const anon = client();
  console.log(`Testing ${new URL(URL_).host} with test users A and B\n`);

  // Step 1: create data as A
  const created = await a.c.from("notes").insert({ title: "RLS test note from A" }).select("id, user_id").single();
  record("A can create a note", !created.error && created.data?.user_id === a.id, created.error?.message);
  if (created.error) return finish();
  const noteId = created.data.id;
  const own = await a.c.from("notes").select("id").eq("id", noteId);
  record("A can read their own note", !own.error && own.data.length === 1, own.error?.message || (own.data?.length === 0 ? "policy missing?" : ""));

  // Step 2: read A's data as B
  const byId = await b.c.from("notes").select("*").eq("id", noteId);
  record("B can't read A's note by id", deniedOrEmpty(byId), byId.data?.length ? "B got A's row" : "");
  const all = await b.c.from("notes").select("id, user_id");
  record("B's unfiltered select returns only B's rows", !all.error && all.data.every((r) => r.user_id === b.id), all.error?.message || `${all.data.filter((r) => r.user_id !== b.id).length} foreign rows`);
  const prof = await b.c.from("profiles").select("*").eq("id", a.id);
  record("B can't read A's profile", deniedOrEmpty(prof), prof.data?.length ? "B got A's profile" : "");

  // Step 3: change A's data as B
  const upd = await b.c.from("notes").update({ title: "changed by B" }).eq("id", noteId).select("id");
  record("B can't update A's note", deniedOrEmpty(upd), upd.data?.length ? "row was changed" : "");
  const del = await b.c.from("notes").delete().eq("id", noteId).select("id");
  record("B can't delete A's note", deniedOrEmpty(del), del.data?.length ? "row was deleted" : "");
  const plant = await b.c.from("notes").insert({ user_id: a.id, title: "planted by B" }).select("id");
  record("B can't create a note owned by A", !!plant.error, plant.error ? "" : "insert policy is missing WITH CHECK (auth.uid() = user_id)");
  if (!plant.error && plant.data?.[0]) await a.c.from("notes").delete().eq("id", plant.data[0].id);
  const steal = await b.c.from("notes").update({ user_id: b.id }).eq("id", noteId).select("id");
  record("B can't take over A's note", deniedOrEmpty(steal), steal.data?.length ? "ownership changed" : "");

  // Step 4: logged out
  const anonSel = await anon.from("notes").select("*");
  record("Logged-out visitor can't read notes", deniedOrEmpty(anonSel), anonSel.data?.length ? `${anonSel.data.length} rows visible` : "");
  const anonIns = await anon.from("notes").insert({ title: "anon" }).select("id");
  record("Logged-out visitor can't create notes", !!anonIns.error, anonIns.error ? "" : "anon insert worked");

  // Step 6: storage
  const path = `${a.id}/rls-test-${Date.now()}.txt`;
  const up = await a.c.storage.from("user-files").upload(path, new Blob(["rls test"], { type: "text/plain" }));
  if (up.error) {
    record("A can upload to their own folder", false, up.error.message);
  } else {
    record("A can upload to their own folder", true);
    const dl = await b.c.storage.from("user-files").download(path);
    record("B can't download A's file", !!dl.error, dl.error ? "" : "B downloaded it");
    const plantFile = await b.c.storage.from("user-files").upload(`${a.id}/planted-${Date.now()}.txt`, new Blob(["x"]));
    record("B can't upload into A's folder", !!plantFile.error, plantFile.error ? "" : "upload worked");
    const anonDl = await anon.storage.from("user-files").download(path);
    record("Logged-out visitor can't download A's file", !!anonDl.error, anonDl.error ? "" : "download worked");
    await a.c.storage.from("user-files").remove([path]);
  }

  // A still owns an unchanged note; clean up.
  const after = await a.c.from("notes").select("title, user_id").eq("id", noteId).single();
  record("A's note is unchanged at the end", !after.error && after.data.title === "RLS test note from A" && after.data.user_id === a.id, after.error?.message);
  await a.c.from("notes").delete().eq("id", noteId);
  return finish();
}

function finish() {
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed${failed ? `, ${failed} FAILED. See the fix prompt in README.md.` : "."}`);
  return failed ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((c) => { process.exitCode = c; }).catch((e) => { console.error(e.message); process.exitCode = 2; });
}
