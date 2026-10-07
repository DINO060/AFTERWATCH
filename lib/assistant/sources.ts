// Live release facts for the assistant: AniList for anime (matched by MyAnimeList id), TMDB and
// TVmaze for series, the catalog for the rest. Server-only. Public metadata only: no account data
// is sent to these services.
import { catalogJson, catalogDetail, tmdbFetcher } from '../catalog-server';
import type { CatalogInfo } from '../catalog';
import type { Lang } from '../i18n';
import type { Kind } from '../watch';

export type Release = { episode: number; at: number; dateOnly: boolean };
export type TitleStatus = {
  title: string;
  /** airing | finished | upcoming | hiatus | cancelled | unknown, or the source's own words. */
  status: string;
  /** Episodes (chapters for print) in all, when known. */
  total: number | null;
  /** Episodes out so far, when known. */
  released: number | null;
  next: Release | null;
  finale: (Release & { estimated: boolean }) | null;
  started: string | null;
  /** Known upcoming releases, for the planner. */
  upcoming: Release[];
};
type Target = { kind: Kind; title: string; catalog?: Pick<CatalogInfo, 'source' | 'id'> };

const WEEK = 7 * 24 * 3600 * 1000;
const memo = new Map<string, { until: number; value: any }>();
async function anilist(variables: Record<string, unknown>): Promise<any> {
  const cacheKey = JSON.stringify(variables);
  const old = memo.get(cacheKey);
  if (old && old.until > Date.now()) return old.value;
  const query = `query ($idMal: Int, $search: String) {
    Media(idMal: $idMal, search: $search, type: ANIME) {
      title { romaji english }
      status episodes
      startDate { year month day }
      endDate { year month day }
      nextAiringEpisode { episode airingAt }
      airingSchedule(notYetAired: true, perPage: 50) { nodes { episode airingAt } }
    }
  }`;
  const response = await fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(6000),
  });
  // 404 = no such title on AniList.
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`AniList ${response.status}`);
  const value = (await response.json())?.data?.Media || null;
  if (memo.size >= 200) memo.delete(memo.keys().next().value!);
  memo.set(cacheKey, { value, until: Date.now() + 10 * 60 * 1000 });
  return value;
}
const fuzzyDate = (d: any) =>
  d?.year
    ? [d.year, d.month, d.day]
        .filter(Boolean)
        .map((n, i) => (i ? String(n).padStart(2, '0') : n))
        .join('-')
    : null;
const anilistStatus: Record<string, string> = {
  RELEASING: 'airing',
  FINISHED: 'finished',
  NOT_YET_RELEASED: 'upcoming',
  HIATUS: 'hiatus',
  CANCELLED: 'cancelled',
};

async function malId(target: Target): Promise<number | null> {
  const { source, id } = target.catalog || {};
  if (source === 'jikan' && /^\d{1,9}$/.test(id || '')) return Number(id);
  if (source === 'kitsu' && /^\d{1,9}$/.test(id || '')) {
    const mapping = await catalogJson(
      `https://kitsu.app/api/edge/anime/${id}/mappings?filter[externalSite]=myanimelist/anime`,
    );
    const mal = Number(mapping?.data?.[0]?.attributes?.externalId);
    return Number.isInteger(mal) && mal > 0 ? mal : null;
  }
  return null;
}

async function animeStatus(target: Target, lang: Lang): Promise<TitleStatus> {
  let mal: number | null = null;
  try {
    mal = await malId(target);
  } catch {
    // Kitsu unavailable: fall back to a title search.
  }
  // New titles often have no MyAnimeList link on Kitsu yet: search AniList by the catalog title.
  let title = target.title.trim();
  if (!mal && !title && target.catalog)
    title = (await catalogDetail('anime', target.catalog.source, target.catalog.id, lang)).title;
  if (!mal && !title) return unknown(target.title);
  const media = await anilist(mal ? { idMal: mal } : { search: title.slice(0, 100) });
  if (!media) return unknown(target.title);
  const total: number | null = Number.isInteger(media.episodes) ? media.episodes : null;
  const upcoming: Release[] = (media.airingSchedule?.nodes || [])
    .filter((n: any) => Number.isInteger(n?.episode) && Number.isInteger(n?.airingAt))
    .map((n: any) => ({ episode: n.episode, at: n.airingAt * 1000, dateOnly: false }));
  const nextNode = media.nextAiringEpisode;
  const next: Release | null = nextNode
    ? { episode: nextNode.episode, at: nextNode.airingAt * 1000, dateOnly: false }
    : null;
  const released =
    media.status === 'FINISHED'
      ? total
      : next
        ? next.episode - 1
        : media.status === 'NOT_YET_RELEASED'
          ? 0
          : null;
  let finale: TitleStatus['finale'] = null;
  const last = total ? upcoming.find((u) => u.episode === total) : undefined;
  if (last) finale = { ...last, estimated: false };
  else if (total && next && total >= next.episode)
    finale = { episode: total, at: next.at + (total - next.episode) * WEEK, dateOnly: true, estimated: true };
  const ended = fuzzyDate(media.endDate);
  if (!finale && media.status === 'FINISHED' && ended && total)
    finale = { episode: total, at: Date.parse(`${ended}T12:00:00Z`) || 0, dateOnly: true, estimated: false };
  return {
    title: media.title?.english || media.title?.romaji || title,
    status: anilistStatus[media.status] || 'unknown',
    total,
    released,
    next,
    finale: finale && finale.at ? finale : null,
    started: fuzzyDate(media.startDate),
    upcoming,
  };
}

