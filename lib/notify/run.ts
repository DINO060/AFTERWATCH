// One run of the notification job (every 10 minutes): reminders, new episodes and the Monday
// summary for members who turned them on. Server-only.
import { tmdbFetcher } from '../catalog-server';
import { locales, messages, type Lang } from '../i18n';
import { stateSchema } from '../server';
import { createSupabaseAdminClient } from '../supabase/admin';
import type { WatchState } from '../watch';
import { episodeNote, reminderNote, weeklyNote, type Note } from './messages';
import { dueReminders, episodesFor, weeklyDue, weekSessions, windowStart, type AiredEpisode } from './plan';
import { emailReady, pushReady, sendEmail, sendPush } from './send';
import { airedAnime, airedSeries, malIdsForKitsu } from './sources';

type Prefs = {
  user_id: string;
  email_reminders: boolean;
  email_new_episodes: boolean;
  email_weekly: boolean;
  push_reminders: boolean;
  push_new_episodes: boolean;
  lang: Lang;
  unsubscribe_token: string;
};
type Subscription = { id: string; user_id: string; endpoint: string; p256dh: string; auth: string };
type Item = {
  user: string;
  kind: 'reminder' | 'episode' | 'weekly';
  ref: string;
  channel: 'email' | 'push';
  note: Note;
  unsubscribeUrl: string;
};
export type RunSummary = {
  since: string;
  now: string;
  members: number;
  queued: number;
  sent: number;
  failed: number;
  skipped?: string;
  /** Which settings the server can see (never their values); only shown to the scheduled caller. */
  config?: { supabaseSecret: boolean; email: boolean; push: boolean; tmdb: boolean };
};

const anyOn =
  'email_reminders.eq.true,email_new_episodes.eq.true,email_weekly.eq.true,push_reminders.eq.true,push_new_episodes.eq.true';
const itemKey = (i: { user_id?: string; user?: string; kind: string; ref: string; channel: string }) =>
  `${i.user_id ?? i.user}|${i.kind}|${i.ref}|${i.channel}`;

/** Runs `task` over `items`, `limit` at a time. */
async function pool<T>(items: T[], limit: number, task: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await task(items[next++]);
    }),
  );
}

