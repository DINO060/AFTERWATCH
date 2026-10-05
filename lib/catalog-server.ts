import { browseWith, detailWith, CatalogFailure } from './catalog-gateway';
import type { Kind } from './watch';
export { CatalogFailure } from './catalog-gateway';
const memo = new Map<string, { until: number; value: any }>();
export async function catalogJson(url: string): Promise<any> {
  const old = memo.get(url);
  if (old && old.until > Date.now()) return old.value;
  const host = new URL(url).hostname;
  try {
    const response = await fetch(url, {
      headers: { Accept: host === 'kitsu.app' ? 'application/vnd.api+json' : 'application/json' },
      signal: AbortSignal.timeout(4500),
    });
    if (!response.ok) {
      console.warn('catalog_upstream', { host, status: response.status });
      throw response.status === 429
        ? new CatalogFailure('rateLimited', 429)
        : new CatalogFailure('sourceDown', 503);
    }
    const value: any = await response.json();
    if (memo.size >= 80) memo.delete(memo.keys().next().value!);
    memo.set(url, { value, until: Date.now() + 15 * 60 * 1000 });
    return value;
  } catch (e) {
    if (!(e instanceof CatalogFailure))
      console.warn('catalog_upstream', { host, reason: e instanceof Error ? e.name : 'network' });
    throw e instanceof CatalogFailure ? e : new CatalogFailure('sourceSlow');
  }
}
export const browseCatalog = (kind: Kind, query: string, page: number) =>
  browseWith(catalogJson, kind, query, page);
export const catalogDetail = (kind: Kind, source: string, id: string) =>
  detailWith(catalogJson, kind, source, id);
