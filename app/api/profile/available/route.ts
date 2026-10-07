import { requireUser } from '@/lib/auth';
import { langFromRequest, messages } from '@/lib/i18n';
import { errorResponse } from '@/lib/server';
import { usernameProblem } from '@/lib/username';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };

/** Whether the signed-in member could take this username; a rule problem comes back as text. */
export async function GET(request: Request) {
  const lang = langFromRequest(request);
  const t = messages[lang].account;
  try {
    const { supabase } = await requireUser(lang);
    const username = new URL(request.url).searchParams.get('u') || '';
    const problem = usernameProblem(username);
    if (problem)
      return Response.json({ available: false, problem: t.usernameProblems[problem] }, { headers });
    const { data, error } = await supabase.rpc('username_available', { p_username: username });
    if (error) throw new Error(`Username check failed (${error.code})`);
    return Response.json({ available: data === true }, { headers });
  } catch (e) {
    return errorResponse(e, lang);
  }
}
