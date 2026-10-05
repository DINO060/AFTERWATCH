import { assertSameOrigin } from '@/lib/auth';
import { langFromRequest, messages } from '@/lib/i18n';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const headers = { 'Cache-Control': 'private, no-store' };

export async function POST(request: Request) {
  const t = messages[langFromRequest(request)].api;
  try {
    assertSameOrigin(request, t.sameOrigin);
    const supabase = await createSupabaseServerClient();
    if (!supabase) return Response.json({ error: t.authUnavailable }, { status: 503, headers });
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    if (error) return Response.json({ error: t.signoutFailed }, { status: 503, headers });
    return Response.json({ ok: true }, { headers });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: t.signoutFailed }, { status: 503, headers });
  }
}
