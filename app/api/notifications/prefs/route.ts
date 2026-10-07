import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { langFromRequest, messages } from '@/lib/i18n';
import { emailReady, pushReady } from '@/lib/notify/send';
import { errorResponse, sameOrigin } from '@/lib/server';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };
const fields = [
  'email_reminders',
  'email_new_episodes',
  'email_weekly',
  'push_reminders',
  'push_new_episodes',
] as const;
const defaults = Object.fromEntries(fields.map((f) => [f, false])) as Record<
  (typeof fields)[number],
  boolean
>;
const input = z
  .object(
    Object.fromEntries(fields.map((f) => [f, z.boolean()])) as Record<(typeof fields)[number], z.ZodBoolean>,
  )
  .extend({ lang: z.enum(['fr', 'en']) })
  .strict();

export async function GET(request: Request) {
  const lang = langFromRequest(request);
  try {
    const { supabase, user } = await requireUser(lang);
    const { data, error } = await supabase
      .from('notification_prefs')
      .select(fields.join(', '))
      .eq('user_id', user.id)
      .maybeSingle();
    if (error) throw new Error('Preferences read failed');
    return Response.json(
      {
        prefs: { ...defaults, ...((data as Partial<typeof defaults> | null) || {}) },
        emailAvailable: emailReady(),
        pushAvailable: pushReady(),
        vapidPublicKey: process.env.VAPID_PUBLIC_KEY?.trim() || null,
      },
      { headers },
    );
  } catch (e) {
    return errorResponse(e, lang);
  }
}

export async function PUT(request: Request) {
  const lang = langFromRequest(request);
  try {
    sameOrigin(request, messages[lang].api.sameOrigin);
    const { supabase, user } = await requireUser(lang);
    const prefs = input.parse(JSON.parse(await request.text()));
    // Update first; insert the row the first time. (An upsert would also try to update user_id.)
    const { data: updated, error } = await supabase
      .from('notification_prefs')
      .update({ ...prefs, updated_at: new Date().toISOString() })
      .eq('user_id', user.id)
      .select('user_id');
    if (error) throw new Error('Preferences update failed');
    if (!updated?.length) {
      const { error: insertError } = await supabase
        .from('notification_prefs')
        .insert({ user_id: user.id, ...prefs });
      if (insertError) throw new Error('Preferences insert failed');
    }
    return Response.json({ ok: true }, { headers });
  } catch (e) {
    return errorResponse(e, lang);
  }
}
