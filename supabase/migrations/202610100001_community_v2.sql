-- Community v2: recommendations, reactions to an episode or work, the "Communauté" feed,
-- each member's spoiler protection, and "À découvrir". Run once in the SQL Editor, after
-- 202610090001_community_hub.sql. Everything here is additive: the site keeps working while
-- the new version is being deployed.

-- ---------- Works: a wide image and the year, from the catalog ----------
alter table public.community_targets
  add column backdrop text not null default '' check (
    char_length(backdrop) <= 2000
    and (
      backdrop = ''
      or backdrop ~ '^https://(media\.kitsu\.app|media\.kitsu\.io|cdn\.myanimelist\.net|static\.tvmaze\.com|images\.metahub\.space|m\.media-amazon\.com|image\.tmdb\.org)/'
    )
  ),
  add column year text not null default '' check (char_length(year) <= 12);

-- Same as community_ensure_target, with the wide image and the year. The older version stays
-- for the site that is live while this one is deployed.
create function public.community_ensure_target(
  p_kind text, p_source text, p_source_id text, p_season integer, p_episode integer,
  p_title text, p_poster text, p_backdrop text, p_year text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_id uuid;
begin
  insert into public.community_targets (kind, source, source_id, season, episode, title, poster, backdrop, year)
  values (p_kind, p_source, p_source_id, p_season, p_episode, p_title, coalesce(p_poster, ''),
          coalesce(p_backdrop, ''), left(coalesce(p_year, ''), 12))
  on conflict (kind, source, source_id, coalesce(season, -1), coalesce(episode, -1))
  do update set title = excluded.title, poster = excluded.poster, backdrop = excluded.backdrop, year = excluded.year
  returning id into target_id;
  return target_id;
end;
$$;

-- ---------- Posts: a débrief, or a recommendation of a whole work ----------
alter table public.community_comments
  add column kind text not null default 'debrief' check (kind in ('debrief', 'reco'));
create index community_comments_feed on public.community_comments (created_at desc)
  where parent_id is null and deleted_at is null;

create or replace function public.community_comment_json(c public.community_comments)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', c.id,
    'parentId', c.parent_id,
    'kind', c.kind,
    'username', (select p.username from public.profiles p where p.user_id = c.author_id),
    'mine', c.author_id is not null and c.author_id = auth.uid(),
    'body', c.body,
    'spoiler', c.spoiler,
    'createdAt', c.created_at,
    'edited', c.edited_at is not null,
    'deleted', c.deleted_at is not null,
    'removed', c.removed,
    'showRating', c.show_rating,
    'rating', case when c.show_rating and c.deleted_at is null then (
      select r.score from public.community_ratings r where r.target_id = c.target_id and r.user_id = c.author_id
    ) end,
    'reactions', coalesce((
      select jsonb_object_agg(x.reaction, x.n)
      from (
        select reaction, count(*) as n from public.community_reactions
        where comment_id = c.id group by reaction
      ) x
    ), '{}'::jsonb),
    'myReaction', (
      select reaction from public.community_reactions where comment_id = c.id and user_id = auth.uid()
    )
  );
$$;

