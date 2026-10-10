// Community discussions: identity of a work or episode, its address, and spoiler rules.
// Pure and dependency-free (type imports only) so the browser, the server and the tests share it.
import type { Kind, Media } from './watch';

export type CommunitySource = 'kitsu' | 'jikan' | 'tmdb' | 'tvmaze' | 'cinemeta';
/** A work (season and episode null) or one of its episodes, as the catalog identifies it. */
export type TargetRef = {
  kind: Kind;
  source: CommunitySource;
  sourceId: string;
  season: number | null;
  episode: number | null;
};
export type Target = TargetRef & {
  id: string;
  title: string;
  poster: string;
  backdrop: string;
  year: string;
};
export type Spoiler = 'none' | 'episode' | 'later';
export type Reaction = 'heart' | 'fire' | 'laugh' | 'cry' | 'mind';
export const REACTIONS: { key: Reaction; emoji: string }[] = [
  { key: 'heart', emoji: '❤️' },
  { key: 'fire', emoji: '🔥' },
  { key: 'laugh', emoji: '😂' },
  { key: 'cry', emoji: '😭' },
  { key: 'mind', emoji: '🤯' },
];
/** "Ta réaction" to an episode or a work: one per member. */
export type TargetReaction = 'fire' | 'cry' | 'mind' | 'heart';
export const TARGET_REACTIONS: { key: TargetReaction; emoji: string }[] = [
  { key: 'fire', emoji: '🔥' },
  { key: 'cry', emoji: '😭' },
  { key: 'mind', emoji: '🤯' },
  { key: 'heart', emoji: '❤️' },
];
export const RECO_MAX = 500;
export const POST_MAX = 2000;
export const PHOTOS_MAX = 4;
export const PHOTO_BUCKET = 'community-photos';
export const VIDEO_BUCKET = 'community-videos';
export const AVATAR_BUCKET = 'avatars';
export const VIDEO_MAX_BYTES = 100 * 1024 * 1024;
export const VIDEO_MAX_SECONDS = 120;
/** A photo of a post, in the member's own folder of the photo bucket. */
export type Photo = { path: string; w: number; h: number };
/** A post's video, its preview image (in the photo bucket), size and length in seconds. */
export type Video = { path: string; poster: string; w: number; h: number; duration: number };
export type Debrief = {
  id: string;
  parentId: string | null;
  /** A débrief, or a recommendation of a whole work. */
  kind: 'debrief' | 'reco';
  username: string | null;
  mine: boolean;
  body: string;
  photos: Photo[];
  video?: Video | null;
  /** The author's profile photo, in the avatar bucket. */
  avatar?: string | null;
  tags: string[];
  spoiler: Spoiler;
  createdAt: string;
  edited: boolean;
  deleted: boolean;
  removed: boolean;
  showRating: boolean;
  rating: number | null;
  reactions: Partial<Record<Reaction, number>>;
  myReaction: Reaction | null;
  replyCount?: number;
  replies?: Debrief[];
};
export type Summary = {
  myScore: number | null;
  verdicts: number;
  average: number | null;
  histogram: number[] | null;
  debriefs: number;
  targetReactions: Partial<Record<TargetReaction, number>>;
  myTargetReaction: TargetReaction | null;
};
/** A post in the Communauté feed. A spoiler's body is null until the member may read it. */
export type FeedItem = Omit<Debrief, 'body' | 'parentId' | 'replies'> & {
  body: string | null;
  /** How many photos the post has, even while a spoiler's photos are not sent. */
  photoCount: number;
  /** Whether the post has a video, even while a spoiler's video is not sent. */
  hasVideo?: boolean;
  replyCount: number;
  inList: boolean;
  target: TargetRef & { title: string; poster: string; backdrop: string; year: string };
};
/** The most used reactions first, for a compact "🔥😭🤯 12". */
export function topReactions(counts: Partial<Record<Reaction, number>>, max = 3) {
  const used = REACTIONS.filter((r) => (counts[r.key] || 0) > 0).sort(
    (a, b) => (counts[b.key] || 0) - (counts[a.key] || 0),
  );
  return {
    emojis: used.slice(0, max).map((r) => r.emoji),
    total: used.reduce((n, r) => n + (counts[r.key] || 0), 0),
  };
}
/** The #tags written in a text: letters, digits and _, 2 to 30 long, at most 10, lower case. */
export function extractTags(text: string): string[] {
  const tags = new Set<string>();
  for (const m of text.matchAll(/(^|[^\p{L}\p{N}_#&])#([\p{L}\p{N}_]{2,30})(?![\p{L}\p{N}_])/gu)) {
    tags.add(m[2].toLocaleLowerCase('fr'));
    if (tags.size === 10) break;
  }
  return [...tags];
}

/** A text cut into plain parts and #tags, to make the tags clickable. */
export function splitTags(text: string): ({ text: string } | { tag: string; text: string })[] {
  const parts: ({ text: string } | { tag: string; text: string })[] = [];
  let last = 0;
  for (const m of text.matchAll(/(^|[^\p{L}\p{N}_#&])#([\p{L}\p{N}_]{2,30})(?![\p{L}\p{N}_])/gu)) {
    const start = (m.index ?? 0) + m[1].length;
    if (start > last) parts.push({ text: text.slice(last, start) });
    parts.push({ tag: m[2].toLocaleLowerCase('fr'), text: `#${m[2]}` });
    last = start + 1 + m[2].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

/** The public address of a post's photo. */
export function photoUrl(supabaseUrl: string, path: string, bucket = PHOTO_BUCKET): string {
  return `${supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/public/${bucket}/${path}`;
}

export type SeasonInfo = { season: number; episodes: number };
/** What the episode picker can offer for a work. */
export type EpisodeGuide =
  | { mode: 'single' }
  | { mode: 'absolute'; total: number | null; released: number | null }
  | { mode: 'seasons'; seasons: SeasonInfo[] };

const SOURCES: Record<Kind, CommunitySource[]> = {
  anime: ['kitsu', 'jikan'],
  manga: ['kitsu', 'jikan'],
  series: ['tmdb', 'tvmaze', 'cinemeta'],
  film: ['tmdb', 'cinemeta'],
};
const int = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? v : null);

/** The reason a reference is not a valid discussion, or null. Same rules as the database. */
export function refProblem(ref: Partial<TargetRef>): string | null {
  const { kind, source, sourceId, season = null, episode = null } = ref;
  if (!kind || !(kind in SOURCES)) return 'kind';
  if (!source || !SOURCES[kind].includes(source)) return 'source';
  if (typeof sourceId !== 'string' || !(source === 'cinemeta' ? /^tt\d{1,12}$/ : /^\d{1,12}$/).test(sourceId))
    return 'id';
  if (season !== null && (int(season) === null || season < 0 || season > 500)) return 'season';
  if (episode !== null && (int(episode) === null || episode < 1 || episode > 10000)) return 'episode';
  if (episode === null) return season === null ? null : 'season';
  if (kind === 'anime') return season === null ? null : 'season';
  if (kind === 'series') return season === null ? 'season' : null;
  // Films and manga: whole-work discussions only for now.
  return 'episode';
}

const SLUG: Record<Kind, string> = { anime: 'anime', manga: 'manga', series: 'serie', film: 'film' };
const KIND_OF_SLUG: Record<string, Kind> = { anime: 'anime', manga: 'manga', serie: 'series', film: 'film' };

/** The discussion's own address, e.g. /oeuvre/anime/kitsu/12/episode/1151. */
export function refPath(ref: TargetRef): string {
  const base = `/oeuvre/${SLUG[ref.kind]}/${ref.source}/${ref.sourceId}`;
  if (ref.episode === null) return base;
  return ref.kind === 'series'
    ? `${base}/saison/${ref.season}/episode/${ref.episode}`
    : `${base}/episode/${ref.episode}`;
}

export function parseRefPath(pathname: string): TargetRef | null {
  const parts = pathname.replace(/\/+$/, '').split('/').filter(Boolean);
  if (parts[0] !== 'oeuvre' || parts.length < 4) return null;
  const kind = KIND_OF_SLUG[parts[1]];
  if (!kind) return null;
  const rest = parts.slice(4);
  let season: number | null = null;
  let episode: number | null = null;
  const num = (s: string | undefined) => (s && /^\d{1,5}$/.test(s) ? Number(s) : NaN);
  if (rest.length === 2 && rest[0] === 'episode') episode = num(rest[1]);
  else if (rest.length === 4 && rest[0] === 'saison' && rest[2] === 'episode') {
    season = num(rest[1]);
    episode = num(rest[3]);
  } else if (rest.length) return null;
  if (Number.isNaN(season) || Number.isNaN(episode)) return null;
  const ref = { kind, source: parts[2] as CommunitySource, sourceId: parts[3], season, episode };
  return refProblem(ref) ? null : ref;
}

export const workOf = (ref: TargetRef): TargetRef => ({ ...ref, season: null, episode: null });
export const sameRef = (a: TargetRef, b: TargetRef) =>
  a.kind === b.kind &&
  a.source === b.source &&
  a.sourceId === b.sourceId &&
  a.season === b.season &&
  a.episode === b.episode;

/** The whole-work discussion of a title in a collection, when it comes from a supported catalog. */
export function refFromMedia(m: Pick<Media, 'kind' | 'catalog'>): TargetRef | null {
  if (!m.catalog) return null;
  const ref = {
    kind: m.kind,
    source: m.catalog.source as CommunitySource,
    sourceId: m.catalog.id,
    season: null,
    episode: null,
  };
  return refProblem(ref) ? null : ref;
}

/** Series episodes are counted across seasons in a collection: season 2 episode 3 may be episode 13. */
export function absoluteEpisode(season: number, episode: number, seasons: SeasonInfo[]): number | null {
  const current = seasons.find((s) => s.season === season);
  if (!current || episode > current.episodes) return null;
  return (
    seasons.filter((s) => s.season > 0 && s.season < season).reduce((n, s) => n + s.episodes, 0) + episode
  );
}

/**
 * Whether the viewer has seen this work or episode, from their own list only.
 * null = unknown (not in their list, or the numbering cannot be matched reliably).
 */
export function viewerSeen(ref: TargetRef, collection: Media[], seasons?: SeasonInfo[]): boolean | null {
  const media = collection.find(
    (m) => m.kind === ref.kind && m.catalog?.source === ref.source && m.catalog.id === ref.sourceId,
  );
  if (!media) return null;
  if (ref.episode === null)
    return media.status === 'completed' || (media.total > 0 && media.progress >= media.total);
  if (ref.kind === 'anime') return media.progress >= ref.episode;
  if (ref.kind === 'series' && ref.season !== null && seasons?.length) {
    const absolute = absoluteEpisode(ref.season, ref.episode, seasons);
    return absolute === null ? null : media.progress >= absolute;
  }
  return null;
}

/**
 * A spoiler is hidden unless it only spoils what the viewer has already seen, or the viewer
 * turned spoiler protection off.
 */
export function spoilerHidden(spoiler: Spoiler, seen: boolean | null, protection = true): boolean {
  if (spoiler === 'none' || !protection) return false;
  if (spoiler === 'episode') return seen !== true;
  return true;
}

/** Whether a title of the catalog is already in the collection. */
export const inCollection = (ref: Pick<TargetRef, 'kind' | 'source' | 'sourceId'>, collection: Media[]) =>
  collection.some(
    (m) => m.kind === ref.kind && m.catalog?.source === ref.source && m.catalog.id === ref.sourceId,
  );

/** Same deterministic color for a username everywhere. */
export function usernameHue(username: string): number {
  let h = 7;
  for (const ch of username) h = (h * 31 + (ch.codePointAt(0) || 0)) >>> 0;
  return h % 360;
}
