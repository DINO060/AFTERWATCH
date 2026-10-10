-- Profile photos, and short videos in posts (2 minutes, 100 MB, one per post, with or without photos).
-- Videos above 50 MB need the Supabase Pro plan, with its upload limit raised to 100 MB.
-- Run once in the SQL Editor, after 202610110001_community_threads.sql.
-- Additive: the earlier functions keep working while the new site is being deployed.

-- ---------- Storage: one folder per member in each space ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('avatars', 'avatars', true, 1048576, array['image/webp', 'image/jpeg']),
  ('community-videos', 'community-videos', true, 104857600, array['video/mp4', 'video/webm'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy "Members add their profile photo" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(webp|jpg)$'
  );
create policy "Members add videos to their own folder" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'community-videos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(mp4|webm)$'
  );
create policy "Members see their own profile photos and videos" on storage.objects
  for select to authenticated
  using (bucket_id in ('avatars', 'community-videos') and owner_id = (select auth.uid())::text);
create policy "Members delete their own profile photos and videos" on storage.objects
  for delete to authenticated
  using (bucket_id in ('avatars', 'community-videos') and owner_id = (select auth.uid())::text);

-- ---------- Profile photo ----------
alter table public.profiles
  add column avatar_path text check (
    avatar_path is null or avatar_path ~ ('^' || user_id::text || '/[0-9a-f-]{36}\.(webp|jpg)$')
  );
grant select (avatar_path) on table public.profiles to authenticated;
grant select on table public.profiles to service_role;

