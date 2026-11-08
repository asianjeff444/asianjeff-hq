-- The app's storage. Supabase → SQL Editor → New query → paste this whole file → Run.
-- Run it AFTER making your login (Authentication → Users → Add user), because the last line lets that login in.
-- Safe to run again any time (nothing gets deleted).

-- 1) Who may use the app: only logins on this list (your login is added by the last line)
create table if not exists public.app_users (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  added_at timestamptz not null default now()
);
alter table public.app_users enable row level security;   -- no rules on purpose: nobody can read or change the list from the app

create or replace function public.is_app_user() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.app_users where user_id = auth.uid());
$$;
grant execute on function public.is_app_user() to authenticated;

-- 2) One table holds every document: tiles, ideas, to-dos, Instagram numbers…
create table if not exists public.docs (
  path        text primary key,          -- e.g. "todos/m1abc"
  parent      text not null,             -- its collection, e.g. "todos"
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);
create index if not exists docs_parent_idx on public.docs (parent);
alter table public.docs replica identity full;
alter table public.docs enable row level security;
drop policy if exists "app users only" on public.docs;
create policy "app users only" on public.docs
  for all to authenticated using (public.is_app_user()) with check (public.is_app_user());
-- newer Supabase projects don't open new tables to the app by default: say who may reach this one (the rule above still decides which rows)
grant select, insert, update, delete on public.docs to authenticated;
grant select, insert, update, delete on public.docs to service_role;

-- live updates (a change on one device shows on the other right away)
do $$ begin
  alter publication supabase_realtime add table public.docs;
exception when duplicate_object then null; end $$;

-- 3) Private photo storage (Instagram covers, profile picture)
insert into storage.buckets (id, name, public) values ('assets', 'assets', false)
on conflict (id) do nothing;
drop policy if exists "app assets: app users only" on storage.objects;
create policy "app assets: app users only" on storage.objects
  for all to authenticated
  using (bucket_id = 'assets' and public.is_app_user())
  with check (bucket_id = 'assets' and public.is_app_user());

-- 4) The Instagram key (only the refresh job can read it, with the secret key; the app never sees it)
create table if not exists public.ig_link (
  id int primary key default 1 check (id = 1),
  token text, seed text, host text, ig_id text, username text, kind text,
  refreshed_at timestamptz, expires_at timestamptz, err text, err_at timestamptz,
  updated_at timestamptz default now()
);
alter table public.ig_link enable row level security;      -- no rules on purpose: invisible to the app
grant select, insert, update, delete on public.ig_link to service_role;   -- the refresh job (secret key) only
revoke all on public.ig_link from anon, authenticated;
revoke all on public.app_users from anon, authenticated;

-- 5) Let your login in (everyone in Authentication → Users right now: just you)
insert into public.app_users (user_id) select id from auth.users on conflict do nothing;
