import { browseWith, detailWith, CatalogFailure, type Feed, type TmdbFetch } from './catalog-gateway';
import type { Lang } from './i18n';
import type { CatalogKind, Kind } from './watch';
export { CatalogFailure } from './catalog-gateway';
const memo = new Map<string, { until: number; value: any }>();
// URLs may carry the TMDB key: never log them, only the host.
export async function catalogJson(url: string, headers: Record<string, string> = {}): Promise<any> {
  const old = memo.get(url);
  if (old && old.until > Date.now()) return old.value;
  const host = new URL(url).hostname;
  try {
    const response = await fetch(url, {
      headers: { Accept: host === 'kitsu.app' ? 'application/vnd.api+json' : 'application/json', ...headers },
      signal: AbortSignal.timeout(4500),
    });
    if (!response.ok) {
      console.warn('catalog_upstream', { host, status: response.status });
      throw response.status === 429
        ? new CatalogFailure('rateLimited', 429)
        : new CatalogFailure('sourceDown', 503);
    }
    const value: any = await response.json();
    if (memo.size >= 150) memo.delete(memo.keys().next().value!);
    memo.set(url, { value, until: Date.now() + 15 * 60 * 1000 });
    return value;
  } catch (e) {
    if (!(e instanceof CatalogFailure))
      console.warn('catalog_upstream', { host, reason: e instanceof Error ? e.name : 'network' });
    throw e instanceof CatalogFailure ? e : new CatalogFailure('sourceSlow');
  }
}

const tmdbKey = () => process.env.TMDB_API_KEY?.trim() || '';
export const tmdbEnabled = () => Boolean(tmdbKey());

/** TMDB accepts either the v4 read token (Bearer) or the v3 API key (query parameter). */
function tmdbFetcher(lang: Lang): TmdbFetch | undefined {
  const key = tmdbKey();
  if (!key) return undefined;
  const bearer = key.startsWith('eyJ');
  return (path, params = {}) => {
    const query = new URLSearchParams({ ...params, language: lang === 'fr' ? 'fr-FR' : 'en-US' });
    if (!bearer) query.set('api_key', key);
    return catalogJson(
      `https://api.themoviedb.org/3${path}?${query}`,
      bearer ? { Authorization: `Bearer ${key}` } : {},
    );
  };
}

export const browseCatalog = (kind: CatalogKind, query: string, page: number, feed: Feed, lang: Lang) =>
  browseWith(catalogJson, kind, query, page, { feed, lang, tmdb: tmdbFetcher(lang) });
export const catalogDetail = (kind: Kind, source: string, id: string, lang: Lang) =>
  detailWith(catalogJson, kind, source, id, { lang, tmdb: tmdbFetcher(lang) });
