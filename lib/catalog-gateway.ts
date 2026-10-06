import {
  normalizeJikan,
  normalizeKitsu,
  normalizeCinemeta,
  normalizeTVMaze,
  normalizeTmdb,
  type CatalogPage,
  type CatalogItem,
} from './catalog';
import type { Lang, Messages } from './i18n';
import type { Kind } from './watch';

export type CatalogErrorKey = keyof Messages['catalogErrors'];
/** `key` names the translated text; `message` keeps a text already translated by the server, if any. */
export class CatalogFailure extends Error {
  constructor(
    public key: CatalogErrorKey,
    public status = 503,
    message: string = key,
  ) {
    super(message);
  }
}
export type CatalogFetch = (url: string) => Promise<any>;
/** Server-only TMDB access: `path` like '/movie/popular'; the fetcher adds the key and language. */
export type TmdbFetch = (path: string, params?: Record<string, string>) => Promise<any>;
export type Feed = 'popular' | 'new' | 'airing' | 'upcoming' | 'top';
export const allFeeds: readonly Feed[] = ['popular', 'new', 'airing', 'upcoming', 'top'];
export type BrowseOptions = { feed?: Feed; tmdb?: TmdbFetch; lang?: Lang };

/** Feeds each catalog can serve; films and series gain "upcoming"/"airing" with TMDB. */
export function feedsFor(kind: Kind, tmdb: boolean): Feed[] {
  if (kind === 'anime') return ['popular', 'new', 'airing', 'upcoming', 'top'];
  if (kind === 'manga') return ['popular', 'airing', 'top'];
  if (kind === 'film') return tmdb ? ['popular', 'new', 'upcoming', 'top'] : ['popular', 'new', 'top'];
  return tmdb ? ['popular', 'new', 'airing', 'upcoming', 'top'] : ['popular', 'new', 'top'];
}

/** Anime season of a date, as Kitsu names it. */
export function currentSeason(date = new Date()) {
  const seasons = ['winter', 'spring', 'summer', 'fall'] as const;
  return { season: seasons[Math.floor(date.getUTCMonth() / 3)], year: date.getUTCFullYear() };
}
const day = (offset: number, from = new Date()) =>
  new Date(from.getTime() + offset * 86400000).toISOString().slice(0, 10);
const isAbort = (e: unknown) => e instanceof Error && e.name === 'AbortError';
/** TMDB TV genres left out of browsing lists: Talk (10767) and News (10763). */
const TV_NOISE = [10767, 10763];

