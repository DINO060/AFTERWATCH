// Public metadata only; no collection or authentication data is returned.
import { browseCatalog, CatalogFailure } from '@/lib/catalog-server';
import { langFromRequest, messages } from '@/lib/i18n';
import type { Kind } from '@/lib/watch';
export async function GET(request: Request) {
  const t = messages[langFromRequest(request)].catalogErrors;
  try {
    const p = new URL(request.url).searchParams;
    const q = p.get('q')?.trim() || '';
    const kind = p.get('kind') || 'anime';
    const page = Number(p.get('page') || 1);
    if (
      !['anime', 'manga', 'series', 'film'].includes(kind) ||
      q.length > 150 ||
      !Number.isInteger(page) ||
      page < 1 ||
      page > 10000
    )
      return Response.json({ error: t.invalidSearch }, { status: 400 });
    return Response.json(await browseCatalog(kind as Kind, q, page), {
      headers: { 'Cache-Control': 'private, max-age=120' },
    });
  } catch (e) {
    if (e instanceof Response) return e;
    return Response.json(
      { error: e instanceof CatalogFailure ? t[e.key] : t.catalogDown },
      { status: e instanceof CatalogFailure ? e.status : 503 },
    );
  }
}
