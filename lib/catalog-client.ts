import { browseWith, detailWith, CatalogFailure } from './catalog-gateway';
import type { Kind } from './watch';
import type { CatalogItem, CatalogPage } from './catalog';

async function readJson(response: Response) {
  let data: any;
  try {
    data = await response.json();
  } catch {
    throw new CatalogFailure('La source a envoyé une réponse illisible.');
  }
  if (!response.ok)
    throw new CatalogFailure(data.error || 'Catalogue temporairement indisponible.', response.status);
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
export async function loadCatalog(
  kind: Kind,
  query: string,
  page: number,
  signal?: AbortSignal,
): Promise<CatalogPage> {
  try {
    const params = new URLSearchParams({ kind, q: query, page: String(page) });
    return await readJson(await fetch(`/api/catalog?${params}`, { signal, cache: 'no-store' }));
  } catch (e) {
    if (!shouldFallback(e, signal)) throw e;
    try {
      return await browseWith(directFetch(signal), kind, query, page);
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new Error(
        'Les sources du catalogue ne répondent pas. Réessaie dans un instant ou essaie une autre catégorie.',
      );
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
