// Offline self-test of the migration: runs it in PGlite (Postgres in WebAssembly) with a tiny
// stand-in for Supabase's auth and storage schemas, then repeats the two-account checks in SQL.
// npm run test:sql  (no Supabase project needed). The real test against your project is npm run test:rls.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const db = new PGlite();
const q = (s, p) => db.query(s, p);
const ex = (s) => db.exec(s);
// --- minimal Supabase-like environment
await ex(`
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth; create schema storage;
create table auth.users (id uuid primary key default gen_random_uuid(), email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claims', true)::json->>'sub','')::uuid $$;
grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
create table storage.buckets (id text primary key, name text, public boolean);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text, owner uuid);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1] $$;
grant usage on schema storage to anon, authenticated; grant all on storage.objects to anon, authenticated; grant select on storage.buckets to anon, authenticated;
grant execute on function storage.foldername(text) to anon, authenticated;
grant usage on schema public to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
`);
await ex(readFileSync("supabase/migrations/20261021000000_init.sql", "utf8"));
console.log("migration applied");
const A = (await q(`insert into auth.users(email) values ('a@test') returning id`)).rows[0].id;
const B = (await q(`insert into auth.users(email) values ('b@test') returning id`)).rows[0].id;
const prof = (await q(`select count(*)::int n from public.profiles`)).rows[0].n;
const res = [];
const check = (name, ok) => { res.push(ok); console.log((ok ? "PASS " : "FAIL ") + name); };
check("profile trigger created 2 profiles", prof === 2);
async function as(role, uid, fn) {
  await ex("begin");
  try {
    await ex(`set local role ${role}`);
    if (uid) await q(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, role })]);
    return await fn();
  } catch (e) { return { error: e.message }; }
  finally { await ex("rollback"); }
}
async function asCommit(role, uid, fn) {
  await ex("begin");
  try { await ex(`set local role ${role}`); if (uid) await q(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, role })]); const r = await fn(); await ex("commit"); return r; }
  catch (e) { await ex("rollback"); return { error: e.message }; }
}
const note = await asCommit("authenticated", A, () => q(`insert into public.notes(title) values ('A note') returning id, user_id`));
check("A creates note, user_id defaults to A", note.rows && note.rows[0].user_id === A);
const id = note.rows[0].id;
check("A reads own note", (await as("authenticated", A, () => q(`select * from public.notes where id=$1`, [id]))).rows.length === 1);
check("B can't read A's note", (await as("authenticated", B, () => q(`select * from public.notes where id=$1`, [id]))).rows.length === 0);
check("B select-all sees none of A's", (await as("authenticated", B, () => q(`select * from public.notes`))).rows.length === 0);
check("B can't read A's profile", (await as("authenticated", B, () => q(`select * from public.profiles where id=$1`, [A]))).rows.length === 0);
check("A reads own profile", (await as("authenticated", A, () => q(`select * from public.profiles where id=$1`, [A]))).rows.length === 1);
check("B update A's note changes 0 rows", (await as("authenticated", B, () => q(`update public.notes set title='x' where id=$1`, [id]))).affectedRows === 0);
check("B delete A's note changes 0 rows", (await as("authenticated", B, () => q(`delete from public.notes where id=$1`, [id]))).affectedRows === 0);
check("B can't insert note owned by A", !!(await as("authenticated", B, () => q(`insert into public.notes(user_id,title) values ($1,'planted')`, [A]))).error);
check("A can't move own note to B", !!(await as("authenticated", A, () => q(`update public.notes set user_id=$2 where id=$1`, [id, B]))).error);
check("anon select denied", /permission denied/.test((await as("anon", null, () => q(`select * from public.notes`))).error || ""));
check("anon insert denied", /permission denied/.test((await as("anon", null, () => q(`insert into public.notes(title) values ('x')`))).error || ""));
check("anon profiles denied", /permission denied/.test((await as("anon", null, () => q(`select * from public.profiles`))).error || ""));
check("authenticated can't call handle_new_user", !!(await as("authenticated", A, () => q(`select public.handle_new_user()`))).error);
// storage
check("A uploads into own folder", !(await asCommit("authenticated", A, () => q(`insert into storage.objects(bucket_id,name) values ('user-files', $1)`, [A + "/f.txt"]))).error);
check("B can't see A's file", (await as("authenticated", B, () => q(`select * from storage.objects where name=$1`, [A + "/f.txt"]))).rows.length === 0);
check("B can't upload into A's folder", !!(await as("authenticated", B, () => q(`insert into storage.objects(bucket_id,name) values ('user-files', $1)`, [A + "/x.txt"]))).error);
check("A sees own file", (await as("authenticated", A, () => q(`select * from storage.objects where name=$1`, [A + "/f.txt"]))).rows.length === 1);
// rls_check.sql: no tables without RLS
const chk = await db.exec(readFileSync("supabase/tests/rls_check.sql", "utf8"));
check("rls_check.sql: 0 tables without RLS", chk[0].rows.length === 0);
check("rls_check.sql: 0 tables with RLS but no policy", chk[1].rows.length === 0);
check("rls_check.sql: 0 using(true) policies", chk[2].rows.length === 0);
console.log(`\n${res.filter(Boolean).length}/${res.length} passed`);
process.exitCode = res.every(Boolean) ? 0 : 1;
