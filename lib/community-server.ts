// Server side of the community: a discussion opens only for a work (and episode) the catalog
// confirms, with the catalog's own title and poster. Server-only.
import type { SupabaseClient } from '@supabase/supabase-js';
import { CatalogFailure, catalogDetail, catalogJson, tmdbFetcher } from './catalog-server';
import { titleStatus } from './assistant/sources';
import { createSupabaseAdminClient } from './supabase/admin';
import type { Lang } from './i18n';
import {
  AVATAR_BUCKET,
  PHOTO_BUCKET,
  VIDEO_BUCKET,
  refProblem,
  type CommunitySource,
  type EpisodeGuide,
  type SeasonInfo,
  type Target,
  type TargetRef,
} from './community';

export type CommunityErrorKey =
  | 'badTarget'
  | 'notFound'
  | 'catalogDown'
  | 'unavailable'
  | 'username_required'
  | 'too_fast'
  | 'daily_limit'
  | 'banned'
  | 'not_allowed'
  | 'invalid_body'
  | 'invalid_spoiler'
  | 'invalid_parent'
  | 'invalid_score'
  | 'invalid_reaction'
  | 'invalid_report'
  | 'own_comment'
  | 'target_not_found'
  | 'comment_not_found'
  | 'invalid_action'
  | 'invalid_kind'
  | 'invalid_works'
  | 'invalid_photos'
  | 'invalid_video';
export class CommunityFailure extends Error {
  constructor(
    public key: CommunityErrorKey,
    public status: number,
  ) {
    super(key);
  }
}
const STATUS: Partial<Record<CommunityErrorKey, number>> = {
  username_required: 409,
  too_fast: 429,
  daily_limit: 429,
  banned: 403,
  not_allowed: 403,
  target_not_found: 404,
  comment_not_found: 404,
};
/** Turns a database rule ("raise exception 'too_fast'") into a failure the route can explain. */
export function fromDatabase(error: { message?: string; code?: string }): CommunityFailure | null {
  const key = (error.message || '') as CommunityErrorKey;
  const known: CommunityErrorKey[] = [
    'username_required',
    'too_fast',
    'daily_limit',
    'banned',
    'not_allowed',
    'invalid_body',
    'invalid_spoiler',
    'invalid_parent',
    'invalid_score',
    'invalid_reaction',
    'invalid_report',
    'own_comment',
    'target_not_found',
    'comment_not_found',
    'invalid_action',
    'invalid_kind',
    'invalid_works',
    'invalid_photos',
    'invalid_video',
  ];
  return known.includes(key) ? new CommunityFailure(key, STATUS[key] ?? 400) : null;
}

const POSTER =
  /^https:\/\/(media\.kitsu\.app|media\.kitsu\.io|cdn\.myanimelist\.net|static\.tvmaze\.com|images\.metahub\.space|m\.media-amazon\.com|image\.tmdb\.org)\//;

type Row = {
  id: string;
  kind: TargetRef['kind'];
  source: CommunitySource;
  source_id: string;
  season: number | null;
  episode: number | null;
  title: string;
  poster: string;
  backdrop: string;
  year: string;
};
const toTarget = (r: Row): Target => ({
  id: r.id,
  kind: r.kind,
  source: r.source,
  sourceId: r.source_id,
  season: r.season,
  episode: r.episode,
  title: r.title,
  poster: r.poster,
  backdrop: r.backdrop,
  year: r.year,
});

/** Seasons and their episode counts, from the series' own catalog; null when unavailable. */
export async function seriesSeasons(ref: TargetRef, lang: Lang): Promise<SeasonInfo[] | null> {
  const count = (pairs: { season: number; episode: number }[]) => {
    const map = new Map<number, number>();
    for (const p of pairs)
      if (Number.isInteger(p.season) && Number.isInteger(p.episode) && p.season >= 0 && p.episode > 0)
        map.set(p.season, Math.max(map.get(p.season) || 0, p.episode));
    return [...map].map(([season, episodes]) => ({ season, episodes })).sort((a, b) => a.season - b.season);
  };
  try {
    if (ref.source === 'tmdb') {
      const tmdb = tmdbFetcher(lang);
      if (!tmdb) return null;
      const show = await tmdb(`/tv/${ref.sourceId}`);
      return (Array.isArray(show?.seasons) ? show.seasons : [])
        .filter((s: { season_number?: number; episode_count?: number }) => (s.episode_count || 0) > 0)
        .map((s: { season_number: number; episode_count: number }) => ({
          season: s.season_number,
          episodes: s.episode_count,
        }));
    }
    if (ref.source === 'tvmaze') {
      const episodes = await catalogJson(`https://api.tvmaze.com/shows/${ref.sourceId}/episodes`);
      return count(
        (Array.isArray(episodes) ? episodes : []).map((e: { season: number; number: number }) => ({
          season: e.season,
          episode: e.number,
        })),
      );
    }
    if (ref.source === 'cinemeta') {
      const meta = (await catalogJson(`https://v3-cinemeta.strem.io/meta/series/${ref.sourceId}.json`))?.meta;
      return count(
        (Array.isArray(meta?.videos) ? meta.videos : []).map((v: { season: number; episode: number }) => ({
          season: v.season,
          episode: v.episode,
        })),
      );
    }
  } catch {
    // Unknown for now: the picker falls back to typing the season and episode.
  }
  return null;
}

async function detailOrFail(ref: TargetRef, lang: Lang) {
  try {
    return await catalogDetail(ref.kind, ref.source, ref.sourceId, lang);
  } catch (e) {
    if (e instanceof CatalogFailure && (e.key === 'notFound' || e.key === 'badReference'))
      throw new CommunityFailure('notFound', 404);
    throw new CommunityFailure('catalogDown', 503);
  }
}

