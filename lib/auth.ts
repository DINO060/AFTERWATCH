import type { SupabaseClient, User } from '@supabase/supabase-js';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { messages, type Lang } from '@/lib/i18n';
import { requestLang } from '@/lib/i18n-server';

const privateHeaders = { 'Cache-Control': 'private, no-store' };

export { assertSameOrigin } from '@/lib/auth-origin';

export async function requireUser(lang?: Lang): Promise<{ supabase: SupabaseClient; user: User }> {
  const t = messages[lang ?? (await requestLang())].api;
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    throw Response.json({ error: t.authUnavailable }, { status: 503, headers: privateHeaders });
  }
  let result;
  try {
    // A user record returned by getSession() would trust a client-written cookie.
    result = await supabase.auth.getUser();
  } catch {
    throw Response.json({ error: t.authServiceDown }, { status: 503, headers: privateHeaders });
  }
  if (result.error && (!result.error.status || result.error.status === 429 || result.error.status >= 500)) {
    throw Response.json({ error: t.authServiceDown }, { status: 503, headers: privateHeaders });
  }
  if (result.error || !result.data.user) {
    throw Response.json({ error: t.signInRequired }, { status: 401, headers: privateHeaders });
  }
  return { supabase, user: result.data.user };
}
