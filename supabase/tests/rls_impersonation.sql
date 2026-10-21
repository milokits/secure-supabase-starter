-- Two-account test in the Supabase SQL editor (Step 5 of the guide at
-- https://milokits.com/guides/test-supabase-rls-two-accounts).
-- The SQL editor normally bypasses RLS, so impersonate each user inside a transaction and roll back.
-- Replace USER_A_UUID and USER_B_UUID with ids from Authentication > Users.

-- As user B: try to read user A's notes. Expect 0 rows.
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub": "USER_B_UUID", "role": "authenticated"}';
select * from public.notes where user_id = 'USER_A_UUID';
rollback;

-- As user B: try to change user A's notes. Expect "UPDATE 0".
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub": "USER_B_UUID", "role": "authenticated"}';
update public.notes set title = 'changed by B' where user_id = 'USER_A_UUID';
rollback;

-- As user B: try to create a note that belongs to user A. Expect an RLS error.
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub": "USER_B_UUID", "role": "authenticated"}';
insert into public.notes (user_id, title) values ('USER_A_UUID', 'planted by B');
rollback;

-- Logged out: expect a permission error (anon has no access to the table at all).
begin;
set local role anon;
select * from public.notes;
rollback;
