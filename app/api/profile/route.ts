import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { langFromRequest, messages } from '@/lib/i18n';
import { errorResponse, sameOrigin } from '@/lib/server';
import { usernameProblem } from '@/lib/username';
import { removeAvatarFile } from '@/lib/community-server';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };

/** The member's public username (null before they choose one) and profile photo. */
export async function GET(request: Request) {
  const lang = langFromRequest(request);
  try {
    const { supabase, user } = await requireUser(lang);
    const { data, error } = await supabase
      .from('profiles')
      .select('username, avatar_path')
      .eq('user_id', user.id)
      .maybeSingle();
    if (error) throw new Error(`Profile read failed (${error.code})`);
    return Response.json(
      { username: data?.username ?? null, avatar: data?.avatar_path ?? null },
      { headers },
    );
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
    const input = z
      .union([
        z.object({ username: z.string().max(100) }),
        z.object({ avatar: z.string().max(120).nullable() }),
      ])
      .parse(JSON.parse(await request.text()));
    // The profile photo: the browser sent the file to the member's own folder; the database checks
    // the path, and the previous file is deleted.
    if ('avatar' in input) {
      const { data, error } = await supabase.rpc('set_avatar', { p_path: input.avatar });
      if (error) {
        const known =
          error.message === 'username_required'
            ? [t.avatarNeedUsername, 409]
            : error.message === 'invalid_avatar'
              ? [t.avatarFailed, 400]
              : null;
        if (known) return Response.json({ error: known[0] }, { status: known[1] as number, headers });
        console.error('avatar_save_failed', error.code);
        return Response.json({ error: t.avatarFailed }, { status: 503, headers });
      }
      const result = data as { avatar: string | null; previous: string | null };
      if (result.previous && result.previous !== result.avatar) await removeAvatarFile(result.previous);
      return Response.json({ avatar: result.avatar }, { headers });
    }
    const { username } = input;
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
