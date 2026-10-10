-- Community, X / Threads style: photos in posts (up to 4), #hashtags, trends, and one function to
-- publish any post. Run once in the SQL Editor, after 202610100001_community_v2.sql.
-- Additive: the earlier functions keep working while the new site is being deployed.

-- ---------- Photos: stored in Supabase Storage, each member in their own folder ----------
-- Public URLs (random names), at most 2 MB each, only WebP or JPEG (the app re-encodes every photo,
-- which also removes its GPS location).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('community-photos', 'community-photos', true, 2097152, array['image/webp', 'image/jpeg'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy "Members add photos to their own folder" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'community-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(webp|jpg)$'
  );
create policy "Members see their own photos" on storage.objects
  for select to authenticated
  using (bucket_id = 'community-photos' and owner_id = (select auth.uid())::text);
create policy "Members delete their own photos" on storage.objects
  for delete to authenticated
  using (bucket_id = 'community-photos' and owner_id = (select auth.uid())::text);

-- ---------- Posts: photos and #tags ----------
alter table public.community_comments
  add column photos jsonb not null default '[]'::jsonb
    check (jsonb_typeof(photos) = 'array' and jsonb_array_length(photos) <= 4),
  add column tags text[] not null default '{}' check (cardinality(tags) <= 10);

-- A post may now be photos only; text is still at most 2000 characters.
do $$
declare
  old_check text;
begin
  select conname into old_check from pg_constraint
  where conrelid = 'public.community_comments'::regclass and contype = 'c'
    and pg_get_constraintdef(oid) like '%char_length(body)%';
  if old_check is not null then
    execute format('alter table public.community_comments drop constraint %I', old_check);
  end if;
end;
$$;
alter table public.community_comments add constraint community_comments_content check (
  (deleted_at is null and char_length(body) <= 2000 and (char_length(body) >= 1 or jsonb_array_length(photos) > 0))
  or (deleted_at is not null and body = '')
);

create index community_comments_tags on public.community_comments using gin (tags)
  where deleted_at is null and parent_id is null;

-- A deleted or removed post keeps neither its photos nor its tags (the server deletes the files).
create function public.community_comment_cleared()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.deleted_at is not null then
    new.photos := '[]'::jsonb;
    new.tags := '{}';
  end if;
  return new;
end;
$$;
create trigger community_comment_cleared
  before update on public.community_comments
  for each row execute function public.community_comment_cleared();
revoke all on function public.community_comment_cleared() from public, anon, authenticated;

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
    'photos', c.photos,
    'tags', to_jsonb(c.tags),
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

-- The #tags of a post, checked against its text: lower case, at most 10, each written in the text.
-- A spoiler keeps none, so a tag can never reveal what happens.
create function public.community_clean_tags(p_tags text[], p_body text, p_spoiler text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case when p_spoiler <> 'none' then '{}'::text[] else coalesce((
    select array_agg(distinct t) from (
      select lower(x) as t from unnest(coalesce(p_tags, '{}')) as x
    ) tags
    where t ~ '^[^[:space:]#]{2,30}$'
      and position('#' || t in lower(coalesce(p_body, ''))) > 0
  ), '{}'::text[]) end;
$$;
revoke all on function public.community_clean_tags(text[], text, text) from public, anon, authenticated;

-- The photos of a post: at most 4, each a file of the author's own folder, used once.
create function public.community_clean_photos(p_photos jsonb, p_author uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  photos jsonb := coalesce(p_photos, '[]'::jsonb);
  photo jsonb;
  cleaned jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(photos) <> 'array' or jsonb_array_length(photos) > 4 then
    raise exception 'invalid_photos' using errcode = '22023';
  end if;
  for photo in select * from jsonb_array_elements(photos) loop
    if jsonb_typeof(photo) <> 'object'
       or coalesce(photo ->> 'path', '') !~ ('^' || p_author::text || '/[0-9a-f-]{36}\.(webp|jpg)$')
       or coalesce(photo ->> 'w', '') !~ '^[0-9]{1,4}$' or coalesce(photo ->> 'h', '') !~ '^[0-9]{1,4}$'
       or (photo ->> 'w')::integer not between 1 and 4000 or (photo ->> 'h')::integer not between 1 and 4000
       or cleaned @> jsonb_build_array(jsonb_build_object('path', photo ->> 'path'))
       or exists (
         select 1 from public.community_comments c
         where c.author_id = p_author
           and c.photos @> jsonb_build_array(jsonb_build_object('path', photo ->> 'path'))
       ) then
      raise exception 'invalid_photos' using errcode = '22023';
    end if;
    cleaned := cleaned || jsonb_build_array(jsonb_build_object(
      'path', photo ->> 'path', 'w', (photo ->> 'w')::integer, 'h', (photo ->> 'h')::integer
    ));
  end loop;
  return cleaned;
end;
$$;
revoke all on function public.community_clean_photos(jsonb, uuid) from public, anon, authenticated;

-- ---------- Publishing: a post, a reply or a recommendation ----------
-- A top-level post shows its author's score for the episode or work. A recommendation may set it.
create function public.community_publish(
  p_target uuid, p_parent uuid, p_kind text, p_body text, p_spoiler text, p_score integer,
  p_tags text[], p_photos jsonb
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
  photos jsonb;
  max_length integer;
  created public.community_comments;
begin
  if not exists (select 1 from public.profiles where user_id = caller_id) then
    raise exception 'username_required' using errcode = 'P0001';
  end if;
  if coalesce(p_kind, '') not in ('debrief', 'reco') then
    raise exception 'invalid_action' using errcode = '22023';
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
    if not found or parent.target_id <> p_target or parent.parent_id is not null or parent.deleted_at is not null
       or p_kind <> 'debrief' then
      raise exception 'invalid_parent' using errcode = '22023';
    end if;
  end if;
  if p_kind = 'reco' and (target.episode is not null or p_spoiler = 'later') then
    raise exception 'invalid_parent' using errcode = '22023';
  end if;
  if p_score is not null and (p_kind <> 'reco' or p_score not between 1 and 10) then
    raise exception 'invalid_score' using errcode = '22023';
  end if;
  photos := public.community_clean_photos(p_photos, caller_id);
  max_length := case when p_kind = 'reco' then 500 else 2000 end;
  if char_length(clean) > max_length or (char_length(clean) = 0 and jsonb_array_length(photos) = 0) then
    raise exception 'invalid_body' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('community_post:' || caller_id::text));
  -- The same text sent twice in a row is one post.
  if jsonb_array_length(photos) = 0 then
    select * into created from public.community_comments
    where author_id = caller_id and target_id = p_target and parent_id is not distinct from p_parent
      and kind = p_kind and body = clean and deleted_at is null and created_at > now() - interval '30 seconds'
    order by created_at desc limit 1;
    if found then
      return public.community_comment_json(created) || jsonb_build_object('replyCount', 0, 'replies', '[]'::jsonb);
    end if;
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
  insert into public.community_comments (target_id, parent_id, author_id, body, spoiler, show_rating, kind, photos, tags)
  values (p_target, p_parent, caller_id, clean, p_spoiler, p_parent is null, p_kind, photos,
          public.community_clean_tags(p_tags, clean, p_spoiler))
  returning * into created;
  return public.community_comment_json(created) || jsonb_build_object('replyCount', 0, 'replies', '[]'::jsonb);
end;
$$;

-- Editing changes the text, the spoiler level and the tags; photos stay as they were posted.
create function public.community_edit_post(p_comment uuid, p_body text, p_spoiler text, p_tags text[])
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
  max_length integer;
  updated public.community_comments;
begin
  select * into existing from public.community_comments where id = p_comment;
  if not found or existing.author_id is distinct from caller_id or existing.deleted_at is not null then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  max_length := case when existing.kind = 'reco' then 500 else 2000 end;
  if char_length(clean) > max_length or (char_length(clean) = 0 and jsonb_array_length(existing.photos) = 0) then
    raise exception 'invalid_body' using errcode = '22023';
  end if;
  select * into target from public.community_targets where id = existing.target_id;
  if coalesce(p_spoiler, '') not in ('none', 'episode', 'later') or (target.episode is null and p_spoiler = 'later') then
    raise exception 'invalid_spoiler' using errcode = '22023';
  end if;
  update public.community_comments
  set body = clean, spoiler = p_spoiler, tags = public.community_clean_tags(p_tags, clean, p_spoiler), edited_at = now()
  where id = p_comment
  returning * into updated;
  return public.community_comment_json(updated);
end;
$$;

-- ---------- The timeline ----------
-- Like community_feed, with a #tag filter. While protection is on, a spoiler's text and photos stay
-- in the database (only how many photos there are is said); community_reveal sends them when wanted.
create function public.community_timeline(
  p_kind text, p_tag text, p_works jsonb, p_offset integer, p_limit integer
)
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
  tag text := nullif(lower(btrim(coalesce(p_tag, ''))), '');
  show_spoilers boolean := not coalesce((
    select spoiler_protection from public.community_prefs where user_id = caller_id
  ), true);
  items jsonb;
begin
  if p_kind is not null and p_kind not in ('anime', 'manga', 'series', 'film') then
    raise exception 'invalid_kind' using errcode = '22023';
  end if;
  if tag is not null and tag !~ '^[^[:space:]#]{2,30}$' then
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
    where c.parent_id is null and c.deleted_at is null
      and (p_kind is null or t.kind = p_kind)
      and (tag is null or c.tags @> array[tag])
  ),
  page as (
    select p.id, p.in_list, row_number() over (
      order by (p.in_list and p.created_at > now() - interval '14 days') desc, p.created_at desc, p.id
    ) as position
    from posts p
  )
  select coalesce(jsonb_agg(
    (public.community_comment_json(c) - 'body' - 'photos' - 'parentId') || jsonb_build_object(
      'body', case when c.spoiler = 'none' or show_spoilers then c.body end,
      'photos', case when c.spoiler = 'none' or show_spoilers then c.photos else '[]'::jsonb end,
      'photoCount', jsonb_array_length(c.photos),
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

-- The text and photos of spoilers the member has seen or chooses to show.
create function public.community_reveal(p_ids uuid[])
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
    select jsonb_object_agg(c.id, jsonb_build_object('body', c.body, 'photos', c.photos))
    from public.community_comments c
    where c.id = any (p_ids) and c.deleted_at is null
  ), '{}'::jsonb);
end;
$$;

-- "Tendances": the #tags used by the most members this week (at least 2 members each).
create function public.community_trending(p_limit integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.community_require_member();
  return coalesce((
    select jsonb_agg(jsonb_build_object('tag', x.tag, 'posts', x.posts, 'members', x.members)
                     order by x.members desc, x.posts desc, x.tag)
    from (
      select t.tag, count(*) as posts, count(distinct c.author_id) as members
      from public.community_comments c, unnest(c.tags) as t(tag)
      where c.parent_id is null and c.deleted_at is null and c.spoiler = 'none'
        and c.created_at > now() - interval '7 days'
      group by t.tag
      having count(distinct c.author_id) >= 2
      order by count(distinct c.author_id) desc, count(*) desc, t.tag
      limit least(greatest(coalesce(p_limit, 8), 1), 20)
    ) x
  ), '[]'::jsonb);
end;
$$;

-- ---------- Moderation: a reported post's photos are shown to the moderator ----------
create or replace function public.community_moderation_queue()
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
        'photos', c.photos,
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

-- ---------- Who may call what ----------
revoke all on function public.community_publish(uuid, uuid, text, text, text, integer, text[], jsonb) from public, anon;
revoke all on function public.community_edit_post(uuid, text, text, text[]) from public, anon;
revoke all on function public.community_timeline(text, text, jsonb, integer, integer) from public, anon;
revoke all on function public.community_reveal(uuid[]) from public, anon;
revoke all on function public.community_trending(integer) from public, anon;
grant execute on function
  public.community_publish(uuid, uuid, text, text, text, integer, text[], jsonb),
  public.community_edit_post(uuid, text, text, text[]),
  public.community_timeline(text, text, jsonb, integer, integer),
  public.community_reveal(uuid[]),
  public.community_trending(integer)
to authenticated;
