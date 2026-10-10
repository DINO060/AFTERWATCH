import { requireUser } from '@/lib/auth';
import { langFromRequest } from '@/lib/i18n';
import { errorResponse } from '@/lib/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

/** "Télécharger mes données": everything Afterwatch keeps about the member, as one JSON file. */
export async function GET(request: Request) {
  const lang = langFromRequest(request);
  try {
    const { supabase, user } = await requireUser(lang);
    const read = async <T>(
      query: PromiseLike<{ data: T; error: { code?: string } | null }>,
      what: string,
    ) => {
      const { data, error } = await query;
      if (error) throw new Error(`Export ${what} failed (${error.code})`);
      return data;
    };
    const [collection, profile, notifications, devices] = await Promise.all([
      read(
        supabase
          .from('watch_states')
          .select('data, revision, updated_at')
          .eq('user_id', user.id)
          .maybeSingle(),
        'collection',
      ),
      read(supabase.from('profiles').select('username').eq('user_id', user.id).maybeSingle(), 'profile'),
      read(
        supabase
          .from('notification_prefs')
          .select(
            'email_reminders, email_new_episodes, email_weekly, push_reminders, push_new_episodes, lang, updated_at',
          )
          .eq('user_id', user.id)
          .maybeSingle(),
        'notifications',
      ),
      read(
        supabase.from('push_subscriptions').select('endpoint, created_at').eq('user_id', user.id),
        'devices',
      ),
    ]);
    // The daily assistant counters are not readable by members; the server role reads them for this export.
    const admin = createSupabaseAdminClient();
    const assistant = admin
      ? await read(admin.from('assistant_usage').select('day, count').eq('user_id', user.id), 'assistant')
      : null;
    // What the member posted in the community, read the same way (members only reach it through functions).
    const community = admin
      ? await Promise.all([
          read(
            admin
              .from('community_comments')
              .select(
                'kind, body, spoiler, created_at, edited_at, deleted_at, removed, parent_id, target:community_targets(kind, title, season, episode)',
              )
              .eq('author_id', user.id)
              .order('created_at'),
            'community posts',
          ),
          read(
            admin
              .from('community_ratings')
              .select('score, updated_at, target:community_targets(kind, title, season, episode)')
              .eq('user_id', user.id),
            'community verdicts',
          ),
          read(
            admin
              .from('community_target_reactions')
              .select('reaction, created_at, target:community_targets(kind, title, season, episode)')
              .eq('user_id', user.id),
            'community reactions',
          ),
          read(
            admin.from('community_prefs').select('spoiler_protection').eq('user_id', user.id).maybeSingle(),
            'community settings',
          ),
        ]).then(([posts, verdicts, reactions, settings]) => ({ posts, verdicts, reactions, settings }))
      : null;
    const file = {
      exportedAt: new Date().toISOString(),
      account: {
        id: user.id,
        email: user.email ?? null,
        createdAt: user.created_at,
        lastSignInAt: user.last_sign_in_at ?? null,
        displayName: user.user_metadata?.display_name ?? null,
        signInMethods: [...new Set((user.identities || []).map((identity) => identity.provider))],
      },
      profile,
      collection,
      notifications,
      // The delivery address of a device is a secret of the browser: only its service and date are listed.
      devices: (devices || []).map((d: { endpoint: string; created_at: string }) => ({
        service: new URL(d.endpoint).host,
        addedAt: d.created_at,
      })),
      assistantMessagesPerDay: assistant,
      community,
    };
    const day = new Date().toISOString().slice(0, 10);
    return new Response(JSON.stringify(file, null, 2), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="afterwatch-${day}.json"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (e) {
    return errorResponse(e, lang);
  }
}
