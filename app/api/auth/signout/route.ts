import { assertSameOrigin } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const headers = { 'Cache-Control': 'private, no-store' };

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const supabase = await createSupabaseServerClient();
    if (!supabase) return Response.json({ error: 'La connexion est indisponible pour le moment.' }, { status: 503, headers });
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    if (error) return Response.json({ error: 'Impossible de terminer la déconnexion. Réessaie.' }, { status: 503, headers });
    return Response.json({ ok: true }, { headers });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: 'Impossible de terminer la déconnexion. Réessaie.' }, { status: 503, headers });
  }
}