-- A recommendation: a short text about a whole work, with the author's verdict when given.
-- The verdict is the work's own rating, so it also counts in the work's discussion.
create function public.community_recommend(p_target uuid, p_body text, p_spoiler text, p_score integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := public.community_require_poster();
  clean text := btrim(coalesce(p_body, ''));
  target public.community_targets;
  created public.community_comments;
begin
  if not exists (select 1 from public.profiles where user_id = caller_id) then
    raise exception 'username_required' using errcode = 'P0001';
  end if;
  if char_length(clean) not between 1 and 500 then
    raise exception 'invalid_body' using errcode = '22023';
  end if;
  select * into target from public.community_targets where id = p_target;
  if not found then
    raise exception 'target_not_found' using errcode = 'P0002';
  end if;
  if target.episode is not null then
    raise exception 'invalid_parent' using errcode = '22023';
  end if;
  if coalesce(p_spoiler, '') not in ('none', 'episode') then
    raise exception 'invalid_spoiler' using errcode = '22023';
  end if;
  if p_score is not null and p_score not between 1 and 10 then
    raise exception 'invalid_score' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('community_post:' || caller_id::text));
  select * into created from public.community_comments
  where author_id = caller_id and target_id = p_target and parent_id is null and kind = 'reco'
    and body = clean and deleted_at is null and created_at > now() - interval '30 seconds'
  order by created_at desc limit 1;
  if found then
    return public.community_comment_json(created) || jsonb_build_object('replyCount', 0, 'replies', '[]'::jsonb);
  end if;
  if (select count(*) from public.community_comments
      where author_id = caller_id and created_at > now() - interval '1 minute') >= 5 then
    raise exception 'too_fast' using errcode = 'P0001';
  end if;
  if (select count(*) from public.community_comments
      where author_id = caller_id and created_at > now() - interval '1 day') >= 200 then
    raise exception 'daily_limit' using errcode = 'P0001';
  end if;
  if p_score is not null then
    insert into public.community_ratings (target_id, user_id, score)
    values (p_target, caller_id, p_score)
    on conflict (target_id, user_id) do update set score = excluded.score, updated_at = now();
  end if;
  insert into public.community_comments (target_id, parent_id, author_id, body, spoiler, show_rating, kind)
  values (p_target, null, caller_id, clean, p_spoiler, p_score is not null, 'reco')
  returning * into created;
  return public.community_comment_json(created) || jsonb_build_object('replyCount', 0, 'replies', '[]'::jsonb);
end;
$$;

