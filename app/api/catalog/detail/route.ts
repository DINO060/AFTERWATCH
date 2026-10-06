// Public metadata only; no collection or authentication data is returned.
import { catalogDetail, CatalogFailure } from '@/lib/catalog-server';
import { langFromRequest, messages } from '@/lib/i18n';
import type { Kind } from '@/lib/watch';
export async function GET(request: Request) {
  const lang = langFromRequest(request);
  const t = messages[lang].catalogErrors;
  try {
    const p = new URL(request.url).searchParams;
    const item = await catalogDetail(p.get('kind') as Kind, p.get('source') || '', p.get('id') || '', lang);
    return Response.json({ item }, { headers: { 'Cache-Control': 'private, max-age=120' } });
  } catch (e) {
    if (e instanceof Response) return e;
    return Response.json(
      { error: e instanceof CatalogFailure ? t[e.key] : t.detailDown },
      { status: e instanceof CatalogFailure ? e.status : 503 },
    );
  }
}
