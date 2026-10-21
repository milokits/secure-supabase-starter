# Secure Supabase Starter

A minimal **Vite + React + Supabase** starter where the safe choices are already made. Use it as a starting point in Lovable, Bolt or Cursor, or just copy the parts you need into your app.

- **RLS on every table**, in the same migration that creates it, with one per-user policy for each action (select, insert, update, delete) and a `WITH CHECK` on writes.
- **Logged-out visitors get nothing:** the `anon` role has no table access.
- **A private storage bucket** where each user can only touch files in their own folder.
- **A two-account RLS test** (`npm run test:rls`) that signs in as two test users with the public key and tries to read, change and plant each other's data, exactly like the [step-by-step guide](https://milokits.com/guides/test-supabase-rls-two-accounts).
- **Security headers** for Netlify, Cloudflare Pages (`public/_headers`) and Vercel (`vercel.json`): CSP, HSTS, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy.
- **Secret keys can't reach the browser:** the build stops if a `service_role` or `sb_secret_` key is given a `VITE_` name, and a post-build check scans `dist/` for secret keys and source maps.

MIT licensed. Made by [Milo Kits](https://milokits.com).

## Quick start

1. Create a Supabase project.
2. Run the migration: paste `supabase/migrations/20261021000000_init.sql` into **SQL Editor** and run it, or use the Supabase CLI: `supabase db push`.
3. Copy `.env.example` to `.env` and fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (Project Settings → API). The anon or publishable key is meant to be public; RLS is what protects your data.
4. `npm install` and `npm run dev`.

Deploy to Netlify, Cloudflare Pages or Vercel as a static site: build command `npm run build`, output folder `dist`. The headers come along automatically.

## Keys: what goes where

| Key | Where it goes | Why |
|---|---|---|
| Project URL | `VITE_SUPABASE_URL` (frontend) | Public |
| anon / publishable key (`sb_publishable_…`) | `VITE_SUPABASE_ANON_KEY` (frontend) | Public by design; RLS decides what it can do |
| service_role / secret key (`sb_secret_…`) | **Never in the frontend.** Supabase Edge Function secrets or your host's server-side env vars | It skips RLS completely |
| Stripe, OpenAI, Resend and other API keys | Edge Function secrets / server-side env vars | Anyone can read your frontend JavaScript |

Anything with a `VITE_` prefix is bundled into the JavaScript every visitor downloads. `vite.config.js` refuses to build if a secret-looking key has that prefix.

## Test your RLS with two accounts

1. In Supabase, go to **Authentication → Users → Add user** and create two **test** users (tick "Auto confirm"). Use email addresses you control.
2. Put their emails and passwords in `.env` (`TEST_USER_A_*`, `TEST_USER_B_*`). These have no `VITE_` prefix, so they never reach the frontend.
3. Run `npm run test:rls`.

```
PASS  A can create a note
PASS  A can read their own note
PASS  B can't read A's note by id
PASS  B's unfiltered select returns only B's rows
PASS  B can't read A's profile
PASS  B can't update A's note
PASS  B can't delete A's note
PASS  B can't create a note owned by A
PASS  B can't take over A's note
PASS  Logged-out visitor can't read notes
PASS  Logged-out visitor can't create notes
PASS  A can upload to their own folder
PASS  B can't download A's file
PASS  B can't upload into A's folder
PASS  Logged-out visitor can't download A's file
PASS  A's note is unchanged at the end
```

The test uses the public key only (it refuses to run with a secret key, which would skip RLS and prove nothing) and deletes the data it creates.

More ways to check:

- `supabase/tests/rls_check.sql`: run in the SQL editor. Lists tables without RLS, tables with RLS but no policies, `using (true)` policies and views that can skip RLS. You want every query to return 0 rows.
- `supabase/tests/rls_impersonation.sql`: the SQL-editor way to act as user B or a logged-out visitor inside a transaction that's rolled back.
- `npm run test:sql`: runs the migration and the same two-account checks offline in PGlite (Postgres in WebAssembly), no Supabase project needed.
- `npm test`: checks the build guard and the bundle scanner.

## Adding a table

Copy the `notes` block in the migration: `user_id uuid not null default auth.uid()`, `enable row level security`, four policies using `(select auth.uid()) = user_id`, and `revoke all … from anon`. Then add your table to `scripts/rls-two-account-test.mjs` and run it again.

## Prompts for Lovable and Bolt

Paste these into your AI builder. Each one asks it to show you the change first.

**Start a new app from this starter**

```
Use the structure of the "secure-supabase-starter" project: Vite + React + Supabase, with the
migration in supabase/migrations. Keep these rules for everything you build:
1) Every new table gets "alter table ... enable row level security" in the same migration,
   a user_id uuid not null default auth.uid() column, and four policies (select, insert, update,
   delete) for the authenticated role using (select auth.uid()) = user_id, with WITH CHECK on
   insert and update.
2) Revoke all on every new table from anon unless I say a table is public.
3) Only the Supabase URL and the anon/publishable key go in the frontend. Any other key goes in a
   Supabase Edge Function secret. Never put a service_role or sb_secret_ key in VITE_ variables.
4) Show me the SQL before running it.
```

**Add a new feature safely**

```
Add [FEATURE]. For any new table, follow the same pattern as the notes table in
supabase/migrations: RLS on, user_id defaulting to auth.uid(), one policy per action limited to
the owner, WITH CHECK on writes, and no anon access. If the feature needs a secret API key,
put the call in a Supabase Edge Function and keep the key in function secrets.
Then update scripts/rls-two-account-test.mjs so user B tries to read and change user A's rows
in the new table. Show me the SQL and the test before running anything.
```

**Check an existing app against this starter**

```
Compare my Supabase setup with the secure-supabase-starter rules:
1) list every table in the public schema and whether RLS is enabled,
2) show each table's policies in plain English ("users can only see their own orders"),
3) flag any policy using (true), any table without policies, any view without
   security_invoker = true, and any security definer function that doesn't check auth.uid(),
4) search the frontend code and env files for service_role, sb_secret_, sk_live_ or other
   secret keys.
Give me the fixes as SQL plus a two-account test for each. Don't run anything until I say so.
```

**Add the security headers**

```
Add security headers to my site. Copy public/_headers from the secure-supabase-starter (or the
headers section of vercel.json if I'm on Vercel). Add every external domain my app really uses
to the Content-Security-Policy (API, analytics, fonts, images, payments). Show me the final
headers, then tell me how to check them in the browser's Network tab.
```

## Check the live site

Once it's deployed, run the free, open-source [Launch Check](https://github.com/milokits/launch-check-action) against your own URL, or use the instant check on [milokits.com](https://milokits.com/?utm_source=secure-supabase-starter&utm_medium=readme). For a person to look at the public side of your live app, get the [free mini-check](https://milokits.com/?utm_source=secure-supabase-starter&utm_medium=readme#free): your top 3 issues by email, each with a fix prompt.

## Disclaimer

This starter makes common mistakes harder, but it isn't a security guarantee and isn't a substitute for reviewing and testing your own app. Re-run the two-account test after every schema change.

## License

MIT © Milo Kits · hello@milokits.com
