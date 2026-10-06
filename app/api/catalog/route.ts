// Public metadata only; no collection or authentication data is returned.
import { browseCatalog, CatalogFailure } from '@/lib/catalog-server';
import { allFeeds, type Feed } from '@/lib/catalog-gateway';
import { langFromRequest, messages } from '@/lib/i18n';
import { catalogKinds, type CatalogKind } from '@/lib/watch';
export async function GET(request: Request) {
  const lang = langFromRequest(request);
  const t = messages[lang].catalogErrors;
  try {
    const p = new URL(request.url).searchParams;
    const q = p.get('q')?.trim() || '';
    const kind = p.get('kind') || 'anime';
    const feed = p.get('feed') || 'popular';
    const page = Number(p.get('page') || 1);
    if (
      !catalogKinds.includes(kind as CatalogKind) ||
      !allFeeds.includes(feed as Feed) ||
      q.length > 150 ||
      !Number.isInteger(page) ||
      page < 1 ||
      page > 500
    )
      return Response.json({ error: t.invalidSearch }, { status: 400 });
    return Response.json(await browseCatalog(kind as CatalogKind, q, page, feed as Feed, lang), {
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
