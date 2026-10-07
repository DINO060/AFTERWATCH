import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { langFromRequest, messages } from '@/lib/i18n';
import { errorResponse, sameOrigin } from '@/lib/server';
import { usernameProblem } from '@/lib/username';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };

/** The member's public username, or null before they choose one. */
export async function GET(request: Request) {
  const lang = langFromRequest(request);
  try {
    const { supabase, user } = await requireUser(lang);
    const { data, error } = await supabase
      .from('profiles')
      .select('username')
      .eq('user_id', user.id)
      .maybeSingle();
    if (error) throw new Error(`Profile read failed (${error.code})`);
    return Response.json({ username: data?.username ?? null }, { headers });
  } catch (e) {
    return errorResponse(e, lang);
  }
}

export async function PUT(request: Request) {
  const lang = langFromRequest(request);
  const t = messages[lang].account;
  try {
    sameOrigin(request, messages[lang].api.sameOrigin);
    const { supabase } = await requireUser(lang);
    const { username } = z.object({ username: z.string().max(100) }).parse(JSON.parse(await request.text()));
    const problem = usernameProblem(username);
    if (problem) return Response.json({ error: t.usernameProblems[problem] }, { status: 400, headers });
    // The database checks the rules again, picks the winner of a race, and limits changes to one a day.
    const { data, error } = await supabase.rpc('set_username', { p_username: username });
    if (error) {
      const known =
        error.code === '23505'
          ? [t.usernameTaken, 409]
          : error.message === 'username_too_soon'
            ? [t.usernameTooSoon, 429]
            : error.message === 'reserved_username'
              ? [t.usernameProblems.usernameReserved, 400]
              : error.message === 'invalid_username'
                ? [t.usernameProblems.usernameChars, 400]
                : null;
      if (known) return Response.json({ error: known[0] }, { status: known[1] as number, headers });
      console.error('username_save_failed', error.code);
      return Response.json({ error: t.usernameFailed }, { status: 503, headers });
    }
    return Response.json({ username: data }, { headers });
  } catch (e) {
    return errorResponse(e, lang);
  }
}
