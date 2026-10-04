-- Run after the migration, as the database owner, against a test database:
-- psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/watch_states.sql
-- No pgTAP extension is required. Assertions and fixtures are rolled back.
begin;

insert into auth.users (id) values
  ('a110a110-0000-4000-8000-000000000001'),
  ('a110a110-0000-4000-8000-000000000002');

set local role anon;
do $$
declare
  valid_state jsonb := '{"media":[],"sessions":[],"settings":{"budget":60,"time":"21:00","days":[0,1,2,3,4,5,6],"reminders":true,"timezone":"America/New_York"}}'::jsonb;
begin
  begin
    perform 1 from public.watch_states;
    raise exception 'Anonymous reads must be denied';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.watch_states (user_id, data) values
      ('a110a110-0000-4000-8000-000000000001', valid_state);
    raise exception 'Anonymous inserts must be denied';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.watch_states set data = valid_state;
    raise exception 'Anonymous updates must be denied';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.watch_states;
    raise exception 'Anonymous deletes must be denied';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.save_watch_state(valid_state, 0);
    raise exception 'Anonymous RPC execution must be denied';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

select set_config('request.jwt.claim.sub', 'a110a110-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"a110a110-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
do $$
declare
  valid_state jsonb := '{"media":[],"sessions":[],"settings":{"budget":60,"time":"21:00","days":[0,1,2,3,4,5,6],"reminders":true,"timezone":"America/New_York"}}'::jsonb;
  updated_state jsonb := '{"media":[{"id":"b220b220-0000-4000-8000-000000000001","title":"Example series","kind":"series","priority":false,"status":"watching","progress":0,"total":10,"duration":30,"poster":"https://image.tmdb.org/t/p/w500/test.jpg","sourceUrl":"https://www.imdb.com/title/tt123","notes":"","catalog":{"source":"cinemeta","id":"tt123","synopsis":"Test synopsis","genres":["Drama"],"year":"2026","score":8.5,"episodes":10,"chapters":null,"volumes":null,"seasons":1,"available":10,"releaseStatus":"Finished","format":"TV","durationKnown":true}}],"sessions":[{"id":"c330c330-0000-4000-8000-000000000001","mediaId":"b220b220-0000-4000-8000-000000000001","date":"2026-10-05","time":"21:00","from":1,"to":2,"duration":60,"done":false}],"settings":{"budget":90,"time":"21:00","days":[0,1,2,3,4,5,6],"reminders":true,"timezone":"America/New_York"}}'::jsonb;
  invalid_state jsonb;
begin
  if public.save_watch_state(valid_state, 5) is not null then
    raise exception 'A nonzero revision must not create a collection';
  end if;
  if public.save_watch_state(valid_state, 0) is distinct from 1::bigint then
    raise exception 'First save must return revision 1';
  end if;
  if public.save_watch_state(jsonb_set(valid_state, '{settings,budget}', '30'), 0) is not null then
    raise exception 'A duplicate initial save must conflict';
  end if;
  -- JSON Schema integers also include integral decimal representations (10.0).
  if public.save_watch_state(jsonb_set(updated_state, '{media,0,total}', '10.0'), 1) is distinct from 2::bigint then
    raise exception 'Matching update must increment the revision once';
  end if;
  if public.save_watch_state(valid_state, 1) is not null then
    raise exception 'Stale update must conflict';
  end if;
  if (select count(*) from public.watch_states) <> 1 then
    raise exception 'The owner must read the collection';
  end if;
  if not exists (select 1 from public.watch_states where revision = 2 and data = updated_state) then
    raise exception 'Conflicting saves must leave content and revision unchanged';
  end if;

  -- Direct own-row writes are denied too: all changes must pass the RPC.
  begin
    insert into public.watch_states (user_id, data) values
      ('a110a110-0000-4000-8000-000000000001', valid_state);
    raise exception 'Direct own-row inserts must be denied';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.watch_states set data = valid_state
      where user_id = 'a110a110-0000-4000-8000-000000000001';
    raise exception 'Direct own-row updates must be denied';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.watch_states (user_id, data) values
      ('a110a110-0000-4000-8000-000000000002', valid_state);
    raise exception 'Writing another user collection must be denied';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.watch_states set user_id = 'a110a110-0000-4000-8000-000000000002';
    raise exception 'Moving a collection to another user must be denied';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.watch_states;
    raise exception 'Client deletion must be denied';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.is_valid_watch_state(valid_state);
    raise exception 'The database validation helper must not be exposed as an RPC';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.save_watch_state(valid_state, -1);
    raise exception 'Negative revision must be denied';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.save_watch_state(valid_state, 9007199254740992);
    raise exception 'Unsafe integer revision must be denied';
  exception when invalid_parameter_value then null;
  end;

  -- Malformed direct RPC payloads must not create an unreadable collection.
  for invalid_state in select value from jsonb_array_elements(
    jsonb_build_array(
      '{}'::jsonb,
      '[]'::jsonb,
      valid_state || '{"apiKey":"must-not-be-stored"}'::jsonb,
      jsonb_set(valid_state, '{settings,budget}', '14'::jsonb),
      jsonb_set(valid_state, '{settings,budget}', '60.5'::jsonb),
      jsonb_set(valid_state, '{settings,budget}', '9007199254740992'::jsonb),
      jsonb_set(valid_state, '{settings,days}', '[]'::jsonb),
      jsonb_set(valid_state, '{settings,days}', '[8]'::jsonb),
      jsonb_set(valid_state, '{settings,days}', '[0,0,0,0,0,0,0,0]'::jsonb),
      jsonb_set(valid_state, '{settings,time}', '"24:00"'::jsonb),
      jsonb_set(valid_state, '{settings,timezone}', '"No/Such_Zone"'::jsonb),
      jsonb_set(updated_state, '{media,0,title}', '" "'::jsonb),
      jsonb_set(updated_state, '{media,0,id}', '"invalid"'::jsonb),
      jsonb_set(updated_state, '{media,0,kind}', '"unknown"'::jsonb),
      jsonb_set(updated_state, '{media,0,progress}', '11'::jsonb),
      jsonb_set(updated_state, '{media,0,total}', '1.5'::jsonb),
      jsonb_set(updated_state, '{media,0,duration}', '0'::jsonb),
      jsonb_set(updated_state, '{media,0,poster}', '"https://evil.example/poster.jpg"'::jsonb),
      jsonb_set(updated_state, '{media,0,sourceUrl}', '"javascript:alert(1)"'::jsonb),
      jsonb_set(updated_state, '{media,0,notes}', to_jsonb(repeat('x', 2001))),
      jsonb_set(updated_state, '{media,0,catalog,source}', '"unknown"'::jsonb),
      jsonb_set(updated_state, '{media,0,catalog,episodes}', '1.5'::jsonb),
      jsonb_set(updated_state, '{media,0,catalog,score}', '11'::jsonb),
      updated_state #- '{media,0,catalog,year}',
      jsonb_set(updated_state, '{media}', (updated_state->'media') || (updated_state->'media')),
      jsonb_set(updated_state, '{sessions,0,from}', '3'::jsonb),
      jsonb_set(updated_state, '{sessions,0,to}', '11'::jsonb),
      jsonb_set(updated_state, '{sessions,0,mediaId}', '"b220b220-0000-4000-8000-000000000002"'::jsonb),
      jsonb_set(updated_state, '{sessions,0,date}', '"2026-02-31"'::jsonb),
      jsonb_set(updated_state, '{sessions}', (updated_state->'sessions') || (updated_state->'sessions')),
      updated_state #- '{sessions,0,done}',
      jsonb_set(updated_state, '{media}', (
      select jsonb_agg(jsonb_set(updated_state->'media'->0, '{id}',
        to_jsonb('b220b220-0000-4000-8000-' || lpad(i::text, 12, '0'))))
      from generate_series(1, 1001) as numbers(i))),
      jsonb_set(updated_state, '{sessions}', (
      select jsonb_agg(jsonb_set(updated_state->'sessions'->0, '{id}',
        to_jsonb('c330c330-0000-4000-8000-' || lpad(i::text, 12, '0'))))
      from generate_series(1, 5001) as numbers(i)))
    )
  ) loop
    begin
      perform public.save_watch_state(invalid_state, 2);
      raise exception 'Malformed state must be denied: %', invalid_state;
    exception when invalid_parameter_value then null;
    end;
  end loop;
  if not exists (select 1 from public.watch_states where revision = 2 and data = updated_state) then
    raise exception 'Malformed state must preserve the saved collection and revision';
  end if;
end;
$$;
reset role;

select set_config('request.jwt.claim.sub', 'a110a110-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"a110a110-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;
do $$
declare
  valid_state jsonb := '{"media":[],"sessions":[],"settings":{"budget":60,"time":"21:00","days":[0,1,2,3,4,5,6],"reminders":true,"timezone":"America/New_York"}}'::jsonb;
begin
  if exists (select 1 from public.watch_states where user_id = 'a110a110-0000-4000-8000-000000000001') then
    raise exception 'Another user collection must stay hidden';
  end if;
  if public.save_watch_state(jsonb_set(valid_state, '{settings,budget}', '120'), 0) is distinct from 1::bigint then
    raise exception 'Another user must have an independent initial revision';
  end if;
  if (select count(*) from public.watch_states) <> 1 then
    raise exception 'Each user must see exactly their own collection';
  end if;
  begin
    update public.watch_states set data = valid_state
      where user_id = 'a110a110-0000-4000-8000-000000000001';
    raise exception 'Cross-user direct update must be denied';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{}', true);
set local role authenticated;
do $$
declare
  valid_state jsonb := '{"media":[],"sessions":[],"settings":{"budget":60,"time":"21:00","days":[0,1,2,3,4,5,6],"reminders":true,"timezone":"America/New_York"}}'::jsonb;
begin
  if exists (select 1 from public.watch_states) then
    raise exception 'Missing user identity must reveal no collections';
  end if;
  begin
    perform public.save_watch_state(valid_state, 0);
    raise exception 'Missing user identity must deny writes';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

do $$
declare
  updated_state jsonb := '{"media":[{"id":"b220b220-0000-4000-8000-000000000001","title":"Example series","kind":"series","priority":false,"status":"watching","progress":0,"total":10,"duration":30,"poster":"https://image.tmdb.org/t/p/w500/test.jpg","sourceUrl":"https://www.imdb.com/title/tt123","notes":"","catalog":{"source":"cinemeta","id":"tt123","synopsis":"Test synopsis","genres":["Drama"],"year":"2026","score":8.5,"episodes":10,"chapters":null,"volumes":null,"seasons":1,"available":10,"releaseStatus":"Finished","format":"TV","durationKnown":true}}],"sessions":[{"id":"c330c330-0000-4000-8000-000000000001","mediaId":"b220b220-0000-4000-8000-000000000001","date":"2026-10-05","time":"21:00","from":1,"to":2,"duration":60,"done":false}],"settings":{"budget":90,"time":"21:00","days":[0,1,2,3,4,5,6],"reminders":true,"timezone":"America/New_York"}}'::jsonb;
begin
  if not exists (select 1 from public.watch_states
    where user_id = 'a110a110-0000-4000-8000-000000000001'
      and revision = 2 and data = updated_state) then
    raise exception 'Other users must never modify the first collection';
  end if;
  if not exists (select 1 from public.watch_states
    where user_id = 'a110a110-0000-4000-8000-000000000002'
      and revision = 1 and data#>>'{settings,budget}' = '120') then
    raise exception 'Independent collections must retain their own revision';
  end if;
end;
$$;

rollback;
