-- Secure Supabase Starter: initial schema.
-- Rule in plain English: "every signed-in user can only see and change their own rows;
-- logged-out visitors can't see anything."
-- Every table gets RLS enabled in the same migration that creates it, plus one policy per action.

-- =========================================================
-- profiles: one row per user, created automatically on sign-up
-- =========================================================
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) <= 80),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles: users can read their own profile"
  on public.profiles for select to authenticated
  using ((select auth.uid()) = id);

create policy "profiles: users can update their own profile"
  on public.profiles for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);
-- No insert policy: rows are created by the trigger below. No delete policy: deleting the
-- auth user deletes the profile (on delete cascade).

-- Create the profile when a user signs up.
-- security definer runs with the owner's rights, so keep it tiny and pin the search_path.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =========================================================
-- notes: example user-owned data. Copy this block for every new table.
-- =========================================================
create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  body text check (char_length(body) <= 10000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists notes_user_id_idx on public.notes (user_id);

alter table public.notes enable row level security;

create policy "notes: users can read their own notes"
  on public.notes for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "notes: users can create notes for themselves"
  on public.notes for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "notes: users can update their own notes"
  on public.notes for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "notes: users can delete their own notes"
  on public.notes for delete to authenticated
  using ((select auth.uid()) = user_id);

-- Logged-out visitors (the anon role) get no access at all, even before RLS is checked.
revoke all on table public.profiles, public.notes from anon;

-- =========================================================
-- Storage: a private bucket where each user can only touch files under "<their user id>/..."
-- =========================================================
insert into storage.buckets (id, name, public)
values ('user-files', 'user-files', false)
on conflict (id) do nothing;

create policy "user-files: users can read their own files"
  on storage.objects for select to authenticated
  using (bucket_id = 'user-files' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "user-files: users can upload into their own folder"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'user-files' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "user-files: users can update their own files"
  on storage.objects for update to authenticated
  using (bucket_id = 'user-files' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'user-files' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "user-files: users can delete their own files"
  on storage.objects for delete to authenticated
  using (bucket_id = 'user-files' and (storage.foldername(name))[1] = (select auth.uid())::text);