/**
 * The discussion of a work or episode: the existing one, or a new one once the catalog confirms it.
 * `refresh` reads the catalog again (title, images, year), e.g. before a recommendation.
 */
export async function ensureTarget(
  supabase: SupabaseClient,
  ref: TargetRef,
  lang: Lang,
  refresh = false,
): Promise<Target> {
  if (refProblem(ref)) throw new CommunityFailure('badTarget', 400);
  let query = supabase
    .from('community_targets')
    .select('id, kind, source, source_id, season, episode, title, poster, backdrop, year')
    .eq('kind', ref.kind)
    .eq('source', ref.source)
    .eq('source_id', ref.sourceId);
  query = ref.season === null ? query.is('season', null) : query.eq('season', ref.season);
  query = ref.episode === null ? query.is('episode', null) : query.eq('episode', ref.episode);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(`Target read failed (${error.code})`);
  if (data && !refresh) return toTarget(data as Row);

  const detail = await detailOrFail(ref, lang);
  if (ref.episode !== null && ref.kind === 'anime') {
    const total = detail.catalog.episodes;
    if (total && ref.episode > total) throw new CommunityFailure('notFound', 404);
  }
  if (ref.episode !== null && ref.kind === 'series') {
    const seasons = await seriesSeasons(ref, lang);
    const season = seasons?.find((s) => s.season === ref.season);
    if (seasons?.length && (!season || ref.episode > season.episodes))
      throw new CommunityFailure('notFound', 404);
  }
  const admin = createSupabaseAdminClient();
  if (!admin) throw new CommunityFailure('unavailable', 503);
  const title = detail.title.trim().slice(0, 180) || ref.sourceId;
  const poster = POSTER.test(detail.poster) ? detail.poster : '';
  const backdrop = detail.backdrop && POSTER.test(detail.backdrop) ? detail.backdrop : '';
  const year = (detail.catalog.year || '').trim().slice(0, 12);
  const { data: id, error: saveError } = await admin.rpc('community_ensure_target', {
    p_kind: ref.kind,
    p_source: ref.source,
    p_source_id: ref.sourceId,
    p_season: ref.season,
    p_episode: ref.episode,
    p_title: title,
    p_poster: poster,
    p_backdrop: backdrop,
    p_year: year,
  });
  if (saveError || typeof id !== 'string') throw new Error(`Target save failed (${saveError?.code})`);
  return { id, ...ref, title, poster, backdrop, year };
}

export type PostFiles = { photos: string[]; videos: string[] };

/** The files of a post (photos, video and its preview), read before it is deleted so they can go too. */
export async function filesOfPost(commentId: string): Promise<PostFiles> {
  const admin = createSupabaseAdminClient();
  if (!admin) return { photos: [], videos: [] };
  const { data } = await admin
    .from('community_comments')
    .select('photos, video')
    .eq('id', commentId)
    .maybeSingle();
  const text = (v: unknown): v is string => typeof v === 'string';
  const photos = ((data?.photos ?? []) as { path?: unknown }[]).map((p) => p.path).filter(text);
  const video = (data?.video ?? null) as { path?: unknown; poster?: unknown } | null;
  return {
    photos: [...photos, video?.poster].filter(text),
    videos: [video?.path].filter(text),
  };
}

/** Deletes files. A failure only leaves an unused file behind, so it never blocks the action. */
export async function removeFiles(bucket: string, paths: string[]) {
  if (!paths.length) return;
  const admin = createSupabaseAdminClient();
  const { error } = (await admin?.storage.from(bucket).remove(paths)) ?? { error: null };
  if (error) console.error('community_file_remove_failed', bucket, error.message);
}
export async function removePostFiles(files: PostFiles) {
  await Promise.all([removeFiles(PHOTO_BUCKET, files.photos), removeFiles(VIDEO_BUCKET, files.videos)]);
}
export const removeAvatarFile = (path: string | null | undefined) =>
  path ? removeFiles(AVATAR_BUCKET, [path]) : Promise.resolve();

/**
 * Every file of a member (photos, videos, profile photo), before their account is deleted:
 * Supabase refuses to delete an account that still owns files.
 */
export async function removeMemberFiles(userId: string) {
  const admin = createSupabaseAdminClient();
  if (!admin) return;
  for (const name of [PHOTO_BUCKET, VIDEO_BUCKET, AVATAR_BUCKET]) {
    const bucket = admin.storage.from(name);
    for (let round = 0; round < 50; round++) {
      const { data, error } = await bucket.list(userId, { limit: 100 });
      if (error) throw new Error(`File list failed (${name}: ${error.message})`);
      if (!data?.length) break;
      const { error: removeError } = await bucket.remove(data.map((f) => `${userId}/${f.name}`));
      if (removeError) throw new Error(`File removal failed (${name}: ${removeError.message})`);
    }
  }
}

/** What the episode picker can offer: a number for anime, seasons for series, nothing for the rest. */
export async function episodeGuide(ref: TargetRef, lang: Lang): Promise<EpisodeGuide> {
  if (ref.kind === 'film' || ref.kind === 'manga') return { mode: 'single' };
  if (ref.kind === 'series') return { mode: 'seasons', seasons: (await seriesSeasons(ref, lang)) || [] };
  const detail = await detailOrFail(ref, lang);
  let released = detail.catalog.available;
  try {
    const status = await titleStatus(
      { kind: 'anime', title: detail.title, catalog: { source: ref.source, id: ref.sourceId } },
      lang,
    );
    released = status.released ?? released;
  } catch {
    // AniList unavailable: the catalog count is enough.
  }
  return { mode: 'absolute', total: detail.catalog.episodes, released };
}
