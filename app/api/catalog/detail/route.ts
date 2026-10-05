// Public metadata only; no collection or authentication data is returned.
import { catalogDetail, CatalogFailure } from '@/lib/catalog-server';
import type { Kind } from '@/lib/watch';
export async function GET(request: Request) {
  try {
    const p = new URL(request.url).searchParams;
    const item = await catalogDetail(p.get('kind') as Kind, p.get('source') || '', p.get('id') || '');
    return Response.json({ item }, { headers: { 'Cache-Control': 'private, max-age=120' } });
  } catch (e) {
    if (e instanceof Response) return e;
    return Response.json(
      {
        error:
          e instanceof CatalogFailure
            ? e.message
            : 'La fiche est momentanément indisponible. Réessaie dans un instant.',
      },
      { status: e instanceof CatalogFailure ? e.status : 503 },
    );
  }
}