/** Public metadata only. No account, saved list or API key is sent to these services. */
export async function browseWith(
  fetchJson: CatalogFetch,
  kind: Kind,
  query: string,
  page: number,
  options: BrowseOptions = {},
): Promise<CatalogPage> {
  const size = 20;
  const feed = options.feed ?? 'popular';
  if (!query && !feedsFor(kind, Boolean(options.tmdb)).includes(feed))
    throw new CatalogFailure('feedUnavailable', 400);

  if (kind === 'anime' || kind === 'manga') {
    try {
      const params = new URLSearchParams({
        'page[limit]': String(size),
        'page[offset]': String((page - 1) * size),
        include: 'categories',
      });
      if (query) params.set('filter[text]', query);
      else {
        params.set('sort', feed === 'top' ? '-averageRating' : '-userCount');
        if (feed === 'airing') params.set('filter[status]', 'current');
        if (feed === 'upcoming') params.set('filter[status]', 'upcoming,unreleased');
        if (feed === 'new') {
          const { season, year } = currentSeason();
          params.set('filter[season]', season);
          params.set('filter[seasonYear]', String(year));
        }
      }
      const data = await fetchJson(`https://kitsu.app/api/edge/${kind}?${params}`);
      if (!Array.isArray(data.data)) throw new CatalogFailure('badResponse');
      return {
        results: data.data
          .filter((x: any) => !x.attributes?.nsfw)
          .map((x: any) => normalizeKitsu(x, kind, data.included)),
        page,
        hasNext: !!data.links?.next,
        totalResults: data.meta?.count ?? null,
        source: 'Kitsu',
      };
    } catch (e) {
      if (isAbort(e)) throw e;
      const params = new URLSearchParams({ page: String(page), limit: String(size), sfw: 'true' });
      let path: string = `top/${kind}`;
      if (query) {
        path = kind;
        params.set('q', query);
      } else if (feed === 'new' && kind === 'anime') path = 'seasons/now';
      else {
        const filter =
          feed === 'popular'
            ? 'bypopularity'
            : feed === 'airing'
              ? kind === 'anime'
                ? 'airing'
                : 'publishing'
              : feed === 'upcoming'
                ? 'upcoming'
                : '';
        if (filter) params.set('filter', filter);
      }
      const data = await fetchJson(`https://api.jikan.moe/v4/${path}?${params}`);
      if (!Array.isArray(data.data)) throw new CatalogFailure('badResponse');
      return {
        results: data.data.map((x: any) => normalizeJikan(x, kind)),
        page,
        hasNext: !!data.pagination?.has_next_page,
        totalResults: data.pagination?.items?.total ?? null,
        source: 'Jikan / MyAnimeList',
      };
    }
  }

  if (options.tmdb) {
    try {
      return await browseTmdb(options.tmdb, kind, query, page, feed, options.lang);
    } catch (e) {
      // TMDB down or key refused: keep the catalog usable with the free sources when they can serve it.
      if (isAbort(e) || (!query && !feedsFor(kind, false).includes(feed))) throw e;
    }
  }

  if (kind === 'series' && query) {
    const data = await fetchJson(`https://api.tvmaze.com/search/shows?q=${encodeURIComponent(query)}`);
    if (!Array.isArray(data)) throw new CatalogFailure('badResponse');
    const matches = data.map((x: any) => normalizeTVMaze(x.show));
    return {
      results: matches.slice((page - 1) * size, page * size),
      page,
      hasNext: matches.length > page * size,
      totalResults: matches.length,
      source: 'TVmaze',
    };
  }

  // Cinemeta: films, and series without TMDB. Its catalogs page with `skip`.
  const type = kind === 'film' ? 'movie' : 'series';
  const skip = (page - 1) * size;
  const extras: string[] = [];
  let catalog = 'top';
  if (query) extras.push(`search=${encodeURIComponent(query)}`);
  else if (feed === 'new') {
    catalog = 'year';
    extras.push(`genre=${new Date().getUTCFullYear()}`);
  } else if (feed === 'top') catalog = 'imdbRating';
  if (!query && skip) extras.push(`skip=${skip}`);
  const data = await fetchJson(
    `https://v3-cinemeta.strem.io/catalog/${type}/${catalog}${extras.length ? `/${extras.join('&')}` : ''}.json`,
  );
  if (!Array.isArray(data.metas)) throw new CatalogFailure('badResponse');
  const all = data.metas.filter((x: any) => /^tt\d+$/.test(x.id) && x.type === type);
  return {
    results: (query ? all.slice(skip, skip + size) : all.slice(0, size)).map((x: any) =>
      normalizeCinemeta(x),
    ),
    page,
    hasNext: query ? all.length > skip + size : all.length > size,
    totalResults: query ? all.length : null,
    source: 'Cinemeta / IMDb',
  };
}

