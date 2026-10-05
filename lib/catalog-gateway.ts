import {
  normalizeJikan,
  normalizeKitsu,
  normalizeCinemeta,
  normalizeTVMaze,
  type CatalogPage,
  type CatalogItem,
} from './catalog';
import type { Messages } from './i18n';
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

/** Public metadata only. No account, saved list or API key is sent to these services. */
export async function browseWith(
  fetchJson: CatalogFetch,
  kind: Kind,
  query: string,
  page: number,
): Promise<CatalogPage> {
  const size = 20;
  if (kind === 'anime' || kind === 'manga') {
    try {
      const params = new URLSearchParams({
        'page[limit]': String(size),
        'page[offset]': String((page - 1) * size),
        include: 'categories',
      });
      if (query) params.set('filter[text]', query);
      else params.set('sort', '-userCount');
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
      if (e instanceof Error && e.name === 'AbortError') throw e;
      const params = new URLSearchParams({ page: String(page), limit: String(size), sfw: 'true' });
      if (query) params.set('q', query);
      else params.set('filter', 'bypopularity');
      const data = await fetchJson(`https://api.jikan.moe/v4/${query ? kind : `top/${kind}`}?${params}`);
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
  if (kind === 'series') {
    if (query) {
      const data = await fetchJson(`https://api.tvmaze.com/search/shows?q=${encodeURIComponent(query)}`);
      const matches = data.map((x: any) => normalizeTVMaze(x.show));
      return {
        results: matches.slice((page - 1) * size, page * size),
        page,
        hasNext: matches.length > page * size,
        totalResults: matches.length,
        source: 'TVmaze',
      };
    }
    // One API index block per page: deleted show IDs make block sizes variable.
    const data = await fetchJson(`https://api.tvmaze.com/shows?page=${page - 1}`);
    const sorted = [...data].sort((a: any, b: any) => (b.weight || 0) - (a.weight || 0));
    return {
      results: sorted.map(normalizeTVMaze),
      page,
      hasNext: data.length > 0,
      totalResults: null,
      source: 'TVmaze',
    };
  }
  const skip = (page - 1) * size;
  const extra = query ? `/search=${encodeURIComponent(query)}` : skip ? `/skip=${skip}` : '';
  const data = await fetchJson(`https://v3-cinemeta.strem.io/catalog/movie/top${extra}.json`);
  if (!Array.isArray(data.metas)) throw new CatalogFailure('badResponse');
  const all = data.metas.filter((x: any) => /^tt\d+$/.test(x.id) && x.type === 'movie');
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

export async function detailWith(
  fetchJson: CatalogFetch,
  kind: Kind,
  source: string,
  id: string,
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
  throw new CatalogFailure('badReference', 400);
}
