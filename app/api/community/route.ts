import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { langFromRequest, messages, type Lang } from '@/lib/i18n';
import { errorResponse, sameOrigin } from '@/lib/server';
import { CommunityFailure, ensureTarget, episodeGuide, fromDatabase } from '@/lib/community-server';
import type { TargetRef } from '@/lib/community';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };

const uuid = z.string().uuid();
const refSchema = z.object({
  kind: z.enum(['anime', 'manga', 'series', 'film']),
  source: z.enum(['kitsu', 'jikan', 'tmdb', 'tvmaze', 'cinemeta']),
  sourceId: z.string().max(20),
  season: z.coerce.number().int().nullable(),
  episode: z.coerce.number().int().nullable(),
});
const spoiler = z.enum(['none', 'episode', 'later']);
const body = z.string().max(4000);
const kind = z.enum(['anime', 'manga', 'series', 'film']);
const works = z.array(refSchema.pick({ kind: true, source: true, sourceId: true })).max(300);
const action = z.discriminatedUnion('op', [
  z.object({ op: z.literal('rate'), target: uuid, score: z.number().int().min(1).max(10).nullable() }),
  z.object({
    op: z.literal('comment'),
    target: uuid,
    parent: uuid.nullable(),
    body,
    spoiler,
    showRating: z.boolean(),
  }),
  z.object({ op: z.literal('edit'), comment: uuid, body, spoiler, showRating: z.boolean() }),
  z.object({ op: z.literal('delete'), comment: uuid }),
  z.object({
    op: z.literal('react'),
    comment: uuid,
    reaction: z.enum(['heart', 'fire', 'laugh', 'cry', 'mind']).nullable(),
  }),
  z.object({
    op: z.literal('report'),
    comment: uuid,
    reason: z.enum(['spam', 'harassment', 'hate', 'spoiler', 'illegal', 'other']),
    details: z.string().max(500),
  }),
  z.object({
    op: z.literal('resolve'),
    comment: uuid,
    action: z.enum(['remove', 'dismiss']),
    ban: z.boolean(),
  }),
  z.object({
    op: z.literal('recommend'),
    work: refSchema.extend({ season: z.null(), episode: z.null() }),
    body: z.string().max(1000),
    spoiler: z.enum(['none', 'episode']),
    score: z.number().int().min(1).max(10).nullable(),
  }),
  z.object({
    op: z.literal('reactTarget'),
    target: uuid,
    reaction: z.enum(['fire', 'cry', 'mind', 'heart']).nullable(),
  }),
  z.object({ op: z.literal('prefs'), spoilerProtection: z.boolean() }),
  // Reads with a body: they carry the works of the member's list, which the server never stores.
  z.object({ op: z.literal('works'), works }),
  z.object({
    op: z.literal('feed'),
    kind: kind.nullable(),
    works,
    offset: z.number().int().min(0).max(2000),
  }),
  z.object({ op: z.literal('discover'), works }),
  z.object({ op: z.literal('bodies'), ids: z.array(uuid).max(50) }),
]);

function failure(e: unknown, lang: Lang) {
  if (e instanceof CommunityFailure)
    return Response.json({ error: messages[lang].community.errors[e.key] }, { status: e.status, headers });
  return errorResponse(e, lang);
}
/** Runs a database function; a rule it enforces comes back as an explained failure. */
async function call(supabase: Awaited<ReturnType<typeof requireUser>>['supabase'], fn: string, args: object) {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw fromDatabase(error) ?? new Error(`${fn} failed (${error.code})`);
  return data;
}
const readRef = (p: URLSearchParams): TargetRef =>
  refSchema.parse({
    kind: p.get('kind'),
    source: p.get('source'),
    sourceId: p.get('id'),
    season: p.get('season') || null,
    episode: p.get('episode') || null,
  });