async function browseTmdb(
  tmdb: TmdbFetch,
  kind: Kind,
  query: string,
  page: number,
  feed: Feed,
  lang: Lang = 'en',
): Promise<CatalogPage> {
  const film = kind === 'film';
  const type = film ? 'movie' : 'tv';
  const params: Record<string, string> = { page: String(page) };
  let path: string;
  if (query) {
    path = `/search/${type}`;
    params.query = query;
    params.include_adult = 'false';
  } else if (film) {
    path = {
      popular: '/movie/popular',
      new: '/movie/now_playing',
      upcoming: '/movie/upcoming',
      top: '/movie/top_rated',
      airing: '/movie/now_playing',
    }[feed];
    if (feed === 'new' || feed === 'upcoming') params.region = lang === 'fr' ? 'FR' : 'US';
  } else if (feed === 'popular') path = '/tv/popular';
  else if (feed === 'airing') path = '/tv/on_the_air';
  else if (feed === 'top') path = '/tv/top_rated';
  else {
    path = '/discover/tv';
    params.sort_by = 'popularity.desc';
    if (feed === 'new') {
      params['first_air_date.gte'] = day(-90);
      params['first_air_date.lte'] = day(0);
    } else params['first_air_date.gte'] = day(1);
  }
  const [data, genres] = await Promise.all([
    tmdb(path, params),
    tmdb(`/genre/${type}/list`).catch(() => null),
  ]);
  if (!Array.isArray(data?.results)) throw new CatalogFailure('badResponse');
  const genreNames: Record<number, string> = Object.fromEntries(
    (genres?.genres || []).map((g: any) => [g.id, String(g.name)]),
  );
  const totalPages = Math.min(Number(data.total_pages) || 1, 500);
  return {
    // Talk shows and news fill TMDB's TV lists without being series people follow; search keeps them.
    results: data.results
      .filter((x: any) => film || query || !(x.genre_ids || []).some((g: number) => TV_NOISE.includes(g)))
      .map((x: any) => normalizeTmdb(x, film ? 'film' : 'series', genreNames)),
    page,
    hasNext: page < totalPages,
    totalResults: typeof data.total_results === 'number' ? data.total_results : null,
    source: 'TMDB',
  };
}

export async function detailWith(
  fetchJson: CatalogFetch,
  kind: Kind,
  source: string,
  id: string,
  options: BrowseOptions = {},
): Promise<CatalogItem> {
  if (source === 'kitsu' && (kind === 'anime' || kind === 'manga') && /^\d{1,9}$/.test(id)) {
    const data = await fetchJson(`https://kitsu.app/api/edge/${kind}/${id}?include=categories`);
    if (!data.data) throw new CatalogFailure('notFound', 404);
    return normalizeKitsu(data.data, kind, data.included);
  }
  if (source === 'jikan' && (kind === 'anime' || kind === 'manga') && /^\d{1,9}$/.test(id)) {
    const data = await fetchJson(`https://api.jikan.moe/v4/${kind}/${id}/full`);
    if (!data.data) throw new CatalogFailure('notFound', 404);
    return normalizeJikan(data.data, kind);
  }
  if (source === 'tvmaze' && kind === 'series' && /^\d{1,9}$/.test(id))
    return normalizeTVMaze(await fetchJson(`https://api.tvmaze.com/shows/${id}?embed=episodes`));
  if (source === 'cinemeta' && (kind === 'film' || kind === 'series') && /^tt\d{1,12}$/.test(id)) {
    const type = kind === 'film' ? 'movie' : 'series';
    const data = await fetchJson(`https://v3-cinemeta.strem.io/meta/${type}/${id}.json`);
    if (!data.meta) throw new CatalogFailure('notFound', 404);
    return normalizeCinemeta({ ...data.meta, type }, true);
  }
  if (source === 'tmdb' && (kind === 'film' || kind === 'series') && /^\d{1,9}$/.test(id)) {
    // The key lives on the server only; the browser fallback cannot reach TMDB.
    if (!options.tmdb) throw new CatalogFailure('unavailable', 503);
    const data = await options.tmdb(`/${kind === 'film' ? 'movie' : 'tv'}/${id}`);
    if (!data?.id) throw new CatalogFailure('notFound', 404);
    return normalizeTmdb(data, kind, {}, true);
  }
  throw new CatalogFailure('badReference', 400);
}