export async function runNotifications(site: string, now = Date.now()): Promise<RunSummary> {
  const summary: RunSummary = {
    since: '',
    now: new Date(now).toISOString(),
    members: 0,
    queued: 0,
    sent: 0,
    failed: 0,
    config: {
      supabaseSecret: Boolean(process.env.SUPABASE_SECRET_KEY?.trim()),
      email: emailReady(),
      push: pushReady(),
      tmdb: Boolean(tmdbFetcher('en')),
    },
  };
  const admin = createSupabaseAdminClient();
  if (!admin) return { ...summary, skipped: 'SUPABASE_SECRET_KEY missing' };
  const email = emailReady();
  const push = pushReady();
  if (!email && !push) return { ...summary, skipped: 'no delivery channel configured' };

  const { data: run } = await admin
    .from('cron_state')
    .select('last_run_at')
    .eq('name', 'notify')
    .maybeSingle();
  const since = windowStart(run ? Date.parse(run.last_run_at) : null, now);
  summary.since = new Date(since).toISOString();
  const { error: runError } = await admin
    .from('cron_state')
    .upsert({ name: 'notify', last_run_at: summary.now });
  if (runError) throw new Error('cron_state update failed');

  const { data: prefRows, error: prefError } = await admin.from('notification_prefs').select('*').or(anyOn);
  if (prefError) throw new Error('notification_prefs read failed');
  const prefs = (prefRows || []) as Prefs[];
  summary.members = prefs.length;
  if (!prefs.length) return summary;
  const ids = prefs.map((p) => p.user_id);
  const [{ data: stateRows }, { data: subRows }] = await Promise.all([
    admin.from('watch_states').select('user_id, data').in('user_id', ids),
    admin.from('push_subscriptions').select('id, user_id, endpoint, p256dh, auth').in('user_id', ids),
  ]);
  const states = new Map<string, WatchState>();
  for (const row of stateRows || []) {
    const parsed = stateSchema.safeParse(row.data);
    if (parsed.success) states.set(row.user_id, parsed.data);
  }
  const subscriptions = (subRows || []) as Subscription[];

  // Episode sources are queried only when someone asked for episode alerts.
  let aired = new Map<string, AiredEpisode[]>();
  let malOf = (_kitsuId: string): number | null => null;
  const episodeFans = prefs.filter((p) => p.email_new_episodes || p.push_new_episodes);
  if (episodeFans.length) {
    const kitsuIds: string[] = [];
    const seriesKeys: string[] = [];
    for (const p of episodeFans)
      for (const m of states.get(p.user_id)?.media || []) {
        if (m.kind === 'anime' && m.catalog?.source === 'kitsu') kitsuIds.push(m.catalog.id);
        if (m.kind === 'series' && (m.catalog?.source === 'tmdb' || m.catalog?.source === 'tvmaze'))
          seriesKeys.push(`${m.catalog.source}:${m.catalog.id}`);
      }
    const [anime, malIds, series] = await Promise.all([
      airedAnime(since, now).catch((e) => {
        console.warn('notify_anilist', e instanceof Error ? e.message : 'failed');
        return new Map<string, AiredEpisode[]>();
      }),
      malIdsForKitsu(admin, kitsuIds),
      airedSeries(seriesKeys, now, tmdbFetcher('en')),
    ]);
    aired = new Map([...anime, ...series]);
    malOf = (kitsuId) => malIds.get(kitsuId) ?? null;
  }

  const queue: Item[] = [];
  for (const p of prefs) {
    const state = states.get(p.user_id);
    if (!state) continue;
    const t = messages[p.lang] ?? messages.fr;
    const unsubscribeUrl = `${site}/api/notifications/unsubscribe?token=${p.unsubscribe_token}`;
    const hasDevice = subscriptions.some((s) => s.user_id === p.user_id);
    const add = (kind: Item['kind'], ref: string, note: Note, byEmail: boolean, byPush: boolean) => {
      if (byEmail && email)
        queue.push({ user: p.user_id, kind, ref, channel: 'email', note, unsubscribeUrl });
      if (byPush && push && hasDevice)
        queue.push({ user: p.user_id, kind, ref, channel: 'push', note, unsubscribeUrl });
    };
    if (p.email_reminders || p.push_reminders)
      for (const r of dueReminders(state, since, now))
        add(
          'reminder',
          r.ref,
          reminderNote(t, r.media, r.session, site, unsubscribeUrl),
          p.email_reminders,
          p.push_reminders,
        );
    if (p.email_new_episodes || p.push_new_episodes)
      for (const e of episodesFor(state, aired, malOf))
        add(
          'episode',
          e.ref,
          episodeNote(t, e.media, e.episode, site, unsubscribeUrl),
          p.email_new_episodes,
          p.push_new_episodes,
        );
    const monday = p.email_weekly ? weeklyDue(state.settings.timezone, since, now) : null;
    if (monday) {
      const priorities = state.media.filter((m) => m.priority && m.status !== 'completed').length;
      const note = weeklyNote(
        t,
        locales[p.lang] ?? locales.fr,
        weekSessions(state, monday),
        priorities,
        site,
        unsubscribeUrl,
      );
      add('weekly', `week:${monday}`, note, true, false);
    }
  }
  summary.queued = queue.length;
  if (!queue.length) return summary;

  // Claim each notification before sending: an overlapping run cannot send it twice.
  const { data: claimed, error: claimError } = await admin
    .from('notification_log')
    .upsert(
      queue.map((q) => ({ user_id: q.user, kind: q.kind, ref: q.ref, channel: q.channel })),
      { onConflict: 'user_id,kind,ref,channel', ignoreDuplicates: true },
    )
    .select('user_id, kind, ref, channel');
  if (claimError) throw new Error('notification_log claim failed');
  const mine = new Set((claimed || []).map(itemKey));
  const toSend = queue.filter((q) => mine.has(itemKey(q)));

  const addresses = new Map<string, string>();
  await pool([...new Set(toSend.filter((q) => q.channel === 'email').map((q) => q.user))], 5, async (id) => {
    const { data } = await admin.auth.admin.getUserById(id);
    if (data?.user?.email && data.user.email_confirmed_at) addresses.set(id, data.user.email);
  });

  await pool(toSend, 5, async (q) => {
    try {
      if (q.channel === 'email') {
        const to = addresses.get(q.user);
        if (!to) return;
        await sendEmail(to, q.note, q.unsubscribeUrl);
      } else {
        for (const s of subscriptions.filter((s) => s.user_id === q.user))
          if ((await sendPush(s, q.note)) === 'gone')
            await admin.from('push_subscriptions').delete().eq('id', s.id);
      }
      summary.sent++;
    } catch (e) {
      summary.failed++;
      console.warn('notify_send', q.channel, e instanceof Error ? e.message : 'failed');
    }
  });

  // The log only needs to outlive the windows it de-duplicates.
  await admin
    .from('notification_log')
    .delete()
    .lt('sent_at', new Date(now - 60 * 86400000).toISOString());
  return summary;
}