-- ---------- "Ta réaction": one reaction per member to an episode or a work ----------
create table public.community_target_reactions (
  target_id uuid not null references public.community_targets (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  reaction text not null check (reaction in ('fire', 'cry', 'mind', 'heart')),
  created_at timestamptz not null default now(),
  primary key (target_id, user_id)
);
create index community_target_reactions_user on public.community_target_reactions (user_id);
alter table public.community_target_reactions enable row level security;
revoke all on table public.community_target_reactions from public, anon, authenticated;

create function public.community_target_reaction_json(p_target uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'targetReactions', coalesce((
      select jsonb_object_agg(x.reaction, x.n) from (
        select reaction, count(*) as n from public.community_target_reactions
        where target_id = p_target group by reaction
      ) x
    ), '{}'::jsonb),
    'myTargetReaction', (
      select reaction from public.community_target_reactions where target_id = p_target and user_id = auth.uid()
    )
  );
$$;

-- The same reaction again removes it; another one replaces it.
create function public.community_react_target(p_target uuid, p_reaction text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := public.community_require_poster();
  previous text;
begin
  if not exists (select 1 from public.community_targets where id = p_target) then
    raise exception 'target_not_found' using errcode = 'P0002';
  end if;
  if p_reaction is not null and p_reaction not in ('fire', 'cry', 'mind', 'heart') then
    raise exception 'invalid_reaction' using errcode = '22023';
  end if;
  select reaction into previous from public.community_target_reactions
  where target_id = p_target and user_id = caller_id for update;
  if p_reaction is null or previous = p_reaction then
    delete from public.community_target_reactions where target_id = p_target and user_id = caller_id;
  else
    insert into public.community_target_reactions (target_id, user_id, reaction)
    values (p_target, caller_id, p_reaction)
    on conflict (target_id, user_id) do update set reaction = excluded.reaction, created_at = now();
  end if;
  return public.community_target_reaction_json(p_target);
end;
$$;

-- A discussion's summary now also carries the reactions to the episode or work.
create or replace function public.community_summary(p_target uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_id uuid := public.community_require_member();
  my_score smallint;
  verdicts integer;
  mean numeric;
  dist integer[];
  debriefs integer;
begin
  select score into my_score from public.community_ratings where target_id = p_target and user_id = caller_id;
  select count(*), avg(score) into verdicts, mean from public.community_ratings where target_id = p_target;
  select array_agg(coalesce(r.n, 0)::integer order by s.score) into dist
  from generate_series(1, 10) as s(score)
  left join (
    select score, count(*) as n from public.community_ratings where target_id = p_target group by score
  ) r on r.score = s.score;
  select count(*) into debriefs from public.community_comments
  where target_id = p_target and parent_id is null and deleted_at is null;
  return jsonb_build_object(
    'myScore', my_score,
    'verdicts', verdicts,
    'average', case when verdicts >= 5 then round(mean, 1) end,
    'histogram', case when verdicts >= 5 then to_jsonb(dist) end,
    'debriefs', debriefs
  ) || public.community_target_reaction_json(p_target);
end;
$$;

-- ---------- Spoiler protection: on, unless the member turns it off ----------
create table public.community_prefs (
  user_id uuid primary key references auth.users (id) on delete cascade,
  spoiler_protection boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.community_prefs enable row level security;
revoke all on table public.community_prefs from public, anon, authenticated;

create function public.community_get_prefs()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_id uuid := public.community_require_member();
begin
  return jsonb_build_object('spoilerProtection', coalesce((
    select spoiler_protection from public.community_prefs where user_id = caller_id
  ), true));
end;
$$;

create function public.community_set_prefs(p_spoiler_protection boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := public.community_require_member();
begin
  insert into public.community_prefs (user_id, spoiler_protection)
  values (caller_id, coalesce(p_spoiler_protection, true))
  on conflict (user_id) do update set spoiler_protection = excluded.spoiler_protection, updated_at = now();
  return public.community_get_prefs();
end;
$$;

-- ---------- The feed ----------
-- Posts about the works of the member's list (last two weeks) come first, then everything else,
-- newest first. While protection is on, a spoiler's text stays in the database: the page asks for
-- it (community_bodies) once the member has seen the episode or chooses to show it.
create function public.community_feed(p_kind text, p_works jsonb, p_offset integer, p_limit integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_id uuid := public.community_require_member();
  lim integer := least(greatest(coalesce(p_limit, 20), 1), 40);
  skip integer := least(greatest(coalesce(p_offset, 0), 0), 2000);
  works jsonb := coalesce(p_works, '[]'::jsonb);
  show_spoilers boolean := not coalesce((
    select spoiler_protection from public.community_prefs where user_id = caller_id
  ), true);
  items jsonb;
begin
  if p_kind is not null and p_kind not in ('anime', 'manga', 'series', 'film') then
    raise exception 'invalid_kind' using errcode = '22023';
  end if;
  if jsonb_typeof(works) <> 'array' or jsonb_array_length(works) > 300 then
    raise exception 'invalid_works' using errcode = '22023';
  end if;

  with mine as (
    select distinct r.kind, r.source, r."sourceId" as source_id
    from jsonb_to_recordset(works) as r(kind text, source text, "sourceId" text)
  ),
  posts as (
    select c.id, c.created_at,
      exists (
        select 1 from mine m where m.kind = t.kind and m.source = t.source and m.source_id = t.source_id
      ) as in_list
    from public.community_comments c
    join public.community_targets t on t.id = c.target_id
    where c.parent_id is null and c.deleted_at is null and (p_kind is null or t.kind = p_kind)
  ),
  page as (
    select p.id, p.in_list, row_number() over (
      order by (p.in_list and p.created_at > now() - interval '14 days') desc, p.created_at desc, p.id
    ) as position
    from posts p
  )
  select coalesce(jsonb_agg(
    (public.community_comment_json(c) - 'body' - 'parentId') || jsonb_build_object(
      'body', case when c.spoiler = 'none' or show_spoilers then c.body end,
      'replyCount', (select count(*) from public.community_comments r where r.parent_id = c.id and r.deleted_at is null),
      'inList', page.in_list,
      'target', jsonb_build_object(
        'kind', t.kind, 'source', t.source, 'sourceId', t.source_id, 'season', t.season, 'episode', t.episode,
        'title', t.title, 'poster', t.poster, 'backdrop', t.backdrop, 'year', t.year
      )
    ) order by page.position
  ), '[]'::jsonb) into items
  from page
  join public.community_comments c on c.id = page.id
  join public.community_targets t on t.id = c.target_id
  where page.position > skip and page.position <= skip + lim + 1;

  return jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(e.x order by e.i) from jsonb_array_elements(items) with ordinality as e(x, i) where e.i <= lim
    ), '[]'::jsonb),
    'hasMore', jsonb_array_length(items) > lim,
    'spoilerProtection', not show_spoilers
  );
end;
$$;

-- The text of spoilers the member has seen or chooses to show. The same text is readable in the
-- discussion itself; the feed simply does not send it until it is wanted.
create function public.community_bodies(p_ids uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.community_require_member();
  if coalesce(array_length(p_ids, 1), 0) > 50 then
    raise exception 'invalid_works' using errcode = '22023';
  end if;
  return coalesce((
    select jsonb_object_agg(c.id, c.body) from public.community_comments c
    where c.id = any (p_ids) and c.deleted_at is null
  ), '{}'::jsonb);
end;
$$;

-- "Tes discussions": activity per work of the member's list, with the episode talked about last.
create or replace function public.community_works_activity(p_works jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.community_require_member();
  if jsonb_typeof(p_works) <> 'array' or jsonb_array_length(p_works) > 300 then
    raise exception 'invalid_works' using errcode = '22023';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'kind', w.kind, 'source', w.source, 'sourceId', w.source_id,
      'debriefs', w.debriefs, 'latestAt', w.latest_at, 'latest', w.latest
    ))
    from (
      select t.kind, t.source, t.source_id, count(c.id) as debriefs, max(c.created_at) as latest_at,
        (array_agg(jsonb_build_object('season', t.season, 'episode', t.episode) order by c.created_at desc))[1] as latest
      from (
        select distinct r.kind, r.source, r."sourceId"
        from jsonb_to_recordset(p_works) as r(kind text, source text, "sourceId" text)
      ) r
      join public.community_targets t
        on t.kind = r.kind and t.source = r.source and t.source_id = r."sourceId"
      join public.community_comments c
        on c.target_id = t.id and c.deleted_at is null
      group by t.kind, t.source, t.source_id
    ) w
  ), '[]'::jsonb);
end;
$$;

-- "À découvrir": works recommended lately that are not in the member's list.
create function public.community_discover(p_works jsonb, p_limit integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  works jsonb := coalesce(p_works, '[]'::jsonb);
begin
  perform public.community_require_member();
  if jsonb_typeof(works) <> 'array' or jsonb_array_length(works) > 300 then
    raise exception 'invalid_works' using errcode = '22023';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'kind', x.kind, 'source', x.source, 'sourceId', x.source_id, 'title', x.title,
      'poster', x.poster, 'backdrop', x.backdrop, 'year', x.year, 'recos', x.recos
    ) order by x.recos desc, x.latest desc)
    from (
      select t.kind, t.source, t.source_id, t.title, t.poster, t.backdrop, t.year,
        count(c.id) as recos, max(c.created_at) as latest
      from public.community_comments c
      join public.community_targets t on t.id = c.target_id
      where c.kind = 'reco' and c.deleted_at is null and c.created_at > now() - interval '60 days'
        and not exists (
          select 1 from jsonb_to_recordset(works) as r(kind text, source text, "sourceId" text)
          where r.kind = t.kind and r.source = t.source and r."sourceId" = t.source_id
        )
      group by t.id
      order by count(c.id) desc, max(c.created_at) desc
      limit least(greatest(coalesce(p_limit, 4), 1), 8)
    ) x
  ), '[]'::jsonb);
