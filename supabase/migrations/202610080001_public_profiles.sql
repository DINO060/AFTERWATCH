-- Public profiles: the username other members will see in the community. Run once in the
-- SQL Editor. Only the username is public; the e-mail and the private display name stay in
-- Supabase Auth. Rules match lib/username.ts.
create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique check (
    username ~ '^[a-z0-9][a-z0-9._]{1,18}[a-z0-9]$' and username !~ '[._]{2}'
  ),
  username_changed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
revoke all on table public.profiles from public, anon, authenticated;
-- Signed-in members can read usernames (to show who wrote what), nothing else.
grant select (user_id, username) on table public.profiles to authenticated;
create policy "Members read usernames" on public.profiles for select to authenticated using (true);

create function public.username_is_reserved(p_username text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_username in (
    'aide', 'api', 'bot', 'contact', 'equipe', 'help', 'null', 'officiel', 'official', 'root',
    'staff', 'support', 'system', 'team', 'undefined'
  ) or p_username ~ '^(afterwatch|admin|modo|moder)';
$$;
revoke all on function public.username_is_reserved(text) from public, anon, authenticated;

-- Chooses or changes the caller's username: at most one change a day, so names stay recognizable.
create function public.set_username(p_username text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  clean text := lower(btrim(coalesce(p_username, '')));
  current_name text;
  changed_at timestamptz;
begin
  if caller_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if clean !~ '^[a-z0-9][a-z0-9._]{1,18}[a-z0-9]$' or clean ~ '[._]{2}' then
    raise exception 'invalid_username' using errcode = '22023';
  end if;
  if public.username_is_reserved(clean) then
    raise exception 'reserved_username' using errcode = '22023';
  end if;
  select username, username_changed_at into current_name, changed_at
  from public.profiles where user_id = caller_id;
  if current_name = clean then
    return clean;
  end if;
  if current_name is not null and changed_at > now() - interval '1 day' then
    raise exception 'username_too_soon' using errcode = 'P0001';
  end if;
  begin
    insert into public.profiles as p (user_id, username)
    values (caller_id, clean)
    on conflict (user_id) do update set username = excluded.username, username_changed_at = now();
  exception when unique_violation then
    raise exception 'username_taken' using errcode = '23505';
  end;
  return clean;
end;
$$;
revoke all on function public.set_username(text) from public, anon, authenticated;
grant execute on function public.set_username(text) to authenticated;

-- Whether a username could be taken by the caller (valid, not reserved, free or already theirs).
create function public.username_available(p_username text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and lower(btrim(coalesce(p_username, ''))) ~ '^[a-z0-9][a-z0-9._]{1,18}[a-z0-9]$'
    and lower(btrim(coalesce(p_username, ''))) !~ '[._]{2}'
    and not public.username_is_reserved(lower(btrim(coalesce(p_username, ''))))
    and not exists (
      select 1 from public.profiles
      where username = lower(btrim(coalesce(p_username, ''))) and user_id <> auth.uid()
    );
$$;
revoke all on function public.username_available(text) from public, anon, authenticated;
grant execute on function public.username_available(text) to authenticated;

-- "Télécharger mes données" includes the assistant's daily counters, read by the server role.
grant select on table public.assistant_usage to service_role;