export async function GET(request: Request) {
  const lang = langFromRequest(request);
  try {
    const { supabase } = await requireUser(lang);
    const p = new URL(request.url).searchParams;
    const op = p.get('op');
    if (op === 'target') {
      const target = await ensureTarget(supabase, readRef(p), lang);
      const [summary, prefs] = await Promise.all([
        call(supabase, 'community_summary', { p_target: target.id }),
        call(supabase, 'community_get_prefs', {}),
      ]);
      return Response.json({ target, summary, prefs }, { headers });
    }
    if (op === 'summary') {
      const summary = await call(supabase, 'community_summary', { p_target: uuid.parse(p.get('target')) });
      return Response.json(summary, { headers });
    }
    if (op === 'prefs') return Response.json(await call(supabase, 'community_get_prefs', {}), { headers });
    if (op === 'thread') {
      const thread = await call(supabase, 'community_thread', {
        p_target: uuid.parse(p.get('target')),
        p_sort: p.get('sort') === 'top' ? 'top' : 'recent',
        p_offset: z.coerce
          .number()
          .int()
          .min(0)
          .max(100000)
          .parse(p.get('offset') || 0),
        p_limit: 20,
      });
      return Response.json(thread, { headers });
    }
    if (op === 'guide') {
      const ref = readRef(p);
      const [guide, activity] = await Promise.all([
        episodeGuide(ref, lang),
        call(supabase, 'community_episode_activity', {
          p_kind: ref.kind,
          p_source: ref.source,
          p_source_id: ref.sourceId,
        }),
      ]);
      return Response.json({ guide, activity }, { headers });
    }
    if (op === 'recent') {
      const kind = p.get('kind');
      const recent = await call(supabase, 'community_recent', {
        p_kind: kind && ['anime', 'manga', 'series', 'film'].includes(kind) ? kind : null,
        p_offset: z.coerce
          .number()
          .int()
          .min(0)
          .max(2000)
          .parse(p.get('offset') || 0),
        p_limit: 20,
      });
      return Response.json(recent, { headers });
    }
    if (op === 'me') {
      const moderator = await call(supabase, 'community_is_moderator', {});
      return Response.json({ moderator: moderator === true }, { headers });
    }
    if (op === 'moderation') {
      return Response.json({ queue: await call(supabase, 'community_moderation_queue', {}) }, { headers });
    }
    return Response.json({ error: messages[lang].api.invalid }, { status: 400, headers });
  } catch (e) {
    return failure(e, lang);
  }
}

export async function POST(request: Request) {
  const lang = langFromRequest(request);
  try {
    sameOrigin(request, messages[lang].api.sameOrigin);
    const { supabase } = await requireUser(lang);
    const raw = await request.text();
    if (raw.length > 20000)
      return Response.json({ error: messages[lang].api.messageTooLong }, { status: 413, headers });
    const a = action.parse(JSON.parse(raw));
    let result: unknown = { ok: true };
    if (a.op === 'rate')
      result = await call(supabase, 'community_set_rating', { p_target: a.target, p_score: a.score });
    else if (a.op === 'comment')
      result = await call(supabase, 'community_add_comment', {
        p_target: a.target,
        p_parent: a.parent,
        p_body: a.body,
        p_spoiler: a.spoiler,
        p_show_rating: a.showRating,
      });
    else if (a.op === 'edit')
      result = await call(supabase, 'community_edit_comment', {
        p_comment: a.comment,
        p_body: a.body,
        p_spoiler: a.spoiler,
        p_show_rating: a.showRating,
      });
    else if (a.op === 'delete') await call(supabase, 'community_delete_comment', { p_comment: a.comment });
    else if (a.op === 'react')
      result = await call(supabase, 'community_react', { p_comment: a.comment, p_reaction: a.reaction });
    else if (a.op === 'report')
      await call(supabase, 'community_report', {
        p_comment: a.comment,
        p_reason: a.reason,
        p_details: a.details,
      });
    else if (a.op === 'recommend') {
      // The catalog is read again so the recommendation shows the work's current image and year.
      const target = await ensureTarget(supabase, a.work, lang, true);
      const post = await call(supabase, 'community_recommend', {
        p_target: target.id,
        p_body: a.body,
        p_spoiler: a.spoiler,
        p_score: a.score,
      });
      result = { post, target };
    } else if (a.op === 'reactTarget')
      result = await call(supabase, 'community_react_target', { p_target: a.target, p_reaction: a.reaction });
    else if (a.op === 'prefs')
      result = await call(supabase, 'community_set_prefs', { p_spoiler_protection: a.spoilerProtection });
    else if (a.op === 'works')
      result = await call(supabase, 'community_works_activity', { p_works: a.works });
    else if (a.op === 'feed')
      result = await call(supabase, 'community_feed', {
        p_kind: a.kind,
        p_works: a.works,
        p_offset: a.offset,
        p_limit: 20,
      });
    else if (a.op === 'discover')
      result = await call(supabase, 'community_discover', { p_works: a.works, p_limit: 4 });
    else if (a.op === 'bodies') result = await call(supabase, 'community_bodies', { p_ids: a.ids });
    else if (a.op === 'resolve')
      await call(supabase, 'community_resolve', { p_comment: a.comment, p_action: a.action, p_ban: a.ban });
    return Response.json(result, { headers });
  } catch (e) {
    return failure(e, lang);
  }
}
