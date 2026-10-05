import type { SupabaseClient, User } from '@supabase/supabase-js';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const privateHeaders = { 'Cache-Control': 'private, no-store' };

export { assertSameOrigin } from '@/lib/auth-origin';

export async function requireUser(): Promise<{ supabase: SupabaseClient; user: User }> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    throw Response.json(
      { error: 'La connexion est indisponible pour le moment.' },
      { status: 503, headers: privateHeaders },
    );
  }
  let result;
  try {
    // A user record returned by getSession() would trust a client-written cookie.
    result = await supabase.auth.getUser();
  } catch {
    throw Response.json(
      { error: 'Le service de connexion est temporairement indisponible.' },
      { status: 503, headers: privateHeaders },
    );
  }
  if (result.error && (!result.error.status || result.error.status === 429 || result.error.status >= 500)) {
    throw Response.json(
      { error: 'Le service de connexion est temporairement indisponible.' },
      { status: 503, headers: privateHeaders },
    );
  }
  if (result.error || !result.data.user) {
    throw Response.json(
      { error: 'Connecte-toi pour accéder à ton compte.' },
      { status: 401, headers: privateHeaders },
    );
  }
  return { supabase, user: result.data.user };
}
