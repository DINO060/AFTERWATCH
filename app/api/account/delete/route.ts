import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { assertExpectedUser } from '@/lib/auth-owner';
import { confirmsDeletion } from '@/lib/account';
import { langFromRequest, messages } from '@/lib/i18n';
import { errorResponse, sameOrigin } from '@/lib/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };

/**
 * Deletes the signed-in member's account. Every table holding their data references the account
 * with ON DELETE CASCADE, so the list, schedule, notifications, devices, counters and username go with it.
 */
export async function POST(request: Request) {
  const lang = langFromRequest(request);
  const t = messages[lang].account;
  try {
    sameOrigin(request, messages[lang].api.sameOrigin);
    const { supabase, user } = await requireUser(lang);
    const body = z
      .object({ expectedUserId: z.string().uuid(), confirm: z.string().max(40) })
      .parse(JSON.parse(await request.text()));
    assertExpectedUser(body.expectedUserId, user.id, messages[lang].api.accountChanged);
    if (!confirmsDeletion(body.confirm))
      return Response.json({ error: t.deleteWordMissing }, { status: 400, headers });
    const admin = createSupabaseAdminClient();
    if (!admin) {
      console.error('account_delete_unconfigured');
      return Response.json({ error: t.deleteFailed }, { status: 503, headers });
    }
    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error) {
      console.error('account_delete_failed', error.code || error.status);
      return Response.json({ error: t.deleteFailed }, { status: 503, headers });
    }
    // The account is gone; clear this browser's session cookies too.
    await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
    return Response.json({ ok: true }, { headers });
  } catch (e) {
    return errorResponse(e, lang);
  }
}