end;
$$;

-- ---------- Who may call what ----------
-- "Télécharger mes données" lists the member's posts, verdicts and reactions; the server reads them.
grant select on table
  public.community_comments,
  public.community_ratings,
  public.community_reactions,
  public.community_target_reactions,
  public.community_prefs
to service_role;
revoke all on function public.community_ensure_target(text, text, text, integer, integer, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.community_ensure_target(text, text, text, integer, integer, text, text, text, text)
  to service_role;
revoke all on function public.community_target_reaction_json(uuid) from public, anon, authenticated;
revoke all on function public.community_recommend(uuid, text, text, integer) from public, anon;
revoke all on function public.community_react_target(uuid, text) from public, anon;
revoke all on function public.community_get_prefs() from public, anon;
revoke all on function public.community_set_prefs(boolean) from public, anon;
revoke all on function public.community_feed(text, jsonb, integer, integer) from public, anon;
revoke all on function public.community_bodies(uuid[]) from public, anon;
revoke all on function public.community_discover(jsonb, integer) from public, anon;
grant execute on function
  public.community_recommend(uuid, text, text, integer),
  public.community_react_target(uuid, text),
  public.community_get_prefs(),
  public.community_set_prefs(boolean),
  public.community_feed(text, jsonb, integer, integer),
  public.community_bodies(uuid[]),
  public.community_discover(jsonb, integer)
to authenticated;
