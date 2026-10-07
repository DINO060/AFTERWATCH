-- Lowers the assistant's daily allowance to 10 messages per member while the site is free.
-- Run once after 202610070002_assistant_usage.sql; change daily_limit here to adjust it later.
create or replace function public.use_assistant_message()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  daily_limit constant integer := 10;
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
