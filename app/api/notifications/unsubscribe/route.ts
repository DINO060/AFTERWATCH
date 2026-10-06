import { escapeHtml } from '@/lib/notify/messages';
import { messages, type Lang } from '@/lib/i18n';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

// Reached from e-mails without signing in: the random token identifies the member's preferences.
// GET only shows a confirmation (link scanners must not unsubscribe anyone); POST unsubscribes,
// including one-click requests from mail apps (List-Unsubscribe-Post).
export const dynamic = 'force-dynamic';
const TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function lookup(token: string | null) {
  const admin = createSupabaseAdminClient();
  if (!admin || !token || !TOKEN.test(token)) return null;
  const { data } = await admin
    .from('notification_prefs')
    .select('user_id, lang')
    .eq('unsubscribe_token', token)
    .maybeSingle();
  return data ? { admin, lang: (data.lang === 'en' ? 'en' : 'fr') as Lang } : null;
}

function page(lang: Lang, body: string, status = 200) {
  const t = messages[lang].notify;
  return new Response(
    `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Afterwatch — ${escapeHtml(t.unsubscribeTitle)}</title><style>body{margin:0;background:#0d0e12;color:#f2f2f4;font:17px system-ui,sans-serif;min-height:100dvh;display:grid;place-items:center}main{max-width:460px;padding:32px}h1{font-size:28px}p{color:#c9ccd6;line-height:1.6}button,a{display:inline-block;background:#ff6a55;color:#1a0d0a;border:0;border-radius:12px;padding:14px 22px;font:inherit;font-weight:700;text-decoration:none;cursor:pointer}a.secondary{background:transparent;color:#f2f2f4;border:1px solid #3a3f4c;margin-top:12px}</style></head><body><main><h1>afterwatch<span style="color:#ff6a55">.</span></h1>${body}</main></body></html>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } },
  );
}

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get('token');
  const found = await lookup(token);
  if (!found)
    return page(
      'fr',
      `<p>${escapeHtml(messages.fr.notify.unsubscribeInvalid)}</p><a href="/">${escapeHtml(messages.fr.notify.backToSite)}</a>`,
      404,
    );
  const t = messages[found.lang].notify;
  return page(
    found.lang,
    `<p>${escapeHtml(t.unsubscribeQuestion)}</p><form method="post"><button type="submit">${escapeHtml(t.unsubscribeConfirm)}</button></form><a class="secondary" href="/">${escapeHtml(t.backToSite)}</a>`,
  );
}

export async function POST(request: Request) {
  const token = new URL(request.url).searchParams.get('token');
  const found = await lookup(token);
  if (!found) return page('fr', `<p>${escapeHtml(messages.fr.notify.unsubscribeInvalid)}</p>`, 404);
  const { error } = await found.admin
    .from('notification_prefs')
    .update({
      email_reminders: false,
      email_new_episodes: false,
      email_weekly: false,
      updated_at: new Date().toISOString(),
    })
    .eq('unsubscribe_token', token!);
  if (error) return page(found.lang, `<p>${escapeHtml(messages[found.lang].notify.saveFailed)}</p>`, 503);
  const t = messages[found.lang].notify;
  return page(
    found.lang,
    `<p>${escapeHtml(t.unsubscribeDone)}</p><a href="/">${escapeHtml(t.backToSite)}</a>`,
  );
}
