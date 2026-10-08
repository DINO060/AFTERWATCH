-- Community, step 1: ratings ("verdicts") and discussions ("débriefs") about works and episodes.
-- Run once in the SQL Editor, after 202610080001_public_profiles.sql.
-- Members never read or write these tables directly: everything goes through the functions below,
-- which take the member from the verified session (auth.uid()) and enforce the rules. Only the list
-- of works and episodes is readable, and only the server (service_role) can add to it, with titles
-- and posters it fetched from the catalog itself.

-- ---------- Works and episodes ----------
-- Identified by the catalog: kind + source + id, plus season/episode for an episode. Anime episodes
-- use the catalog entry's own numbering (no season); series use season + episode.
create table public.community_targets (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('anime', 'manga', 'series', 'film')),
  source text not null check (source in ('kitsu', 'jikan', 'tmdb', 'tvmaze', 'cinemeta')),
  source_id text not null check (source_id ~ '^(tt)?[0-9]{1,12}$'),
  season integer check (season between 0 and 500),
  episode integer check (episode between 1 and 10000),
  title text not null check (char_length(title) between 1 and 180),
  poster text not null default '' check (
    char_length(poster) <= 2000
    and (
      poster = ''
      or poster ~ '^https://(media\.kitsu\.app|media\.kitsu\.io|cdn\.myanimelist\.net|static\.tvmaze\.com|images\.metahub\.space|m\.media-amazon\.com|image\.tmdb\.org)/'
    )
  ),
  created_at timestamptz not null default now(),
  check (
    (season is null and episode is null)
    or (kind = 'anime' and season is null and episode is not null)
    or (kind = 'series' and season is not null and episode is not null)
  ),
  check ((source = 'cinemeta') = (source_id like 'tt%'))
);
create unique index community_targets_identity
  on public.community_targets (kind, source, source_id, coalesce(season, -1), coalesce(episode, -1));
alter table public.community_targets enable row level security;
revoke all on table public.community_targets from public, anon, authenticated;
grant select on table public.community_targets to authenticated;
grant select, insert, update on table public.community_targets to service_role;
create policy "Members read works and episodes" on public.community_targets
  for select to authenticated using (true);

