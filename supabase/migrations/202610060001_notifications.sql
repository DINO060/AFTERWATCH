-- Notifications: member preferences, phone (web push) subscriptions, and server-only
-- bookkeeping (what was sent, catalog id mappings, last run). Run once in the SQL Editor.
-- The scheduled call that triggers sending is set up separately (see DEPLOYMENT.md):
-- it needs a secret that must not live in this repository.

-- ---------- Preferences: each member reads and edits only their own row ----------
create table public.notification_prefs (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email_reminders boolean not null default false,
  email_new_episodes boolean not null default false,
  email_weekly boolean not null default false,
  push_reminders boolean not null default false,
  push_new_episodes boolean not null default false,
  lang text not null default 'fr' check (lang in ('fr', 'en')),
  -- Lets an e-mail's unsubscribe link work without signing in; never chosen by the client.
  unsubscribe_token uuid not null default gen_random_uuid() unique,
  updated_at timestamptz not null default now()
);
alter table public.notification_prefs enable row level security;
revoke all on table public.notification_prefs from public, anon, authenticated;
grant select on table public.notification_prefs to authenticated;
grant insert (user_id, email_reminders, email_new_episodes, email_weekly, push_reminders, push_new_episodes, lang)
  on table public.notification_prefs to authenticated;
grant update (email_reminders, email_new_episodes, email_weekly, push_reminders, push_new_episodes, lang, updated_at)
  on table public.notification_prefs to authenticated;
create policy "Read own notification prefs" on public.notification_prefs
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Create own notification prefs" on public.notification_prefs
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Update own notification prefs" on public.notification_prefs
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- ---------- Phone subscriptions (web push) ----------
-- Endpoints are limited to the browsers' push services: the server posts to them.
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique check (
    length(endpoint) <= 1000
    and endpoint ~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)/'
  ),
  p256dh text not null check (length(p256dh) between 20 and 200),
  auth text not null check (length(auth) between 8 and 100),
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
revoke all on table public.push_subscriptions from public, anon, authenticated;
grant select, delete on table public.push_subscriptions to authenticated;
create policy "Read own push subscriptions" on public.push_subscriptions
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Delete own push subscriptions" on public.push_subscriptions
  for delete to authenticated using ((select auth.uid()) = user_id);

-- A browser's endpoint belongs to whoever is signed in on it now: replace any older owner.
create function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
begin
  if caller_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  delete from public.push_subscriptions where endpoint = p_endpoint;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
  values (caller_id, p_endpoint, p_p256dh, p_auth);
end;
$$;
revoke all on function public.save_push_subscription(text, text, text) from public, anon, authenticated;
grant execute on function public.save_push_subscription(text, text, text) to authenticated;

-- ---------- Server-only bookkeeping (no client access) ----------
create table public.notification_log (
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('reminder', 'episode', 'weekly')),
  ref text not null check (length(ref) <= 200),
  channel text not null check (channel in ('email', 'push')),
  sent_at timestamptz not null default now(),
  primary key (user_id, kind, ref, channel)
);
create index notification_log_sent_at on public.notification_log (sent_at);
alter table public.notification_log enable row level security;
revoke all on table public.notification_log from public, anon, authenticated;

create table public.catalog_links (
  kitsu_id text primary key check (kitsu_id ~ '^[0-9]{1,9}$'),
  mal_id integer,
  checked_at timestamptz not null default now()
);
alter table public.catalog_links enable row level security;
revoke all on table public.catalog_links from public, anon, authenticated;

create table public.cron_state (
  name text primary key,
  last_run_at timestamptz not null
);
alter table public.cron_state enable row level security;
revoke all on table public.cron_state from public, anon, authenticated;
