-- The "Communauté" page: activity of the works in a member's list, and the latest débriefs.
-- Run once in the SQL Editor, after 202610080002_community.sql.

-- Débriefs per work (its own discussion and all its episodes), for the works the member asks about.
-- The member sends their own list; only public counts come back.
create function public.community_works_activity(p_works jsonb)
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
      'debriefs', w.debriefs, 'latestAt', w.latest_at
    ))
    from (
      select t.kind, t.source, t.source_id, count(c.id) as debriefs, max(c.created_at) as latest_at
      from jsonb_to_recordset(p_works) as r(kind text, source text, "sourceId" text)
      join public.community_targets t
        on t.kind = r.kind and t.source = r.source and t.source_id = r."sourceId"
      join public.community_comments c
        on c.target_id = t.id and c.deleted_at is null
      group by t.kind, t.source, t.source_id
    ) w
  ), '[]'::jsonb);
end;
$$;

-- The latest débriefs everywhere, newest first. A spoiler's text never leaves the database here:
-- the page shows that it is a spoiler and links to the discussion, where the usual rules apply.
create function public.community_recent(p_kind text, p_offset integer, p_limit integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  lim integer := least(greatest(coalesce(p_limit, 20), 1), 40);
  skip integer := least(greatest(coalesce(p_offset, 0), 0), 2000);
  items jsonb;
begin
  perform public.community_require_member();
  if p_kind is not null and p_kind not in ('anime', 'manga', 'series', 'film') then
    raise exception 'invalid_kind' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(
    (public.community_comment_json(c) - 'body' - 'mine' - 'myReaction' - 'parentId') || jsonb_build_object(
      'body', case when c.spoiler = 'none' then c.body end,
      'replyCount', (select count(*) from public.community_comments r where r.parent_id = c.id and r.deleted_at is null),
      'target', jsonb_build_object(
        'kind', t.kind, 'source', t.source, 'sourceId', t.source_id,
        'season', t.season, 'episode', t.episode, 'title', t.title, 'poster', t.poster
      )
    ) order by page.position
  ), '[]'::jsonb) into items
  from (
    select c.id, row_number() over (order by c.created_at desc, c.id) as position
    from public.community_comments c
    join public.community_targets t on t.id = c.target_id
    where c.parent_id is null and c.deleted_at is null and (p_kind is null or t.kind = p_kind)
    order by c.created_at desc, c.id
    offset skip limit lim + 1
  ) page
  join public.community_comments c on c.id = page.id
  join public.community_targets t on t.id = c.target_id;
  return jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(e.x order by e.i) from jsonb_array_elements(items) with ordinality as e(x, i) where e.i <= lim
    ), '[]'::jsonb),
    'hasMore', jsonb_array_length(items) > lim
  );
end;
$$;

revoke all on function public.community_works_activity(jsonb) from public, anon;
revoke all on function public.community_recent(text, integer, integer) from public, anon;
grant execute on function public.community_works_activity(jsonb), public.community_recent(text, integer, integer)
  to authenticated;