async function tmdbSeriesStatus(target: Target, id: string, lang: Lang): Promise<TitleStatus> {
  const tmdb = tmdbFetcher(lang);
  if (!tmdb) return unknown(target.title);
  const x = await tmdb(`/tv/${id}`);
  const seasons: any[] = Array.isArray(x?.seasons) ? x.seasons.filter((s: any) => s.season_number > 0) : [];
  // Episode numbers in a collection count across seasons.
  const absolute = (ep: any) =>
    seasons
      .filter((s) => s.season_number < ep.season_number)
      .reduce((n, s) => n + (Number(s.episode_count) || 0), 0) + Number(ep.episode_number);
  const date = (d: string) => Date.parse(`${d}T12:00:00Z`);
  const nextEp = x?.next_episode_to_air;
  const next: Release | null =
    nextEp?.air_date && date(nextEp.air_date)
      ? { episode: absolute(nextEp), at: date(nextEp.air_date), dateOnly: true }
      : null;
  const lastEp = x?.last_episode_to_air;
  const total = Number.isInteger(x?.number_of_episodes) ? x.number_of_episodes : null;
  const ended = x?.status === 'Ended' || x?.status === 'Canceled';
  return {
    title: String(x?.name || target.title),
    status:
      x?.status === 'Returning Series'
        ? next
          ? 'airing'
          : 'between seasons'
        : x?.status === 'Ended'
          ? 'finished'
          : x?.status === 'Canceled'
            ? 'cancelled'
            : x?.status === 'In Production' || x?.status === 'Planned'
              ? 'upcoming'
              : String(x?.status || 'unknown'),
    total,
    released: ended ? total : lastEp ? absolute(lastEp) : next ? next.episode - 1 : null,
    next,
    finale:
      ended && x?.last_air_date && total
        ? { episode: total, at: date(x.last_air_date), dateOnly: true, estimated: false }
        : null,
    started: x?.first_air_date || null,
    upcoming: next ? [next] : [],
  };
}

async function tvmazeStatus(target: Target, id: string): Promise<TitleStatus> {
  const x = await catalogJson(`https://api.tvmaze.com/shows/${id}?embed%5B%5D=episodes`);
  const episodes: any[] = (x?._embedded?.episodes || []).filter((e: any) => e.number !== null);
  const now = Date.now();
  const at = (e: any) => Date.parse(e.airstamp || '');
  const released = episodes.filter((e) => at(e) <= now).length;
  const upcoming: Release[] = episodes
    .map((e, i) => ({ episode: i + 1, at: at(e), dateOnly: false }))
    .filter((r) => r.at > now);
  const ended = x?.status === 'Ended';
  const total = episodes.length || null;
  const lastAt = episodes.length ? at(episodes[episodes.length - 1]) : NaN;
  return {
    title: String(x?.name || target.title),
    status: ended ? 'finished' : upcoming.length ? 'airing' : String(x?.status || 'unknown').toLowerCase(),
    total,
    released,
    next: upcoming[0] || null,
    finale:
      total && Number.isFinite(lastAt) && (ended || lastAt > now)
        ? { episode: total, at: lastAt, dateOnly: false, estimated: !ended }
        : null,
    started: x?.premiered || null,
    upcoming,
  };
}

const unknown = (title: string): TitleStatus => ({
  title,
  status: 'unknown',
  total: null,
  released: null,
  next: null,
  finale: null,
  started: null,
  upcoming: [],
});

/** Where a title stands today. Throws when every source is unreachable. */
export async function titleStatus(target: Target, lang: Lang): Promise<TitleStatus> {
  const { source, id } = target.catalog || {};
  if (target.kind === 'anime') return animeStatus(target, lang);
  if (target.kind === 'series' && source === 'tmdb' && /^\d{1,9}$/.test(id || ''))
    return tmdbSeriesStatus(target, id!, lang);
  if (target.kind === 'series' && source === 'tvmaze' && /^\d{1,9}$/.test(id || ''))
    return tvmazeStatus(target, id!);
  if (!source || !id) return unknown(target.title);
  // Print titles, films, and series from Cinemeta: what the catalog knows.
  const item = await catalogDetail(target.kind, source, id, lang);
  const info = item.catalog;
  const total = target.kind === 'manga' ? info.chapters : target.kind === 'film' ? 1 : info.episodes;
  return {
    title: item.title,
    status: info.releaseStatus || 'unknown',
    total: total ?? null,
    released: info.available,
    next: null,
    finale: null,
    started: item.startDate || info.year || null,
    upcoming: [],
  };
}
