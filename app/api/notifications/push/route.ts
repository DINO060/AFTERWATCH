import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { langFromRequest, messages } from '@/lib/i18n';
import { errorResponse, sameOrigin } from '@/lib/server';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };
// The server posts to these URLs: only the browsers' push services are accepted (same rule as the database).
const endpoint = z
  .string()
  .max(1000)
  .regex(
    /^https:\/\/(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)\//,
  );
const subscription = z.object({
  endpoint,
  keys: z.object({ p256dh: z.string().min(20).max(200), auth: z.string().min(8).max(100) }),
});

export async function POST(request: Request) {
  const lang = langFromRequest(request);
  try {
    sameOrigin(request, messages[lang].api.sameOrigin);
    const { supabase } = await requireUser(lang);
    const body = subscription.parse(JSON.parse(await request.text()));
    const { error } = await supabase.rpc('save_push_subscription', {
      p_endpoint: body.endpoint,
      p_p256dh: body.keys.p256dh,
      p_auth: body.keys.auth,
    });
    if (error) throw new Error('Push subscription save failed');
    return Response.json({ ok: true }, { headers });
  } catch (e) {
    return errorResponse(e, lang);
  }
}

export async function DELETE(request: Request) {
  const lang = langFromRequest(request);
  try {
    sameOrigin(request, messages[lang].api.sameOrigin);
    const { supabase, user } = await requireUser(lang);
    const body = z.object({ endpoint }).parse(JSON.parse(await request.text()));
    const { error } = await supabase
      .from('push_subscriptions')
      .delete()
      .eq('user_id', user.id)
      .eq('endpoint', body.endpoint);
    if (error) throw new Error('Push subscription delete failed');
    return Response.json({ ok: true }, { headers });
  } catch (e) {
    return errorResponse(e, lang);
  }
}
