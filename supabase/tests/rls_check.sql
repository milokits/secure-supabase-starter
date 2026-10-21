-- 1) Every table in the public schema must have RLS enabled. Expect 0 rows.
select n.nspname as schema, c.relname as table_without_rls
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity;

-- 2) Tables with RLS on but no policies (nobody, not even the owner, can use them). Review these.
select c.relname as table_with_rls_but_no_policy
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relrowsecurity
  and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname);

-- 3) Policies that let everyone in (using (true)). Review these.
select tablename, policyname, cmd, roles
from pg_policies
where schemaname = 'public' and (qual = 'true' or with_check = 'true');

-- 4) Views that don't run with the caller's rights (they can skip RLS). Expect 0 rows.
select c.relname as view_without_security_invoker
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'v'
  and not coalesce(c.reloptions::text[] @> array['security_invoker=true'], false)
  and not coalesce(c.reloptions::text[] @> array['security_invoker=on'], false);
