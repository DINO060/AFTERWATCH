import { browseWith, detailWith, CatalogFailure, type Feed } from './catalog-gateway';
import type { Messages } from './i18n';
import type { Kind } from './watch';
import type { CatalogItem, CatalogPage } from './catalog';

async function readJson(response: Response) {
  let data: any;
  try {
    data = await response.json();
  } catch {
    throw new CatalogFailure('unreadable');
  }
  // Errors from /api/catalog arrive already translated by the server.
  if (!response.ok) throw new CatalogFailure('unavailable', response.status, data.error || undefined);
  return data;
}
function directFetch(signal?: AbortSignal) {
  return async (url: string) => {
    const timeout = AbortSignal.timeout(8000);
    const response = await fetch(url, {
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      headers: {
        Accept: new URL(url).hostname === 'kitsu.app' ? 'application/vnd.api+json' : 'application/json',
      },
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    return readJson(response);
  };
}
function shouldFallback(error: unknown, signal?: AbortSignal) {
  if (signal?.aborted) return false;
  return !(error instanceof CatalogFailure && [400, 401, 403, 404, 429].includes(error.status));
}
/** Text to show for a catalog error in the interface language. */
export function catalogErrorText(error: unknown, t: Messages): string {
  if (error instanceof CatalogFailure)
    return error.message !== error.key ? error.message : t.catalogErrors[error.key];
  return t.catalogErrors.unavailable;
}
export async function loadCatalog(
  kind: Kind,
  query: string,
  page: number,
  signal?: AbortSignal,
  feed: Feed = 'popular',
): Promise<CatalogPage> {
  try {
    const params = new URLSearchParams({ kind, q: query, page: String(page), feed });
    return await readJson(await fetch(`/api/catalog?${params}`, { signal, cache: 'no-store' }));
  } catch (e) {
    if (!shouldFallback(e, signal)) throw e;
    try {
      return await browseWith(directFetch(signal), kind, query, page, { feed });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new CatalogFailure('allSourcesDown');
    }
  }
}
export async function loadDetail(item: CatalogItem, signal?: AbortSignal): Promise<CatalogItem> {
  if (!item.catalog.id) return item;
  try {
    const params = new URLSearchParams({ kind: item.kind, source: item.catalog.source, id: item.catalog.id });
    const data = await readJson(await fetch(`/api/catalog/detail?${params}`, { signal, cache: 'no-store' }));
    return data.item;
  } catch (e) {
    if (!shouldFallback(e, signal)) throw e;
    return detailWith(directFetch(signal), item.kind, item.catalog.source, item.catalog.id);
  }
}