-- Sets or removes the caller's profile photo; returns the previous one so its file can be deleted.
create function public.set_avatar(p_path text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  previous text;
begin
  if caller_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_path is not null and p_path !~ ('^' || caller_id::text || '/[0-9a-f-]{36}\.(webp|jpg)$') then
    raise exception 'invalid_avatar' using errcode = '22023';
  end if;
  select avatar_path into previous from public.profiles where user_id = caller_id for update;
  if not found then
    raise exception 'username_required' using errcode = 'P0001';
  end if;
  update public.profiles set avatar_path = p_path where user_id = caller_id;
  return jsonb_build_object('avatar', p_path, 'previous', previous);
end;
$$;
revoke all on function public.set_avatar(text) from public, anon, authenticated;
grant execute on function public.set_avatar(text) to authenticated;

-- A moderator removes the profile photo of a reported post's author.
create function public.community_remove_avatar(p_comment uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  author uuid;
  previous text;
begin
  if not public.community_is_moderator() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  select author_id into author from public.community_comments where id = p_comment;
  if author is null then
    raise exception 'comment_not_found' using errcode = 'P0002';
  end if;
  select avatar_path into previous from public.profiles where user_id = author for update;
  update public.profiles set avatar_path = null where user_id = author;
  return previous;
end;
$$;
revoke all on function public.community_remove_avatar(uuid) from public, anon, authenticated;
grant execute on function public.community_remove_avatar(uuid) to authenticated;

-- ---------- Posts: one video, alongside up to 4 photos ----------
alter table public.community_comments
  add column video jsonb check (video is null or jsonb_typeof(video) = 'object');
alter table public.community_comments drop constraint community_comments_content;
alter table public.community_comments add constraint community_comments_content check (
  (
    deleted_at is null and char_length(body) <= 2000
    and (char_length(body) >= 1 or jsonb_array_length(photos) > 0 or video is not null)
  )
  or (deleted_at is not null and body = '')
);

create or replace function public.community_comment_cleared()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.deleted_at is not null then
    new.photos := '[]'::jsonb;
    new.video := null;
    new.tags := '{}';
  end if;
  return new;
end;
$$;

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
    'username', p.username,
    'avatar', p.avatar_path,
    'mine', c.author_id is not null and c.author_id = auth.uid(),
    'body', c.body,
    'photos', c.photos,
    'video', c.video,
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
  )
  from (select 1) one
  left join public.profiles p on p.user_id = c.author_id;
$$;

-- A post's video: a file of the author's own folder, its preview image, size and length (2 min).
create function public.community_clean_video(p_video jsonb, p_author uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  duration numeric;
begin
  if p_video is null or p_video = 'null'::jsonb then
    return null;
  end if;
  if jsonb_typeof(p_video) <> 'object'
     or coalesce(p_video ->> 'path', '') !~ ('^' || p_author::text || '/[0-9a-f-]{36}\.(mp4|webm)$')
     or coalesce(p_video ->> 'poster', '') !~ ('^' || p_author::text || '/[0-9a-f-]{36}\.(webp|jpg)$')
     or coalesce(p_video ->> 'w', '') !~ '^[0-9]{1,4}$' or coalesce(p_video ->> 'h', '') !~ '^[0-9]{1,4}$'
     or coalesce(p_video ->> 'duration', '') !~ '^[0-9]{1,3}(\.[0-9]+)?$' then
    raise exception 'invalid_video' using errcode = '22023';
  end if;
  duration := (p_video ->> 'duration')::numeric;
  if (p_video ->> 'w')::integer not between 1 and 4000 or (p_video ->> 'h')::integer not between 1 and 4000
     or duration <= 0 or duration > 121
     or exists (
       select 1 from public.community_comments c
       where c.author_id = p_author and c.video ->> 'path' = p_video ->> 'path'
     ) then
    raise exception 'invalid_video' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'path', p_video ->> 'path', 'poster', p_video ->> 'poster',
    'w', (p_video ->> 'w')::integer, 'h', (p_video ->> 'h')::integer, 'duration', round(duration, 1)
  );
end;
$$;
revoke all on function public.community_clean_video(jsonb, uuid) from public, anon, authenticated;

-- Publishing, as community_publish, with a video: up to 4 photos and one video in the same post.
create function public.community_post(
  p_target uuid, p_parent uuid, p_kind text, p_body text, p_spoiler text, p_score integer,
  p_tags text[], p_photos jsonb, p_video jsonb
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
  new_photos jsonb;
  new_video jsonb;
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
  new_photos := public.community_clean_photos(p_photos, caller_id);
  new_video := public.community_clean_video(p_video, caller_id);
  max_length := case when p_kind = 'reco' then 500 else 2000 end;
  if char_length(clean) > max_length
     or (char_length(clean) = 0 and jsonb_array_length(new_photos) = 0 and new_video is null) then
    raise exception 'invalid_body' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('community_post:' || caller_id::text));
  -- The same text sent twice in a row is one post.
  if jsonb_array_length(new_photos) = 0 and new_video is null then
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
  -- Videos weigh much more than photos: at most 5 a day per member.
  if new_video is not null and (select count(*) from public.community_comments c
      where c.author_id = caller_id and c.video is not null and created_at > now() - interval '1 day') >= 5 then
    raise exception 'daily_limit' using errcode = 'P0001';
  end if;
  if p_score is not null then
    insert into public.community_ratings (target_id, user_id, score)
    values (p_target, caller_id, p_score)
    on conflict (target_id, user_id) do update set score = excluded.score, updated_at = now();
  end if;
  insert into public.community_comments (target_id, parent_id, author_id, body, spoiler, show_rating, kind, photos, video, tags)
  values (p_target, p_parent, caller_id, clean, p_spoiler, p_parent is null, p_kind, new_photos, new_video,
          public.community_clean_tags(p_tags, clean, p_spoiler))
  returning * into created;
  return public.community_comment_json(created) || jsonb_build_object('replyCount', 0, 'replies', '[]'::jsonb);
end;
$$;

-- The timeline, now also keeping a spoiler's video in the database until it is wanted.
create or replace function public.community_timeline(
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
    (public.community_comment_json(c) - 'body' - 'photos' - 'video' - 'parentId') || jsonb_build_object(
      'body', case when c.spoiler = 'none' or show_spoilers then c.body end,
      'photos', case when c.spoiler = 'none' or show_spoilers then c.photos else '[]'::jsonb end,
      'video', case when c.spoiler = 'none' or show_spoilers then c.video end,
      'photoCount', jsonb_array_length(c.photos),
      'hasVideo', c.video is not null,
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

create or replace function public.community_reveal(p_ids uuid[])
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
    select jsonb_object_agg(c.id, jsonb_build_object('body', c.body, 'photos', c.photos, 'video', c.video))
    from public.community_comments c
    where c.id = any (p_ids) and c.deleted_at is null
  ), '{}'::jsonb);
end;
$$;

-- ---------- Moderation: a reported post's video and its author's profile photo ----------
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
        'video', c.video,
        'spoiler', c.spoiler,
        'createdAt', c.created_at,
        'author', (select p.username from public.profiles p where p.user_id = c.author_id),
        'authorAvatar', (select p.avatar_path from public.profiles p where p.user_id = c.author_id),
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
revoke all on function public.community_post(uuid, uuid, text, text, text, integer, text[], jsonb, jsonb) from public, anon;
grant execute on function public.community_post(uuid, uuid, text, text, text, integer, text[], jsonb, jsonb)
  to authenticated;
