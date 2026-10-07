-- Daily allowance for the AI assistant: each member can send a limited number of messages per
-- day (UTC), so the site's Gemini bill stays bounded. Run once in the SQL Editor.
-- The limit lives here, not in the request, so a member cannot raise it.
create table public.assistant_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  count integer not null default 0 check (count >= 0),
  primary key (user_id, day)
);
alter table public.assistant_usage enable row level security;
revoke all on table public.assistant_usage from public, anon, authenticated;

-- Counts one message for the caller. Returns the messages left today, or -1 when the limit is reached.
create function public.use_assistant_message()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  daily_limit constant integer := 30;
  used integer;
begin
  if caller_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  insert into public.assistant_usage as u (user_id, day, count)
  values (caller_id, (now() at time zone 'utc')::date, 1)
  on conflict (user_id, day) do update set count = u.count + 1 where u.count < daily_limit
  returning count into used;
  if used is null then
    return -1;
  end if;
  return daily_limit - used;
end;
$$;
revoke all on function public.use_assistant_message() from public, anon, authenticated;
grant execute on function public.use_assistant_message() to authenticated;