-- ---------- Verdicts: one 1–10 score per member and target ----------
create table public.community_ratings (
  target_id uuid not null references public.community_targets (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  score smallint not null check (score between 1 and 10),
  updated_at timestamptz not null default now(),
  primary key (target_id, user_id)
);
create index community_ratings_user on public.community_ratings (user_id);
alter table public.community_ratings enable row level security;
revoke all on table public.community_ratings from public, anon, authenticated;

-- ---------- Débriefs (comments) and their replies (one level) ----------
create table public.community_comments (
  id uuid primary key default gen_random_uuid(),
  target_id uuid not null references public.community_targets (id) on delete cascade,
  parent_id uuid references public.community_comments (id) on delete cascade,
  -- A deleted account leaves "Commentaire supprimé" so the replies of others stay readable.
  author_id uuid references auth.users (id) on delete set null,
  body text not null,
  -- none | episode (spoils the episode or work discussed) | later (spoils what comes after)
  spoiler text not null default 'none' check (spoiler in ('none', 'episode', 'later')),
  -- Shows the author's current verdict on the same target next to the débrief.
  show_rating boolean not null default false,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  removed boolean not null default false,
  check (
    (deleted_at is null and char_length(body) between 1 and 2000)
    or (deleted_at is not null and body = '')
  )
);
create index community_comments_thread on public.community_comments (target_id, created_at desc) where parent_id is null;
create index community_comments_parent on public.community_comments (parent_id, created_at);
create index community_comments_author on public.community_comments (author_id, created_at desc);
alter table public.community_comments enable row level security;
revoke all on table public.community_comments from public, anon, authenticated;

create function public.community_comment_author_gone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.author_id is null and old.author_id is not null then
    new.body := '';
    new.deleted_at := coalesce(old.deleted_at, now());
    new.show_rating := false;
  end if;
  return new;
end;
$$;
create trigger community_comment_author_gone
  before update of author_id on public.community_comments
  for each row execute function public.community_comment_author_gone();

-- ---------- Reactions: one per member and comment ----------
create table public.community_reactions (
  comment_id uuid not null references public.community_comments (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  reaction text not null check (reaction in ('heart', 'fire', 'laugh', 'cry', 'mind')),
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);
create index community_reactions_user on public.community_reactions (user_id);
alter table public.community_reactions enable row level security;
revoke all on table public.community_reactions from public, anon, authenticated;

-- ---------- Moderation ----------
create table public.community_moderators (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.community_moderators enable row level security;
revoke all on table public.community_moderators from public, anon, authenticated;

-- A banned member can still read, but no longer post, react or rate.
create table public.community_bans (
  user_id uuid primary key references auth.users (id) on delete cascade,
  banned_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.community_bans enable row level security;
revoke all on table public.community_bans from public, anon, authenticated;

create table public.community_reports (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.community_comments (id) on delete cascade,
  reporter_id uuid not null references auth.users (id) on delete cascade,
  reason text not null check (reason in ('spam', 'harassment', 'hate', 'spoiler', 'illegal', 'other')),
  details text not null default '' check (char_length(details) <= 500),
  status text not null default 'open' check (status in ('open', 'removed', 'dismissed')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users (id) on delete set null,
  unique (comment_id, reporter_id)
);
create index community_reports_open on public.community_reports (created_at) where status = 'open';
create index community_reports_reporter on public.community_reports (reporter_id, created_at desc);
alter table public.community_reports enable row level security;
revoke all on table public.community_reports from public, anon, authenticated;

-- ---------- Helpers ----------
create function public.community_require_member()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  return auth.uid();
end;
$$;

create function public.community_require_poster()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_id uuid := public.community_require_member();
begin
  if exists (select 1 from public.community_bans where user_id = caller_id) then
    raise exception 'banned' using errcode = '42501';
  end if;
  return caller_id;
end;
$$;

create function public.community_is_moderator()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.community_moderators where user_id = auth.uid());
$$;

-- One débrief as the app shows it. Never exposes account ids, only usernames.
create function public.community_comment_json(c public.community_comments)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', c.id,
    'parentId', c.parent_id,
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

-- ---------- Works and episodes (server only) ----------
create function public.community_ensure_target(
  p_kind text, p_source text, p_source_id text, p_season integer, p_episode integer, p_title text, p_poster text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_id uuid;
begin
  insert into public.community_targets (kind, source, source_id, season, episode, title, poster)
  values (p_kind, p_source, p_source_id, p_season, p_episode, p_title, coalesce(p_poster, ''))
  on conflict (kind, source, source_id, coalesce(season, -1), coalesce(episode, -1))
  do update set title = excluded.title, poster = excluded.poster
  returning id into target_id;
  return target_id;
end;
$$;

-- Which episodes of a work have verdicts or débriefs, for the episode picker.
create function public.community_episode_activity(p_kind text, p_source text, p_source_id text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when auth.uid() is null then '[]'::jsonb else coalesce(jsonb_agg(x order by x.season nulls first, x.episode), '[]'::jsonb) end
  from (
    select t.season, t.episode,
      (select count(*) from public.community_comments c where c.target_id = t.id and c.deleted_at is null) as debriefs,
      (select count(*) from public.community_ratings r where r.target_id = t.id) as verdicts
    from public.community_targets t
    where t.kind = p_kind and t.source = p_source and t.source_id = p_source_id and t.episode is not null
    limit 2000
  ) x
  where x.debriefs > 0 or x.verdicts > 0;
$$;

-- ---------- Verdicts ----------
-- Average and distribution appear from 5 verdicts, so a handful of votes cannot mislead.
create function public.community_summary(p_target uuid)
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
  );
end;
$$;

create function public.community_set_rating(p_target uuid, p_score integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := public.community_require_poster();
begin
  if not exists (select 1 from public.community_targets where id = p_target) then
    raise exception 'target_not_found' using errcode = 'P0002';
  end if;
  if p_score is null then
    delete from public.community_ratings where target_id = p_target and user_id = caller_id;
  elsif p_score between 1 and 10 then
    insert into public.community_ratings (target_id, user_id, score)
    values (p_target, caller_id, p_score)
    on conflict (target_id, user_id) do update set score = excluded.score, updated_at = now();
  else
    raise exception 'invalid_score' using errcode = '22023';
  end if;
  return public.community_summary(p_target);
end;
$$;

-- ---------- Débriefs ----------
-- Top-level débriefs, newest first or most reacted first, with their replies (oldest first).
-- A deleted débrief stays as a placeholder only while it has replies.
create function public.community_thread(p_target uuid, p_sort text, p_offset integer, p_limit integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_id uuid := public.community_require_member();
  lim integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  skip integer := least(greatest(coalesce(p_offset, 0), 0), 100000);
  total integer;
  items jsonb;
begin
  select count(*) into total
  from public.community_comments c
  where c.target_id = p_target and c.parent_id is null
    and (c.deleted_at is null or exists (
      select 1 from public.community_comments r where r.parent_id = c.id and r.deleted_at is null
    ));

  select coalesce(jsonb_agg(
    public.community_comment_json(base) || jsonb_build_object(
      'replyCount', (select count(*) from public.community_comments r where r.parent_id = base.id and r.deleted_at is null),
      'replies', coalesce((
        select jsonb_agg(public.community_comment_json(r) order by r.created_at, r.id)
        from (
          select * from public.community_comments r
          where r.parent_id = base.id and r.deleted_at is null
          order by r.created_at, r.id
          limit 50
        ) r
      ), '[]'::jsonb)
    ) order by ranked.position
  ), '[]'::jsonb) into items
  from (
    select c.id, row_number() over (
      order by
        case when p_sort = 'top' then (select count(*) from public.community_reactions x where x.comment_id = c.id) end desc nulls last,
        c.created_at desc,
        c.id
    ) as position
    from public.community_comments c
    where c.target_id = p_target and c.parent_id is null
      and (c.deleted_at is null or exists (
        select 1 from public.community_comments r where r.parent_id = c.id and r.deleted_at is null
      ))
  ) ranked
  join public.community_comments base on base.id = ranked.id
  where ranked.position > skip and ranked.position <= skip + lim;

  return jsonb_build_object('comments', items, 'total', total, 'hasMore', skip + lim < total);
end;
$$;

create function public.community_add_comment(
  p_target uuid, p_parent uuid, p_body text, p_spoiler text, p_show_rating boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := public.community_require_poster();
  clean text := btrim(coalesce(p_body, ''));
  target public.community_targets;
  parent public.community_comments;
  created public.community_comments;
begin
  if not exists (select 1 from public.profiles where user_id = caller_id) then
    raise exception 'username_required' using errcode = 'P0001';
  end if;
  if char_length(clean) not between 1 and 2000 then
    raise exception 'invalid_body' using errcode = '22023';
  end if;
  select * into target from public.community_targets where id = p_target;
  if not found then
    raise exception 'target_not_found' using errcode = 'P0002';
  end if;
  if coalesce(p_spoiler, '') not in ('none', 'episode', 'later') or (target.episode is null and p_spoiler = 'later') then
    raise exception 'invalid_spoiler' using errcode = '22023';
  end if;
  if p_parent is not null then
    select * into parent from public.community_comments where id = p_parent;
    if not found or parent.target_id <> p_target or parent.parent_id is not null or parent.deleted_at is not null then
      raise exception 'invalid_parent' using errcode = '22023';
    end if;
  end if;
  -- One member's posts are counted one at a time, so rapid clicks cannot slip past the limits.
  perform pg_advisory_xact_lock(hashtext('community_post:' || caller_id::text));
  -- The same text sent twice in a row is one débrief.
  select * into created from public.community_comments
  where author_id = caller_id and target_id = p_target and parent_id is not distinct from p_parent
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
  insert into public.community_comments (target_id, parent_id, author_id, body, spoiler, show_rating)
  values (p_target, p_parent, caller_id, clean, p_spoiler, coalesce(p_show_rating, false))
  returning * into created;
  return public.community_comment_json(created) || jsonb_build_object('replyCount', 0, 'replies', '[]'::jsonb);
end;
$$;

-- Editing changes the text and the spoiler level, never the work or episode it belongs to.
create function public.community_edit_comment(p_comment uuid, p_body text, p_spoiler text, p_show_rating boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := public.community_require_poster();
  clean text := btrim(coalesce(p_body, ''));
  existing public.community_comments;
  target public.community_targets;
  updated public.community_comments;
begin
  select * into existing from public.community_comments where id = p_comment;
  if not found or existing.author_id is distinct from caller_id or existing.deleted_at is not null then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if char_length(clean) not between 1 and 2000 then
    raise exception 'invalid_body' using errcode = '22023';
  end if;
  select * into target from public.community_targets where id = existing.target_id;
  if coalesce(p_spoiler, '') not in ('none', 'episode', 'later') or (target.episode is null and p_spoiler = 'later') then
    raise exception 'invalid_spoiler' using errcode = '22023';
  end if;
  update public.community_comments
  set body = clean, spoiler = p_spoiler, show_rating = coalesce(p_show_rating, false), edited_at = now()
  where id = p_comment
  returning * into updated;
  return public.community_comment_json(updated);
end;
$$;

create function public.community_delete_comment(p_comment uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := public.community_require_member();
begin
  update public.community_comments
  set body = '', deleted_at = now(), show_rating = false
  where id = p_comment and author_id = caller_id and deleted_at is null;
  if not found then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
end;
$$;

-- The same reaction again removes it; another one replaces it.
create function public.community_react(p_comment uuid, p_reaction text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := public.community_require_poster();
  previous text;
  c public.community_comments;
begin
  select * into c from public.community_comments where id = p_comment;
  if not found or c.deleted_at is not null then
    raise exception 'comment_not_found' using errcode = 'P0002';
  end if;
  if p_reaction is not null and p_reaction not in ('heart', 'fire', 'laugh', 'cry', 'mind') then
    raise exception 'invalid_reaction' using errcode = '22023';
  end if;
  select reaction into previous from public.community_reactions
  where comment_id = p_comment and user_id = caller_id for update;
  if p_reaction is null or previous = p_reaction then
    delete from public.community_reactions where comment_id = p_comment and user_id = caller_id;
  else
    insert into public.community_reactions (comment_id, user_id, reaction)
    values (p_comment, caller_id, p_reaction)
    on conflict (comment_id, user_id) do update set reaction = excluded.reaction, created_at = now();
  end if;
  return jsonb_build_object(
    'reactions', public.community_comment_json(c) -> 'reactions',
    'myReaction', public.community_comment_json(c) -> 'myReaction'
  );
end;
$$;

create function public.community_report(p_comment uuid, p_reason text, p_details text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := public.community_require_member();
  c public.community_comments;
begin
  select * into c from public.community_comments where id = p_comment;
  if not found or c.deleted_at is not null then
    raise exception 'comment_not_found' using errcode = 'P0002';
  end if;
  if c.author_id = caller_id then
    raise exception 'own_comment' using errcode = '22023';
  end if;
  if coalesce(p_reason, '') not in ('spam', 'harassment', 'hate', 'spoiler', 'illegal', 'other')
     or char_length(coalesce(p_details, '')) > 500 then
    raise exception 'invalid_report' using errcode = '22023';
  end if;
  if (select count(*) from public.community_reports
      where reporter_id = caller_id and created_at > now() - interval '1 day') >= 20 then
    raise exception 'daily_limit' using errcode = 'P0001';
  end if;
  insert into public.community_reports (comment_id, reporter_id, reason, details)
  values (p_comment, caller_id, p_reason, btrim(coalesce(p_details, '')))
  on conflict (comment_id, reporter_id) do nothing;
end;
$$;

-- ---------- Moderation (moderators only) ----------
create function public.community_moderation_queue()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.community_is_moderator() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(q.item order by q.first_report)
    from (
      select min(r.created_at) as first_report, jsonb_build_object(
        'commentId', c.id,
        'body', c.body,
        'spoiler', c.spoiler,
        'createdAt', c.created_at,
        'author', (select p.username from public.profiles p where p.user_id = c.author_id),
        'authorBanned', exists (select 1 from public.community_bans b where b.user_id = c.author_id),
        'target', jsonb_build_object(
          'kind', t.kind, 'source', t.source, 'sourceId', t.source_id,
          'season', t.season, 'episode', t.episode, 'title', t.title, 'poster', t.poster
        ),
        'reports', count(*),
        'reasons', (
          select jsonb_object_agg(x.reason, x.n) from (
            select reason, count(*) as n from public.community_reports
            where comment_id = c.id and status = 'open' group by reason
          ) x
        ),
        'details', coalesce((
          select jsonb_agg(d.details) from (
            select details from public.community_reports
            where comment_id = c.id and status = 'open' and details <> ''
            order by created_at limit 10
          ) d
        ), '[]'::jsonb)
      ) as item
      from public.community_reports r
      join public.community_comments c on c.id = r.comment_id
      join public.community_targets t on t.id = c.target_id
      where r.status = 'open'
      group by c.id, t.id
      order by min(r.created_at)
      limit 100
    ) q
  ), '[]'::jsonb);
end;
$$;

create function public.community_resolve(p_comment uuid, p_action text, p_ban boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  author uuid;
begin
  if not public.community_is_moderator() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if coalesce(p_action, '') not in ('remove', 'dismiss') then
    raise exception 'invalid_action' using errcode = '22023';
  end if;
  select author_id into author from public.community_comments where id = p_comment;
  if not found then
    raise exception 'comment_not_found' using errcode = 'P0002';
  end if;
  if p_action = 'remove' then
    update public.community_comments
    set body = '', deleted_at = coalesce(deleted_at, now()), removed = true, show_rating = false
    where id = p_comment;
  end if;
  update public.community_reports
  set status = case when p_action = 'remove' then 'removed' else 'dismissed' end,
      resolved_at = now(), resolved_by = auth.uid()
  where comment_id = p_comment and status = 'open';
  if coalesce(p_ban, false) and author is not null then
    insert into public.community_bans (user_id, banned_by) values (author, auth.uid())
    on conflict (user_id) do nothing;
  end if;
end;
$$;

-- ---------- Who may call what ----------
revoke all on function public.community_comment_author_gone() from public, anon, authenticated;
revoke all on function public.community_require_member() from public, anon, authenticated;
revoke all on function public.community_require_poster() from public, anon, authenticated;
revoke all on function public.community_comment_json(public.community_comments) from public, anon, authenticated;
revoke all on function public.community_ensure_target(text, text, text, integer, integer, text, text) from public, anon, authenticated;
grant execute on function public.community_ensure_target(text, text, text, integer, integer, text, text) to service_role;
revoke all on function public.community_is_moderator() from public, anon;
revoke all on function public.community_episode_activity(text, text, text) from public, anon;
revoke all on function public.community_summary(uuid) from public, anon;
revoke all on function public.community_set_rating(uuid, integer) from public, anon;
revoke all on function public.community_thread(uuid, text, integer, integer) from public, anon;
revoke all on function public.community_add_comment(uuid, uuid, text, text, boolean) from public, anon;
revoke all on function public.community_edit_comment(uuid, text, text, boolean) from public, anon;
revoke all on function public.community_delete_comment(uuid) from public, anon;
revoke all on function public.community_react(uuid, text) from public, anon;
revoke all on function public.community_report(uuid, text, text) from public, anon;
revoke all on function public.community_moderation_queue() from public, anon;
revoke all on function public.community_resolve(uuid, text, boolean) from public, anon;
grant execute on function
  public.community_is_moderator(),
  public.community_episode_activity(text, text, text),
  public.community_summary(uuid),
  public.community_set_rating(uuid, integer),
  public.community_thread(uuid, text, integer, integer),
  public.community_add_comment(uuid, uuid, text, text, boolean),
  public.community_edit_comment(uuid, text, text, boolean),
  public.community_delete_comment(uuid),
  public.community_react(uuid, text),
  public.community_report(uuid, text, text),
  public.community_moderation_queue(),
  public.community_resolve(uuid, text, boolean)
to authenticated;
